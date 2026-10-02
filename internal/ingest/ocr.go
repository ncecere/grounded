// OCR in ingestion (docs/ocr.md): which documents get it, the usage
// ledger, the OCR record on the document, and documents waiting for the
// team's daily OCR page limit.
//
// A document whose OCR would pass ocr_pages_per_day goes back to pending
// with waiting_until set to the next UTC day and the reason in its error
// code (ocr_daily_limit): it frees its in-flight slot, and the dispatcher
// skips it (a partial index keeps that free) until the time comes (the
// dispatch job wakes due documents) or the limit changes (WakeOCRWaiting,
// from the limits service's OnChange hook). Nothing changes for documents
// that need no OCR.

package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/ocr"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Waiting reasons of pending documents (error_code while waiting_until is
// set).
const (
	WaitOCRDailyLimit = "ocr_daily_limit"
	// IngestWaiting counts documents parked for the daily OCR limit
	// (grounded_ingest_documents_total).
	IngestWaiting = "waiting"
)

// ocrPlan returns the OCR for a document of kind: only PDFs and images use
// it, and only when OCR is on for the platform and the source.
func (p *Processor) ocrPlan(ctx context.Context, src dbgen.DataSource, doc dbgen.Document, kind parse.Kind) (ocr.Plan, error) {
	if p.OCR == nil || (kind != parse.KindPDF && kind != parse.KindImage) {
		return ocr.Plan{}, nil
	}
	return p.OCR.ForDocument(ctx, src, doc)
}

// recordOCRUsage writes the pages read with OCR (and a vision model's
// tokens) to the usage ledger at once, whatever happens to the document
// next: the pages were read, and ocr_pages_per_day counts them.
func (p *Processor) recordOCRUsage(ctx context.Context, doc dbgen.Document, info *parse.OCRInfo, model uuid.NullUUID) error {
	events := ocr.UsageEvents(info, model)
	if len(events) == 0 {
		return nil
	}
	q := dbgen.New(p.Pool)
	for _, u := range events {
		u.TeamID, u.SourceID, u.DocumentID = doc.TeamID, uuid.NullUUID{UUID: doc.SourceID, Valid: true}, uuid.NullUUID{UUID: doc.ID, Valid: true}
		u.UserID = doc.UploadedBy
		if err := q.InsertUsage(context.WithoutCancel(ctx), u); err != nil {
			return err
		}
	}
	return nil
}

// ErrorNeedsOCR is the error code of documents that need OCR: skipped as
// scanned (no text at all), or indexed (ready) with pages skipped because
// OCR was off, a partly scanned PDF. Both are retried with "Retry all that
// need OCR" once OCR is on, and counted as "Needs OCR".
const ErrorNeedsOCR = "needs_ocr"

// readyError is the error code and message an indexed document keeps: a
// partly scanned PDF needs OCR for the pages listed in its message (also in
// its warning); others have none.
func readyError(parsed parse.Document) (code, message string) {
	p := parsed.NeedsOCR
	switch len(p) {
	case 0:
		return "", ""
	case 1:
		return ErrorNeedsOCR, fmt.Sprintf("Page %d has no text layer (it may be a scan) and wasn't read, because OCR is off for this document. "+
			"Once OCR is on, retry it to read that page.", p[0])
	}
	return ErrorNeedsOCR, clip(fmt.Sprintf("Pages %s have no text layer (they may be scans) and weren't read, because OCR is off for this document. "+
		"Once OCR is on, retry it to read those pages.", parse.PageList(p)), 1000)
}

// ocrRecord is metadata.ocr: the pages read with OCR and the backend.
type ocrRecord struct {
	Backend string `json:"backend"`
	Pages   []int  `json:"pages"`
}

// hasOCRRecord reports whether a document's metadata has an OCR record.
func hasOCRRecord(meta json.RawMessage) bool {
	var m map[string]json.RawMessage
	return json.Unmarshal(meta, &m) == nil && m["ocr"] != nil
}

// setOCRRecord records the pages read with OCR on the document, or removes
// an earlier version's record. Documents without OCR, before or now, are
// not written.
func setOCRRecord(ctx context.Context, q *dbgen.Queries, doc dbgen.Document, info *parse.OCRInfo) error {
	rec := json.RawMessage("null")
	if info != nil && len(info.Pages) > 0 {
		rec, _ = json.Marshal(ocrRecord{Backend: info.Backend, Pages: info.Pages})
	} else if !hasOCRRecord(doc.Metadata) {
		return nil
	}
	return q.SetDocumentOCR(ctx, dbgen.SetDocumentOCRParams{ID: doc.ID, Ocr: rec})
}

// waitForOCR parks a document until the daily OCR page limit allows it:
// pending, not counted as an attempt, with the reason people see. Its slot
// is refilled in the same transaction.
func (p *Processor) waitForOCR(ctx context.Context, doc dbgen.Document, w *parse.OCRWait) error {
	paused, err := p.paused(ctx)
	if err != nil {
		return err
	}
	msg := fmt.Sprintf("Waiting for the team's daily OCR page limit: this document needs %d pages read with OCR. "+
		"It continues after midnight UTC, or sooner if the limit is raised.", w.Pages)
	return pgx.BeginFunc(ctx, p.Pool, func(tx pgx.Tx) error {
		n, err := dbgen.New(tx).WaitDocument(ctx, dbgen.WaitDocumentParams{ID: doc.ID, WaitingUntil: &w.Until,
			ErrorCode: WaitOCRDailyLimit, ErrorMessage: msg})
		if err != nil || n == 0 {
			return err // n == 0: deleted or replaced meanwhile
		}
		return p.refill(ctx, tx, paused)
	})
}

// wakeDue makes waiting documents whose time has come pending again. The
// dispatch job runs it; a partial index makes it free when none wait.
func wakeDue(ctx context.Context, q *dbgen.Queries) (int64, error) {
	return q.WakeDueDocuments(ctx)
}

// WakeOCRWaiting makes a team's documents waiting for the daily OCR page
// limit (every team's when team is not set) pending again and kicks the
// dispatcher: the limit changed. A document the limit still doesn't admit
// waits again. client may be insert-only; nil skips the kick (the periodic
// dispatch picks them up).
func WakeOCRWaiting(ctx context.Context, pool *pgxpool.Pool, client *river.Client[pgx.Tx], team uuid.NullUUID) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var err error
		n, err = dbgen.New(tx).WakeWaitingDocuments(ctx, dbgen.WakeWaitingDocumentsParams{ErrorCode: WaitOCRDailyLimit, TeamID: team})
		if err != nil || n == 0 || client == nil {
			return err
		}
		return Kick(ctx, client, tx)
	})
	return n, err
}

// asOCRWait unwraps a daily-limit wait.
func asOCRWait(err error) (*parse.OCRWait, bool) {
	var w *parse.OCRWait
	if errors.As(err, &w) && w.Until.After(time.Time{}) {
		return w, true
	}
	return nil, false
}
