// Starting, cancelling, retrying and finishing migrations (platform admins;
// audited with counts only).

package profilemig

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var timeNow = time.Now

// StartInput starts a migration. GraceDays nil uses the install default.
type StartInput struct {
	KBID, TargetProfileID uuid.UUID
	GraceDays             *int32
}

// BlockedError refuses a migration with its preflight blockers.
func blockedError(pf Preflight) error {
	list := make([]map[string]any, len(pf.Blockers))
	for i, b := range pf.Blockers {
		list[i] = map[string]any{"code": b.Code, "message": b.Message}
	}
	return &apperr.Error{Status: 409, Code: "migration_blocked", Message: pf.Blockers[0].Message, Details: map[string]any{"blockers": list}}
}

// Start begins moving a KB to the target profile.
func (s *Service) Start(ctx context.Context, a authz.Actor, in StartInput) (Migration, error) {
	if !a.IsPlatformAdmin() {
		return Migration{}, errAdminOnly
	}
	grace := int32(s.Opts.GraceDays)
	if in.GraceDays != nil {
		grace = *in.GraceDays
	}
	if grace < 0 || grace > 90 {
		return Migration{}, apperr.Invalid("invalid_grace_days", "The grace period must be between 0 and 90 days")
	}
	pf, err := s.Preflight(ctx, a, in.KBID, in.TargetProfileID)
	if err != nil {
		return Migration{}, err
	}
	if len(pf.Blockers) > 0 {
		return Migration{}, blockedError(pf)
	}
	estimate, _ := json.Marshal(pf.Estimate)
	var id uuid.UUID
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if err := q.LockProfileMigrations(ctx); err != nil {
			return err
		}
		kb, err := q.LockKB(ctx, in.KBID)
		if err != nil {
			return err
		}
		if kb.EmbeddingProfileID != pf.From.ID {
			return apperr.Stale()
		}
		m, err := q.InsertProfileMigration(ctx, dbgen.InsertProfileMigrationParams{
			KBID: kb.ID, TeamID: kb.TeamID, FromProfileID: pf.From.ID, ToProfileID: pf.Target.ID, GraceDays: grace,
			Estimate: estimate, StartedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		})
		if apperr.IsUniqueViolation(err, "profile_migrations_one_active") {
			return apperr.Conflict("migration_active", "Another migration of this knowledge base is running or in its grace period")
		} else if err != nil {
			return err
		}
		id = m.ID
		if err := s.addSets(ctx, q, tx, kb.ID, pf.Target.ID); err != nil {
			return err
		}
		e := a.Audit("kb.profile_migration_start", "knowledge_base", kb.ID.String())
		e.TeamID, e.Metadata = kb.TeamID, mergeMeta(e.Metadata, s.meta(m, map[string]any{
			"sources": len(pf.Sources), "documents": pf.Estimate.Documents, "passages": pf.Estimate.Passages,
			"embeddingCalls": pf.Estimate.EmbeddingCalls, "rechunk": pf.Estimate.Rechunk, "graceDays": grace,
		}))
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Migration{}, err
	}
	// A KB without sources, or whose sources already have the target's
	// vectors (another KB moved them), switches at once.
	if err := s.Advance(ctx, id); err != nil {
		return Migration{}, err
	}
	return s.load(ctx, id, true)
}

// addSets gives each of the KB's sources an embedding set for the profile
// (unless it is the source's own) and enqueues their embedding.
func (s *Service) addSets(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, kbID, profileID uuid.UUID) error {
	sources, err := q.KBSources(ctx, kbID)
	if err != nil {
		return err
	}
	ids := make([]uuid.UUID, len(sources))
	for i, src := range sources {
		if src.EmbeddingProfileID != profileID {
			if _, err := q.InsertEmbeddingSet(ctx, dbgen.InsertEmbeddingSetParams{SourceID: src.ID, ProfileID: profileID, Status: "building"}); err != nil {
				return err
			}
		}
		ids[i] = src.ID
	}
	return s.kickSets(ctx, tx, ids, profileID)
}

// meta is a migration's audit metadata (counts and IDs only).
func (s *Service) meta(m dbgen.ProfileMigration, extra map[string]any) map[string]any {
	out := map[string]any{"migrationId": m.ID.String(), "fromProfileId": m.FromProfileID.String(), "toProfileId": m.ToProfileID.String()}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func mergeMeta(a, b map[string]any) map[string]any {
	if a == nil {
		return b
	}
	for k, v := range b {
		a[k] = v
	}
	return a
}

// change runs an admin action on a migration at its expected revision.
func (s *Service) change(ctx context.Context, a authz.Actor, id uuid.UUID, rev int64, fn func(q *dbgen.Queries, tx pgx.Tx, m dbgen.ProfileMigration) error) (Migration, error) {
	if !a.IsPlatformAdmin() {
		return Migration{}, errAdminOnly
	}
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if err := q.LockProfileMigrations(ctx); err != nil {
			return err
		}
		m, err := q.LockProfileMigration(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNotFound
		} else if err != nil {
			return err
		}
		if m.Revision != rev {
			return apperr.Stale()
		}
		return fn(q, tx, m)
	})
	if err != nil {
		return Migration{}, err
	}
	return s.load(ctx, id, true)
}

func (s *Service) record(ctx context.Context, q *dbgen.Queries, a authz.Actor, action string, m dbgen.ProfileMigration, extra map[string]any) error {
	e := a.Audit(action, "knowledge_base", m.KBID.String())
	e.TeamID, e.Metadata = m.TeamID, mergeMeta(e.Metadata, s.meta(m, extra))
	return audit.Record(ctx, q, e)
}

var errNotRunning = apperr.Conflict("migration_not_running", "This migration is no longer running")

// Cancel stops a running migration. The KB keeps its profile; the new
// vectors are deleted by the cleanup job (a shared source keeps them while
// another KB's migration or search needs them).
func (s *Service) Cancel(ctx context.Context, a authz.Actor, id uuid.UUID, rev int64) (Migration, error) {
	return s.change(ctx, a, id, rev, func(q *dbgen.Queries, tx pgx.Tx, m dbgen.ProfileMigration) error {
		if m.Status != StatusRunning {
			return errNotRunning
		}
		m, err := q.FinishProfileMigration(ctx, dbgen.FinishProfileMigrationParams{Status: StatusCancelled, ID: m.ID,
			FinishedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}})
		if err != nil {
			return err
		}
		if err := s.record(ctx, q, a, "kb.profile_migration_cancel", m, nil); err != nil {
			return err
		}
		return s.kickCleanup(ctx, tx)
	})
}

// Retry clears a running migration's failed documents so they are
// embedded again.
func (s *Service) Retry(ctx context.Context, a authz.Actor, id uuid.UUID, rev int64) (Migration, error) {
	return s.change(ctx, a, id, rev, func(q *dbgen.Queries, tx pgx.Tx, m dbgen.ProfileMigration) error {
		if m.Status != StatusRunning {
			return errNotRunning
		}
		sources, err := q.KBSources(ctx, m.KBID)
		if err != nil {
			return err
		}
		ids := make([]uuid.UUID, len(sources))
		for i, src := range sources {
			ids[i] = src.ID
		}
		n, err := q.ClearSetFailures(ctx, dbgen.ClearSetFailuresParams{SourceIds: ids, ProfileID: m.ToProfileID})
		if err != nil {
			return err
		}
		if err := q.SetMigrationAttention(ctx, dbgen.SetMigrationAttentionParams{ID: m.ID}); err != nil {
			return err
		}
		if err := s.record(ctx, q, a, "kb.profile_migration_retry", m, map[string]any{"documents": n}); err != nil {
			return err
		}
		return s.kickSets(ctx, tx, ids, m.ToProfileID)
	})
}

// Finish ends a switched migration's grace period now: switching back is
// no longer possible and the old vectors are deleted.
func (s *Service) Finish(ctx context.Context, a authz.Actor, id uuid.UUID, rev int64) (Migration, error) {
	return s.change(ctx, a, id, rev, func(q *dbgen.Queries, tx pgx.Tx, m dbgen.ProfileMigration) error {
		if m.Status != StatusSwitched {
			return apperr.Conflict("migration_not_switched", "Only a switched migration in its grace period can be finished")
		}
		if err := q.EndGraceNow(ctx, m.ID); err != nil {
			return err
		}
		m, err := q.FinishProfileMigration(ctx, dbgen.FinishProfileMigrationParams{Status: StatusCompleted, ID: m.ID,
			FinishedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}})
		if err != nil {
			return err
		}
		if err := s.record(ctx, q, a, "kb.profile_migration_finish", m, nil); err != nil {
			return err
		}
		return s.kickCleanup(ctx, tx)
	})
}

func (s *Service) kickSets(ctx context.Context, tx pgx.Tx, sourceIDs []uuid.UUID, profileID uuid.UUID) error {
	for _, id := range sourceIDs {
		if err := ingest.KickSet(ctx, s.Jobs, tx, id, profileID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) kickCleanup(ctx context.Context, tx pgx.Tx) error {
	if s.Jobs == nil {
		return nil
	}
	_, err := s.Jobs.InsertTx(ctx, tx, CleanupArgs{}, nil)
	return err
}
