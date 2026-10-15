package profilemig

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var errNotReady = apperr.Conflict("migration_not_ready", "This migration is not waiting to be switched")

// Evaluate starts the comparison of a ready held migration again (live index against candidate, over the knowledge base's evaluation
// sets), for after documents changed or the candidate caught up. It returns how many sets it started, and refuses while a comparison is
// still running (409 preview_running) or when the migration is not ready.
func (s *Service) Evaluate(ctx context.Context, a authz.Actor, id uuid.UUID) (int, error) {
	if !a.IsPlatformAdmin() {
		return 0, errAdminOnly
	}
	started := 0
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if err := q.LockProfileMigrations(ctx); err != nil {
			return err
		}
		m, err := q.LockProfileMigration(ctx, id)
		if err != nil {
			return errNotFound
		}
		if m.Status != StatusReady {
			return errNotReady
		}
		if s.OnPreviewReady != nil {
			if started, err = s.OnPreviewReady(ctx, tx, m.KBID, m.ID, m.FromProfileID, m.ToProfileID); err != nil {
				return err
			}
		}
		e := a.Audit("kb.profile_preview_evaluate", "knowledge_base", m.KBID.String())
		e.TeamID, e.Metadata = m.TeamID, mergeMeta(e.Metadata, s.meta(m, map[string]any{"evaluationSets": started}))
		return audit.Record(ctx, q, e)
	})
	return started, err
}
