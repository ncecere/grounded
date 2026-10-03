package agents

import (
	"context"
	"time"

	"github.com/ncecere/grounded/internal/costs"
)

// Today's date for the model ("Today is Friday, October 2, 2026") and the
// saved answers' day key (cache.go) is the platform's: the time zone of
// Admin → Costs settings (cost_settings.time_zone, docs/costs.md), which
// also bounds months and budgets. Before v0.4.1 both were UTC's, so an
// evening answer in New York said tomorrow's weekday. UTC when the settings
// can't be read or this build's time zone database doesn't know the zone.

// platformZone reads the platform's time zone.
func (s *Service) platformZone(ctx context.Context) *time.Location {
	st, err := s.q.GetCostSettings(ctx)
	if err != nil {
		s.Log.WarnContext(ctx, "platform time zone unavailable; dates use UTC", "err", err)
		return time.UTC
	}
	return zoneOf(st.TimeZone)
}

// zoneOf loads a stored zone name, UTC for one this build doesn't know.
func zoneOf(name string) *time.Location {
	loc, err := costs.LoadZone(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

// now is the answer's current time in the platform's zone, read once, so
// its prompt and its saved-answer key agree on the day.
func (ru *run) now(ctx context.Context) time.Time {
	if ru.clock.IsZero() {
		ru.clock = time.Now().In(ru.s.platformZone(ctx))
	}
	return ru.clock
}
