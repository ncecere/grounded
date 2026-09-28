package notify

import (
	"context"

	"github.com/google/uuid"
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
