package ingest

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/pii"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// heldError stops indexing a document held for a review of possible personal data (docs/pii-scanning.md).
type heldError struct{ rec *pii.Record }

func (e *heldError) Error() string { return pii.ErrReview.Error() }
func (e *heldError) Unwrap() error { return pii.ErrReview }

// scanPII scans a parsed document with the platform's settings: nil when scanning is off or nothing was found. The
// previous review is kept while the findings are the same; a classification to hold returns a heldError.
func (p *Processor) scanPII(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, doc dbgen.Document, parsed parse.Document) (*pii.Record, error) {
	sc, err := pii.Load(ctx, q)
	if err != nil || !sc.Enabled {
		return nil, err
	}
	rec := pii.Decide(pii.FromMetadata(doc.Metadata), pii.Scan(parsed.Markdown, sc.Patterns), pii.Holds(sc.BlockLevels, src.Classification))
	if rec != nil && rec.State == pii.StateHeld {
		return rec, &heldError{rec: rec}
	}
	return rec, nil
}

// heldRecord is the record of a held document (nil for any other error).
func heldRecord(err error) *pii.Record {
	var h *heldError
	if errors.As(err, &h) {
		return h.rec
	}
	return nil
}

// piiWarning is the warning an indexed document with findings shows (the review's state is in metadata.pii).
func piiWarning(rec *pii.Record) string {
	if rec == nil || rec.State != pii.StateFlagged {
		return ""
	}
	return "May contain personal data: " + pii.Summary(rec.Findings) + ". Review it, then dismiss the flag or remove the document."
}

// heldMessage is a held document's error message.
func heldMessage(rec *pii.Record) string {
	return "Held for review before indexing: it may contain personal data (" + pii.Summary(rec.Findings) +
		"). An editor can approve it to index it, or remove it."
}

// setPIIRecord records a document's findings and review (metadata.pii), or removes them when rec is nil.
func setPIIRecord(ctx context.Context, q *dbgen.Queries, doc dbgen.Document, rec *pii.Record) error {
	raw := json.RawMessage("null")
	if rec != nil {
		var err error
		if raw, err = json.Marshal(rec); err != nil {
			return err
		}
	}
	return q.SetDocumentPII(ctx, dbgen.SetDocumentPIIParams{ID: doc.ID, Pii: raw})
}
