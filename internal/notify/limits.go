package notify

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// DailyLimitReached records that a team used up a daily limit, once per
// team, limit and UTC day. It is the limits service's OnDailyLimit hook, so
// repeat calls on the same day return without touching the database.
func (s *Service) DailyLimitReached(ctx context.Context, teamID uuid.UUID, key, noun string, max int64) {
	if s == nil {
		return
	}
	ev := DailyLimitReachedEvent(TeamRef{ID: teamID}, key, noun, max, s.now())
	if _, dup := s.seen.Load(ev.DedupeKey); dup {
		return
	}
	t, err := s.q.GetTeamByID(context.WithoutCancel(ctx), teamID)
	if err != nil {
		s.Log.WarnContext(ctx, "could not load team for notification", "team", teamID, "err", err)
		return
	}
	s.EmitNow(ctx, DailyLimitReachedEvent(TeamRef{ID: t.ID, Slug: t.Slug, Name: t.Name}, key, noun, max, s.now()))
}

// BudgetReached records a team reaching its budget threshold or using up
// its budget, in tx (the costs service's OnNotice hook, which records the
// notice once per team, month and level in the same transaction).
func (s *Service) BudgetReached(ctx context.Context, tx pgx.Tx, teamID uuid.UUID, n BudgetNotice) error {
	if s == nil {
		return nil
	}
	t, err := dbgen.New(tx).GetTeamByID(ctx, teamID)
	if err != nil {
		return err
	}
	return s.Emit(ctx, tx, BudgetEvent(TeamRef{ID: t.ID, Slug: t.Slug, Name: t.Name}, n))
}
