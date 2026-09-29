// Documents that failed or need OCR, for platform admins (Admin -> Parsing
// & OCR; owner decision 3 of docs/v0.2.0.md §7, docs/ocr.md §5). Admins may
// not read a team's documents (DESIGN §3.4), so they get counts per team,
// source and reason class with the oldest date, and never a document's file
// name, title, URL or text. They can queue a group again ("Retry these")
// and tell the team's owners ("Notify owners"); both are audited with the
// count only.

package sources

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/ocr"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Reason classes of documents that need attention (the CASE in
// queries/document_problems.sql).
const (
	ProblemNeedsOCR = "needs_ocr" // skipped as scanned: OCR was off
	ProblemOCRError = "ocr_error" // OCR failed (error codes ocr_*)
	ProblemDamaged  = "damaged"   // corrupt, encrypted, unsupported or too large
	ProblemOther    = "other"     // any other failure
)

var problemReasons = map[string]bool{ProblemNeedsOCR: true, ProblemOCRError: true, ProblemDamaged: true, ProblemOther: true}

// ProblemGroup is one source's documents of one reason class.
type ProblemGroup struct {
	TeamID             uuid.NullUUID // null: a platform-shared source
	TeamSlug, TeamName string
	SourceID           uuid.UUID
	SourceName         string
	Reason             string
	Documents          int64
	Oldest             time.Time
	// OCRState says whether OCR can read the source now (ocr.State*).
	OCRState string
}

var (
	errProblemsReadOnly  = apperr.Forbidden("Only platform admins and auditors can see documents that need attention")
	errProblemsAdminOnly = apperr.Forbidden("Only platform admins can retry documents or notify owners")
	errProblemReason     = apperr.Invalid("invalid_reason", "The reason must be needs_ocr, ocr_error, damaged or other")
)

// DocumentProblems lists every source's failed and needs-OCR documents by
// reason class (platform admins and auditors), with no document names.
func (s *Service) DocumentProblems(ctx context.Context, a authz.Actor) ([]ProblemGroup, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return nil, errProblemsReadOnly
	}
	rows, err := s.q.ListDocumentProblems(ctx)
	if err != nil {
		return nil, err
	}
	states := map[uuid.UUID]string{}
	out := make([]ProblemGroup, 0, len(rows))
	for _, r := range rows {
		st, ok := states[r.SourceID]
		if !ok {
			if st, err = s.ocrStateOf(ctx, r.SourceID); err != nil {
				return nil, err
			}
			states[r.SourceID] = st
		}
		out = append(out, ProblemGroup{TeamID: r.TeamID, TeamSlug: r.TeamSlug, TeamName: r.TeamName, SourceID: r.SourceID, SourceName: r.SourceName,
			Reason: r.Reason, Documents: r.Documents, Oldest: r.Oldest, OCRState: st})
	}
	return out, nil
}

func (s *Service) ocrStateOf(ctx context.Context, id uuid.UUID) (string, error) {
	src, err := s.q.GetSource(ctx, id)
	if err != nil {
		return "", err
	}
	return s.OCR.State(ctx, src)
}

// problemSource is the source of an admin action on its documents, with its
// team (nil for a shared source).
func (s *Service) problemSource(ctx context.Context, a authz.Actor, id uuid.UUID, reason string) (dbgen.DataSource, *dbgen.Team, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return dbgen.DataSource{}, nil, errProblemsAdminOnly
	}
	if !problemReasons[reason] {
		return dbgen.DataSource{}, nil, errProblemReason
	}
	src, err := s.q.GetSource(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return src, nil, errNoSource
	}
	if err != nil || !src.TeamID.Valid {
		return src, nil, err
	}
	t, err := s.q.GetTeamByID(ctx, src.TeamID.UUID)
	if err != nil {
		return src, nil, err
	}
	if t.Status != teams.StatusActive {
		return src, nil, apperr.Conflict("team_archived", "This team is archived and read-only")
	}
	return src, &t, nil
}

// ocrOffMessages explain why documents that need OCR can't be retried yet.
var ocrOffMessages = map[string]string{
	ocr.StatePlatformOff: "OCR is off for the platform (or its backend is unusable), so these documents would be skipped again. Turn OCR on first.",
	ocr.StateSourceOff:   "OCR is off for this source: its team turned it off in the source's settings, so these documents would be skipped again. Notify the owners instead.",
	ocr.StateNotApproved: "The OCR vision model isn't approved for this source's classification, so these documents would be skipped again.",
}

// RetryProblems queues one source's documents of one reason class again
// (platform admins). Documents that need OCR, or whose OCR failed, are
// retried only while OCR can read the source (409 ocr_off, saying why). The
// retry is audited as platform.documents_retry with the count.
func (s *Service) RetryProblems(ctx context.Context, a authz.Actor, sourceID uuid.UUID, reason string) (int, error) {
	src, team, err := s.problemSource(ctx, a, sourceID, reason)
	if err != nil {
		return 0, err
	}
	if reason == ProblemNeedsOCR || reason == ProblemOCRError {
		st, err := s.OCR.State(ctx, src)
		if err != nil {
			return 0, err
		}
		if st != ocr.StateOn {
			return 0, apperr.Conflict("ocr_off", ocrOffMessages[st])
		}
	}
	if err := s.Maintenance.Check(ctx); err != nil {
		return 0, err
	}
	var n int
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		ids, err := q.RetryDocumentProblems(ctx, dbgen.RetryDocumentProblemsParams{SourceID: src.ID, Reason: reason})
		if err != nil || len(ids) == 0 {
			return err
		}
		n = len(ids)
		e := a.Audit("platform.documents_retry", "data_source", src.ID.String())
		if team != nil {
			e.TeamID = team.ID
		}
		e.Metadata = map[string]any{"sourceName": src.Name, "reason": reason, "count": n, "shared": team == nil}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		return ingest.Kick(ctx, s.Jobs, tx)
	})
	return n, err
}

// NotifyProblems tells a team's owners about one source's documents of one
// reason class (platform admins): the notification source.documents_attention,
// which can't be turned off, with the count and a link to the source's
// documents. It returns how many owners were told and the count. Audited as
// platform.document_owners_notify.
func (s *Service) NotifyProblems(ctx context.Context, a authz.Actor, sourceID uuid.UUID, reason string) (owners, documents int64, err error) {
	src, team, err := s.problemSource(ctx, a, sourceID, reason)
	if err != nil {
		return 0, 0, err
	}
	if team == nil {
		return 0, 0, apperr.Conflict("no_team", "A shared source has no team owners to notify")
	}
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		c, err := q.CountDocumentProblems(ctx, dbgen.CountDocumentProblemsParams{SourceID: src.ID, Reason: reason})
		if err != nil {
			return err
		}
		if c.Documents == 0 {
			return apperr.Conflict("no_documents", "This source has no such documents any more")
		}
		documents = c.Documents
		if owners, err = q.CountOwners(ctx, team.ID); err != nil {
			return err
		}
		e := a.Audit("platform.document_owners_notify", "data_source", src.ID.String())
		e.TeamID = team.ID
		e.Metadata = map[string]any{"sourceName": src.Name, "reason": reason, "count": c.Documents, "owners": owners}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		ev := notify.DocumentsAttentionEvent(notify.TeamRef{ID: team.ID, Slug: team.Slug, Name: team.Name},
			notify.DocumentProblems{SourceID: src.ID, SourceName: src.Name, Reason: reason, Documents: c.Documents, Oldest: c.Oldest})
		return s.Notify.Emit(ctx, tx, ev.By(a.UserID))
	})
	return owners, documents, err
}
