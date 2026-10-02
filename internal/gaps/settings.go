// A team's gap report settings (owner decision 4 of 2026-10-01): "Confirm
// similar questions with SystemOne", off by default. Editors, admins and
// owners read and change them on the Gaps page (If-Match; audited).

package gaps

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Settings are a team's gap report settings.
type Settings struct {
	ConfirmSimilar bool
	Revision       int64
	// UpdatedAt is nil until they are saved.
	UpdatedAt *time.Time
}

// Settings returns the team's settings (the defaults when never saved).
func (s *Service) Settings(ctx context.Context, a authz.Actor, teamRef string) (Settings, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return Settings{}, err
	}
	row, err := s.q.GetGapSettings(ctx, acc.Team.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{Revision: 1}, nil
	}
	return Settings{ConfirmSimilar: row.ConfirmSimilar, Revision: row.Revision, UpdatedAt: &row.UpdatedAt}, err
}

// SetSettings saves the team's settings when expectedRevision is current
// (audited as gap_settings.update).
func (s *Service) SetSettings(ctx context.Context, a authz.Actor, teamRef string, confirmSimilar bool, expectedRevision int64) (Settings, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return Settings{}, err
	}
	var out Settings
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		// The row is created first, so concurrent saves serialise on it.
		if err := q.EnsureGapSettings(ctx, acc.Team.ID); err != nil {
			return err
		}
		cur, err := q.LockGapSettings(ctx, acc.Team.ID)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		next, err := q.UpdateGapSettings(ctx, dbgen.UpdateGapSettingsParams{TeamID: acc.Team.ID, ConfirmSimilar: confirmSimilar,
			UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}})
		if err != nil {
			return err
		}
		out = Settings{ConfirmSimilar: next.ConfirmSimilar, Revision: next.Revision, UpdatedAt: &next.UpdatedAt}
		e := a.Audit("gap_settings.update", "gap_settings", acc.Team.ID.String())
		e.TeamID = acc.Team.ID
		e.Before, e.After = map[string]any{"confirmSimilar": cur.ConfirmSimilar}, map[string]any{"confirmSimilar": next.ConfirmSimilar}
		return audit.Record(ctx, q, e)
	})
	return out, err
}
