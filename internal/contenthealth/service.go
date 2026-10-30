package contenthealth

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// CreateInput is a request for a report. Zero thresholds take the defaults; at most one of SourceID and KBID is set.
type CreateInput struct {
	StaleDays          int
	CitationWindowDays int
	SourceID           *uuid.UUID
	KBID               *uuid.UUID
}

// validate fills the defaults and checks the thresholds and the scope's shape.
func (in CreateInput) validate() (CreateInput, error) {
	if in.StaleDays == 0 {
		in.StaleDays = DefaultStaleDays
	}
	if in.CitationWindowDays == 0 {
		in.CitationWindowDays = DefaultCitationWindowDays
	}
	switch {
	case in.StaleDays < MinStaleDays || in.StaleDays > MaxStaleDays:
		return in, errStale
	case in.CitationWindowDays < MinCitationWindowDays || in.CitationWindowDays > MaxCitationWindowDays:
		return in, errWindow
	case in.SourceID != nil && in.KBID != nil:
		return in, errBothScopes
	}
	return in, nil
}

// Create queues a report of the team (editors, admins and owners of an active team, while the platform switch is on). It
// only inserts a row and a job: the work happens in the worker, never here. One report is in progress per team at a time,
// and a new one waits Cooldown after the previous one began. Audited with IDs and thresholds only.
func (s *Service) Create(ctx context.Context, a authz.Actor, teamRef string, in CreateInput) (Report, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return Report{}, err
	}
	if on, err := s.enabled(ctx); err != nil {
		return Report{}, err
	} else if !on {
		return Report{}, errOff
	}
	in, err = in.validate()
	if err != nil {
		return Report{}, err
	}
	if err := s.checkScope(ctx, acc.Team.ID, in); err != nil {
		return Report{}, err
	}
	var row dbgen.ContentHealthReport
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if err := s.checkCooldown(ctx, q, acc.Team.ID); err != nil {
			return err
		}
		row, err = q.InsertContentHealthReport(ctx, dbgen.InsertContentHealthReportParams{
			TeamID: acc.Team.ID, ScopeSourceID: optID(in.SourceID), ScopeKbID: optID(in.KBID),
			StaleDays: int32(in.StaleDays), CitationWindowDays: int32(in.CitationWindowDays), RequestedBy: nullID(a.UserID),
		})
		if err != nil {
			if apperr.IsUniqueViolation(err, "content_health_reports_active_key") {
				return errActive
			}
			return err
		}
		if _, err := q.PruneContentHealthReports(ctx, dbgen.PruneContentHealthReportsParams{TeamID: nullID(acc.Team.ID), Keep: KeepReports}); err != nil {
			return err
		}
		if s.Jobs != nil {
			if _, err := s.Jobs.InsertTx(ctx, tx, RunArgs{ReportID: row.ID}, nil); err != nil {
				return err
			}
		}
		e := a.Audit("content_health.generate", "content_health_report", row.ID.String())
		e.TeamID = acc.Team.ID
		e.Metadata = map[string]any{"staleDays": in.StaleDays, "citationWindowDays": in.CitationWindowDays}
		if in.SourceID != nil {
			e.Metadata["sourceId"] = in.SourceID.String()
		}
		if in.KBID != nil {
			e.Metadata["knowledgeBaseId"] = in.KBID.String()
		}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Report{}, err
	}
	return reportOf(row, nil), nil
}

// checkScope confirms the chosen source or knowledge base is the team's own; one that is not (or does not exist) is the
// same 404, so a report can't be used to find out whether another team has it.
func (s *Service) checkScope(ctx context.Context, teamID uuid.UUID, in CreateInput) error {
	switch {
	case in.SourceID != nil:
		src, err := s.q.GetSource(ctx, *in.SourceID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && (!src.TeamID.Valid || src.TeamID.UUID != teamID)) {
			return errNoScope
		}
		return err
	case in.KBID != nil:
		kb, err := s.q.GetKB(ctx, *in.KBID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && kb.TeamID != teamID) {
			return errNoScope
		}
		return err
	}
	return nil
}

// checkCooldown claims the team's turn, or refuses a report that would start before Cooldown has passed since the team's
// last one (a deleted report does not reset it). It runs in the report's transaction, so a refused report leaves it alone.
func (s *Service) checkCooldown(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID) error {
	n, err := q.ClaimContentHealthSlot(ctx, dbgen.ClaimContentHealthSlotParams{TeamID: teamID, CooldownSeconds: int32(s.cooldown() / time.Second)})
	if err != nil || n > 0 {
		return err
	}
	last, err := q.ContentHealthPacing(ctx, teamID)
	if err != nil {
		return err
	}
	e := apperr.New(429, "content_health_wait", "A report was made a moment ago. Try again in a few minutes.")
	e.RetryAfter = max(time.Until(last.Add(s.cooldown())), time.Second)
	return e
}

func (s *Service) cooldown() time.Duration {
	if s.Cooldown < 0 {
		return 0
	}
	return s.Cooldown
}

func optID(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return nullID(*id)
}

// Cancel stops a report that is queued or running. A queued one is cancelled at once; a running one stops at its next step
// and stores nothing more. It works while the platform switch is off too (a team can always stop what is being made), for the
// same people as every other action: nobody else, ever. Off, it returns the report as a stub, without what it found.
func (s *Service) Cancel(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (Report, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return Report{}, err
	}
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		n, err := q.CancelContentHealthReport(ctx, dbgen.CancelContentHealthReportParams{ID: id, TeamID: acc.Team.ID, RetentionDays: RetentionDays})
		if err != nil {
			return err
		}
		if n == 0 {
			if _, err := q.GetContentHealthReport(ctx, dbgen.GetContentHealthReportParams{ID: id, TeamID: acc.Team.ID}); err != nil {
				return notFoundReport(err)
			}
			return errEnded
		}
		e := a.Audit("content_health.cancel", "content_health_report", id.String())
		e.TeamID = acc.Team.ID
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Report{}, err
	}
	observability.ContentHealthReports.WithLabelValues(StatusCancelled).Inc()
	if on, err := s.enabled(ctx); err != nil {
		return Report{}, err
	} else if !on {
		row, err := s.q.GetContentHealthReport(ctx, dbgen.GetContentHealthReportParams{ID: id, TeamID: acc.Team.ID})
		return stubOf(row), notFoundReport(err)
	}
	return s.Get(ctx, a, teamRef, id)
}

// Delete removes a report that has ended, with its findings. It is always allowed to the team's editors, admins and owners of an
// active team, also while the platform switch is off: switching the feature off must not strand a copy nobody can remove. A report
// in progress must be cancelled first.
func (s *Service) Delete(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) error {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		rep, err := q.GetContentHealthReport(ctx, dbgen.GetContentHealthReportParams{ID: id, TeamID: acc.Team.ID})
		if err != nil {
			return notFoundReport(err)
		}
		if rep.Status == StatusQueued || rep.Status == StatusRunning {
			return errNotEnded
		}
		if _, err := q.DeleteContentHealthReport(ctx, dbgen.DeleteContentHealthReportParams{ID: id, TeamID: acc.Team.ID}); err != nil {
			return err
		}
		e := a.Audit("content_health.delete", "content_health_report", id.String())
		e.TeamID = acc.Team.ID
		return audit.Record(ctx, q, e)
	})
}

// requireEnabled answers 404 for a report route while the platform switch is off (reports stay stored).
func (s *Service) requireEnabled(ctx context.Context) error {
	on, err := s.enabled(ctx)
	if err != nil {
		return err
	}
	if !on {
		return errNotFound
	}
	return nil
}

func notFoundReport(err error) error {
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return errNoReport
	}
	return err
}
