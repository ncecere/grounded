package ingest

import (
	"context"
	"errors"
	"math/rand/v2"
	"time"

	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/pii"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// ProcessWorker runs Processor for River.
type ProcessWorker struct {
	river.WorkerDefaults[ProcessArgs]
	P *Processor
}

func (w *ProcessWorker) Timeout(*river.Job[ProcessArgs]) time.Duration { return 30 * time.Minute }

// outcome classifies an error: a final status with a user-facing code, or
// a transient problem worth retrying.
type outcome struct {
	status, code, message string
	kind                  parse.Kind // when parsing got that far (a skipped scan is still a PDF)
	retry                 bool
	pii                   *pii.Record // a held document's findings (nil: none recorded)
}

func classify(err error) outcome {
	if o, ok := classifyContext(err); ok {
		return o
	}
	var ge *gateway.Error
	switch {
	case heldRecord(err) != nil:
		return outcome{status: StatusSkipped, code: pii.ErrorCode, message: heldMessage(heldRecord(err)), pii: heldRecord(err)}
	case errors.Is(err, parse.ErrNeedsOCR):
		return outcome{status: StatusSkipped, code: ErrorNeedsOCR, message: err.Error()}
	case errors.Is(err, parse.ErrEmpty):
		return outcome{status: StatusSkipped, code: "empty", message: err.Error()}
	case errors.Is(err, parse.ErrUnsupported):
		return outcome{status: StatusFailed, code: "unsupported_format", message: err.Error()}
	case errors.Is(err, parse.ErrEncrypted):
		return outcome{status: StatusFailed, code: "encrypted", message: err.Error()}
	case errors.Is(err, parse.ErrTooLarge):
		return outcome{status: StatusFailed, code: "too_large", message: err.Error()}
	case errors.Is(err, parse.ErrCorrupt):
		return outcome{status: StatusFailed, code: "corrupt", message: err.Error()}
	case errors.Is(err, parse.ErrOCRUnavailable):
		return outcome{retry: true, code: "ocr_unavailable", message: "The OCR service is unavailable: " + err.Error()}
	case errors.Is(err, blob.ErrNotFound):
		return outcome{status: StatusFailed, code: "file_missing", message: "The uploaded file is missing from storage. Upload it again."}
	case errors.Is(err, catalog.ErrProfileUnusable):
		return outcome{status: StatusFailed, code: "profile_unusable", message: "The embedding model or its connection is disabled. Ask a platform admin, then retry."}
	case errors.Is(err, vectorstore.ErrDimensions):
		return outcome{status: StatusFailed, code: "dimension_mismatch", message: err.Error() + ". Ask a platform admin to check the embedding model."}
	case errors.As(err, &ge):
		switch ge.Kind {
		case gateway.KindUnavailable, gateway.KindRateLimited:
			return outcome{retry: true, code: "model_unavailable", message: "The embedding model is unavailable: " + ge.Message}
		case gateway.KindAuth:
			return outcome{status: StatusFailed, code: "model_auth", message: "The model proxy rejected the platform's API key. Ask a platform admin, then retry."}
		case gateway.KindNotFound:
			return outcome{status: StatusFailed, code: "model_not_found", message: "The model proxy does not know this embedding model. Ask a platform admin, then retry."}
		default:
			return outcome{status: StatusFailed, code: "model_error", message: "The embedding request failed: " + ge.Message}
		}
	}
	return outcome{retry: true, code: "processing_error", message: "Processing failed temporarily and will be retried."}
}

func (w *ProcessWorker) Work(ctx context.Context, job *river.Job[ProcessArgs]) error {
	p := w.P
	q := dbgen.New(p.Pool)
	// Maintenance mode: a document not yet started goes back to pending
	// (the job completes); the dispatcher queues it again when it ends. A
	// document already being processed finishes.
	if paused, err := p.Maintenance.Paused(ctx); err != nil {
		return err
	} else if paused {
		_, err := q.ParkDocument(ctx, job.Args.DocumentID)
		observeDocument(IngestParked, 0)
		return err
	}
	doc, err := q.StartProcessing(ctx, job.Args.DocumentID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil // deleted, or already handled
	} else if err != nil {
		return err
	}
	start := time.Now()
	res, err := p.process(ctx, doc)
	if err == nil {
		err = p.commit(ctx, doc, res)
		if errors.Is(err, errSuperseded) {
			observeDocument(IngestSuperseded, 0)
			return nil
		}
	}
	if err == nil {
		observeDocument(IngestIndexed, time.Since(start))
		return nil
	}
	return p.handleFailure(ctx, q, job, doc, res.kind, err)
}

// Ingest outcomes (grounded_ingest_documents_total).
const (
	IngestIndexed    = "indexed"
	IngestFailed     = StatusFailed
	IngestSkipped    = StatusSkipped
	IngestRetried    = "retried"    // a transient failure; the job retries
	IngestDeferred   = "deferred"   // the embedding model's backpressure; the job is snoozed
	IngestParked     = "parked"     // maintenance mode: back to pending
	IngestSuperseded = "superseded" // a newer version or embedding profile replaced it while processing
)

// observeDocument records a processed document (d > 0: its processing time).
func observeDocument(outcome string, d time.Duration) {
	observability.IngestDocuments.WithLabelValues(outcome).Inc()
	if d > 0 {
		observability.IngestDuration.Observe(d.Seconds())
	}
}

// handleFailure snoozes, retries or finishes a document whose processing
// failed; kind is the document's kind when it was detected.
func (p *Processor) handleFailure(ctx context.Context, q *dbgen.Queries, job *river.Job[ProcessArgs], doc dbgen.Document, kind parse.Kind, err error) error {
	if errors.Is(err, errProfileMoved) && ctx.Err() == nil {
		// Processed again for the source's new profile (not a failure).
		if rerr := q.SnoozeDocument(ctx, dbgen.SnoozeDocumentParams{ID: doc.ID, ErrorCode: "profile_moved",
			ErrorMessage: "The embedding profile changed while this document was processed; it is processed again."}); rerr != nil {
			return errors.Join(err, rerr)
		}
		observeDocument(IngestSuperseded, 0)
		return river.JobSnooze(time.Second)
	}
	// A document whose OCR would pass the team's daily page limit waits
	// (pending, not failed) and frees its slot.
	if w, ok := asOCRWait(err); ok && ctx.Err() == nil {
		p.Log.InfoContext(ctx, "document waits for the daily OCR page limit", "document", doc.ID, "until", w.Until)
		observeDocument(IngestWaiting, 0)
		return p.waitForOCR(ctx, doc, w)
	}
	// So is a team's monthly budget used up after the document was dispatched (docs/specs/agent-budgets/DESIGN.md §3).
	if bw, ok := asBudgetWait(err); ok && ctx.Err() == nil {
		p.Log.InfoContext(ctx, "document waits for the team's monthly budget", "document", doc.ID, "until", bw.until)
		observeDocument(IngestWaiting, 0)
		return p.waitForBudget(ctx, doc, bw)
	}
	// A contextual-chunks cap, budget or daily quota is a wait too (docs/contextual-chunks.md section 5).
	if l, ok := asContextLimit(err); ok && ctx.Err() == nil {
		p.Log.InfoContext(ctx, "document waits for a contextual chunks limit", "document", doc.ID)
		observeDocument(IngestWaiting, 0)
		return p.waitForContext(ctx, doc, l)
	}
	// Backpressure (the gateway's 429, 503 with Retry-After, or the
	// connection's own request limit) is not a failure: the job is snoozed,
	// which uses none of its attempts, and the document waits in the queue.
	if d, ok := backpressure(err); ok && ctx.Err() == nil {
		p.Log.InfoContext(ctx, "embedding model is busy; document will wait", "document", doc.ID, "retry_in", d)
		if rerr := q.SnoozeDocument(ctx, dbgen.SnoozeDocumentParams{ID: doc.ID, ErrorCode: "rate_limited",
			ErrorMessage: "Waiting for the embedding model's request limit; this document will continue automatically."}); rerr != nil {
			return errors.Join(err, rerr)
		}
		observeDocument(IngestDeferred, 0)
		return river.JobSnooze(d)
	}
	o := classify(err)
	if o.retry && job.Attempt < job.MaxAttempts && ctx.Err() == nil {
		p.Log.WarnContext(ctx, "document processing will retry", "document", doc.ID, "attempt", job.Attempt, "err", err)
		if rerr := q.RequeueDocument(ctx, dbgen.RequeueDocumentParams{ID: doc.ID, ErrorCode: o.code, ErrorMessage: o.message}); rerr != nil {
			return errors.Join(err, rerr)
		}
		observeDocument(IngestRetried, 0)
		return err
	}
	if o.retry {
		o.status = StatusFailed
	}
	o.kind = kind
	observeDocument(o.status, 0)
	p.Log.InfoContext(ctx, "document not indexed", "document", doc.ID, "status", o.status, "code", o.code, "err", err)
	return p.finishWithoutChunks(context.WithoutCancel(ctx), doc, o)
}

// Snooze bounds for backpressure.
const (
	minSnooze = time.Second
	maxSnooze = 10 * time.Minute
)

// backpressure reports whether err means "try again later" rather than a
// failure, and how long to wait (the proxy's Retry-After, bounded, plus up to
// 20% jitter so snoozed documents don't return all at once).
func backpressure(err error) (time.Duration, bool) {
	var ge *gateway.Error
	if !errors.As(err, &ge) || !ge.Backpressure() {
		return 0, false
	}
	d := ge.RetryAfter
	if d <= 0 {
		d = gateway.DefaultBackoff
	}
	d = min(max(d, minSnooze), maxSnooze)
	return d + time.Duration(rand.Int64N(int64(d/5)+1)), true
}
