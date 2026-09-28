package ingest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// Processor holds the dependencies for processing documents.
type Processor struct {
	Pool       *pgxpool.Pool
	Blob       blob.Store
	Parser     *parse.Router
	Counter    chunk.TokenCounter
	Catalog    *catalog.Service
	Vectors    vectorstore.Store
	EmbedBatch int // inputs per embedding request without a Batcher (default 64)
	// Batcher shares embedding requests between documents (nil: each
	// document is embedded with its own requests).
	Batcher  *Batcher
	MaxBytes int64 // largest original read into memory (default 128 MiB)
	// Boilerplate are the platform defaults for repeated-block suppression
	// (ADR-0021); a zero value turns it off for every source without
	// overrides.
	Boilerplate boilerplate.Defaults
	// Maintenance parks documents and boilerplate refreshes while
	// maintenance mode is on (nil: never; docs/phase5-deploy.md §5 P5).
	Maintenance *platform.MaintenanceGate
	// Dispatcher, when set, refills a finishing document's slot in its
	// commit transaction instead of kicking a dispatch job (refill).
	Dispatcher *DispatchWorker
	Log        *slog.Logger

	ensured sync.Map // profile ID -> struct{}: vector table exists
}

// ProcessWorker runs Processor for River.
type ProcessWorker struct {
	river.WorkerDefaults[ProcessArgs]
	P *Processor
}

func (w *ProcessWorker) Timeout(*river.Job[ProcessArgs]) time.Duration { return 30 * time.Minute }

// Status values.
const (
	StatusReady   = "ready"
	StatusFailed  = "failed"
	StatusSkipped = "skipped"
)

// outcome classifies an error: a final status with a user-facing code, or
// a transient problem worth retrying.
type outcome struct {
	status, code, message string
	retry                 bool
}

func classify(err error) outcome {
	var ge *gateway.Error
	switch {
	case errors.Is(err, parse.ErrNeedsOCR):
		return outcome{status: StatusSkipped, code: "needs_ocr", message: err.Error()}
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
	return p.handleFailure(ctx, q, job, doc, err)
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
// failed.
func (p *Processor) handleFailure(ctx context.Context, q *dbgen.Queries, job *river.Job[ProcessArgs], doc dbgen.Document, err error) error {
	if errors.Is(err, errProfileMoved) && ctx.Err() == nil {
		// Processed again for the source's new profile (not a failure).
		if rerr := q.SnoozeDocument(ctx, dbgen.SnoozeDocumentParams{ID: doc.ID, ErrorCode: "profile_moved",
			ErrorMessage: "The embedding profile changed while this document was processed; it is processed again."}); rerr != nil {
			return errors.Join(err, rerr)
		}
		observeDocument(IngestSuperseded, 0)
		return river.JobSnooze(time.Second)
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

// result is the output of the slow, lock-free part of processing.
type result struct {
	kind    parse.Kind
	parsed  parse.Document
	chunks  []chunk.Chunk
	plan    bpPlan
	vectors [][]float32
	target  catalog.EmbedTarget
	usage   EmbedUsage
}

func (p *Processor) process(ctx context.Context, doc dbgen.Document) (result, error) {
	var res result
	q := dbgen.New(p.Pool)
	src, err := q.GetSource(ctx, doc.SourceID)
	if err != nil {
		return res, err
	}
	if res.target, err = p.Catalog.EmbedTarget(ctx, src.EmbeddingProfileID); err != nil {
		return res, err
	}

	data, err := p.read(ctx, doc.BlobKey)
	if err != nil {
		return res, err
	}
	if res.parsed, res.kind, err = p.parse(ctx, src, doc, data); err != nil {
		return res, err
	}
	if key := parsedKey(doc.BlobKey); key != "" {
		md := res.parsed.Markdown
		if perr := p.Blob.Put(ctx, key, strings.NewReader(md), int64(len(md)), "text/markdown; charset=utf-8"); perr != nil {
			p.Log.WarnContext(ctx, "could not store parsed markdown", "document", doc.ID, "err", perr)
		}
	}

	if res.plan, err = p.planBoilerplate(ctx, q, src, doc.ID, chunk.Blocks(res.parsed.Markdown)); err != nil {
		return res, err
	}
	if res.chunks, err = p.split(res.parsed.Markdown, res.target, res.plan); err != nil {
		return res, err
	}
	if len(res.chunks) == 0 {
		return res, parse.ErrEmpty
	}
	title := res.parsed.Title
	if title == "" {
		title = doc.Title
	}
	res.vectors, res.usage, err = p.embed(ctx, res.target, p.embedTexts(res.target, title, res.chunks), doc.TeamID)
	return res, err
}

// parse detects a document's kind and parses its original.
func (p *Processor) parse(ctx context.Context, src dbgen.DataSource, doc dbgen.Document, data []byte) (parse.Document, parse.Kind, error) {
	name := doc.Filename
	if name == "" {
		name = doc.ExternalID
	}
	in := parse.Input{Name: name, Data: data}
	var err error
	if src.Type == "web" {
		// URLs carry no reliable extension: the content and the server's
		// Content-Type decide. Web HTML keeps only the main content.
		if in.Kind, err = parse.Detect("", data); err != nil {
			return parse.Document{}, "", err
		}
		in.Kind = webKind(in.Kind, doc.ContentType)
		in.WebPage, in.BaseURL = true, doc.URL
	} else if in.Kind, err = parse.Detect(name, data); err != nil {
		return parse.Document{}, "", err
	}
	parseCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	parsed, err := p.Parser.Parse(parseCtx, in)
	return parsed, in.Kind, err
}

// split chunks parsed Markdown with the profile's sizes, leaving out the
// plan's boilerplate blocks and image-only chunks.
func (p *Processor) split(md string, t catalog.EmbedTarget, plan bpPlan) ([]chunk.Chunk, error) {
	c := ChunkingOf(t.Profile, t.MaxInputTokens)
	opts := chunk.Options{MaxTokens: c.MaxTokens, OverlapTokens: c.Overlap, Counter: p.Counter, DropImageOnly: true}
	if len(plan.drop) > 0 {
		opts.DropBlock = func(text string) bool { return plan.drop[text] }
	}
	return chunk.Split(md, opts)
}

// embedTexts are the inputs embedded for chunks: the profile's document
// prefix, then the title and heading header and the content, cut to the
// model's input limit.
func (p *Processor) embedTexts(t catalog.EmbedTarget, title string, chunks []chunk.Chunk) []string {
	texts := make([]string, len(chunks))
	for i, c := range chunks {
		texts[i] = t.Profile.DocumentPrefix + truncateTokens(chunk.EmbedText(title, c), t.MaxInputTokens, p.Counter)
	}
	return texts
}

// webKind refines a sniffed text kind with the page's Content-Type.
func webKind(sniffed parse.Kind, contentType string) parse.Kind {
	if sniffed != parse.KindText && sniffed != parse.KindHTML {
		return sniffed // PDF, DOCX, PPTX: the content decides
	}
	switch strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0])) {
	case "text/html", "application/xhtml+xml":
		return parse.KindHTML
	case "text/markdown", "text/x-markdown":
		return parse.KindMarkdown
	case "text/plain":
		return parse.KindText
	}
	return sniffed
}

func (p *Processor) read(ctx context.Context, key string) ([]byte, error) {
	rc, err := p.Blob.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	limit := p.MaxBytes
	if limit <= 0 {
		limit = 128 << 20
	}
	data, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, parse.ErrTooLarge
	}
	return data, nil
}

// parsedKey stores parsed Markdown next to the original.
func parsedKey(originalKey string) string {
	if !strings.HasSuffix(originalKey, "/original") {
		return ""
	}
	return strings.TrimSuffix(originalKey, "original") + "parsed.md"
}

// truncateTokens shortens text to fit a model's input limit. It trims by
// runes proportionally, then re-checks, so it never loops long.
func truncateTokens(text string, maxTokens int, c chunk.TokenCounter) string {
	if maxTokens <= 0 {
		return text
	}
	for i := 0; i < 4; i++ {
		n := c.Count(text)
		if n <= maxTokens {
			return text
		}
		runes := []rune(text)
		keep := len(runes) * maxTokens / n * 95 / 100
		text = string(runes[:max(keep, 1)])
	}
	return text
}

// embed embeds a document's chunk texts: through the shared Batcher when
// set (requests carry several documents), else in requests of EmbedBatch
// inputs for this document alone. Requests are background work under the
// connection's request limit.
func (p *Processor) embed(ctx context.Context, t catalog.EmbedTarget, texts []string, team uuid.NullUUID) ([][]float32, EmbedUsage, error) {
	ctx = gateway.Background(ctx)
	var (
		out   [][]float32
		usage EmbedUsage
		err   error
	)
	if p.Batcher != nil {
		out, usage, err = p.Batcher.Embed(ctx, t, texts, teamUser(team))
	} else {
		out, usage, err = p.embedAlone(ctx, t, texts, teamUser(team))
	}
	if err != nil {
		return nil, usage, err
	}
	for _, v := range out {
		if len(v) != int(t.Profile.Dimensions) {
			return nil, usage, fmt.Errorf("%w: the model returned %d dimensions but the profile expects %d",
				vectorstore.ErrDimensions, len(v), t.Profile.Dimensions)
		}
	}
	return out, usage, nil
}

func (p *Processor) embedAlone(ctx context.Context, t catalog.EmbedTarget, texts []string, user string) ([][]float32, EmbedUsage, error) {
	batch := p.EmbedBatch
	if batch <= 0 {
		batch = 64
	}
	out := make([][]float32, 0, len(texts))
	var usage EmbedUsage
	for start := 0; start < len(texts); start += batch {
		end := min(start+batch, len(texts))
		observability.EmbeddingBatchInputs.Observe(float64(end - start))
		res, err := t.Embed(ctx, texts[start:end], user)
		if err != nil {
			return nil, usage, err
		}
		out = append(out, res.Vectors...)
		usage.Requests++
		usage.Reported += res.Usage.TotalTokens
		for _, s := range texts[start:end] {
			usage.Counted += p.Counter.Count(s)
		}
	}
	return out, usage, nil
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
