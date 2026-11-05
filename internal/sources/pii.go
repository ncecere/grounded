package sources

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/pii"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// PII review actions (docs/pii-scanning.md).
const (
	PIIDismiss = "dismiss" // a flagged, indexed document: keep it as it is
	PIIApprove = "approve" // a held document: index it
)

// piiWarningPrefix starts the warning ingestion gives a flagged document (removed when the flag is dismissed).
const piiWarningPrefix = "May contain personal data:"

// ReviewPII records an editor's review of a document's possible personal data. Dismiss keeps a flagged document as
// it is; approve indexes a held one (it is queued again, and stays approved while its findings are the same). The
// review is audited with the kinds and counts found, never the matches (there are none to log).
func (s *Service) ReviewPII(ctx context.Context, a authz.Actor, o Owner, sourceID, docID uuid.UUID, action string) (dbgen.Document, error) {
	if action != PIIDismiss && action != PIIApprove {
		return dbgen.Document{}, apperr.Invalid("invalid_action", "action is dismiss or approve")
	}
	sc, _, cur, err := s.document(ctx, a, o, sourceID, docID, true)
	if err != nil {
		return dbgen.Document{}, err
	}
	if action == PIIApprove {
		if err := s.Maintenance.Check(ctx); err != nil {
			return dbgen.Document{}, err
		}
	}
	var doc dbgen.Document
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		var meta, warnings json.RawMessage
		var version int32
		if err := tx.QueryRow(ctx, "SELECT metadata, warnings, version FROM documents WHERE id = $1 FOR UPDATE", cur.ID).Scan(&meta, &warnings, &version); err != nil {
			return store.NotFound(err)
		}
		rec := pii.FromMetadata(meta)
		want := pii.StateFlagged
		if action == PIIApprove {
			want = pii.StateHeld
		}
		if rec == nil || rec.State != want || version != cur.Version {
			return apperr.Conflict("not_reviewable", "This document is not waiting for that review")
		}
		now, by := time.Now().UTC(), a.UserID
		rec.ReviewedAt, rec.ReviewedBy = &now, &by
		rec.State = pii.StateDismissed
		if action == PIIApprove {
			rec.State = pii.StateApproved
		}
		raw, err := json.Marshal(rec)
		if err != nil {
			return err
		}
		if err := q.SetDocumentPIIReview(ctx, dbgen.SetDocumentPIIReviewParams{ID: cur.ID, Pii: raw, Warnings: withoutPIIWarning(warnings)}); err != nil {
			return err
		}
		if action == PIIApprove {
			if _, err := q.RetryDocument(ctx, cur.ID); err != nil {
				return store.NotFound(err)
			}
			if err := ingest.Kick(ctx, s.Jobs, tx); err != nil {
				return err
			}
		}
		e := a.Audit("document.pii_"+action, "document", cur.ID.String())
		e.TeamID = sc.auditTeam()
		e.Metadata = map[string]any{"sourceId": sourceID.String(), "findings": findingCounts(rec.Findings)}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		doc, err = q.GetDocument(ctx, cur.ID)
		return err
	})
	return doc, err
}

func withoutPIIWarning(raw json.RawMessage) json.RawMessage {
	var list []string
	_ = json.Unmarshal(raw, &list)
	kept := []string{}
	for _, w := range list {
		if !strings.HasPrefix(w, piiWarningPrefix) {
			kept = append(kept, w)
		}
	}
	out, _ := json.Marshal(kept)
	return out
}

// findingCounts is what the audit log keeps of a review: the kinds and their counts.
func findingCounts(findings []pii.Finding) map[string]int {
	out := map[string]int{}
	for _, f := range findings {
		out[f.Kind] = f.Count
	}
	return out
}
