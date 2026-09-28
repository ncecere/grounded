// Maintenance mode for web sources (docs/phase5-deploy.md §5 P5): no crawl
// starts, not even on a schedule, and the site map preview refuses. A run
// already going finishes the page it is on, then waits (reason
// "maintenance") with its job snoozed, and continues by itself once
// maintenance ends.

package web

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// WaitingMaintenance: the run is parked until maintenance mode ends.
const WaitingMaintenance = "maintenance"

// MaintenancePoll is how often a parked run checks whether maintenance mode
// has ended.
const MaintenancePoll = 10 * time.Second

// checkMaintenance refuses to start new crawling while maintenance mode is
// on (503 maintenance_mode).
func (s *Service) checkMaintenance(ctx context.Context) error {
	return s.Maintenance.Check(ctx)
}

// parkIfMaintenance parks run id while maintenance mode is on: it records
// the waiting reason and returns the job's snooze. It returns nil when the
// run may continue.
func (s *Service) parkIfMaintenance(ctx context.Context, id uuid.UUID, waiting string) error {
	paused, err := s.Maintenance.Paused(ctx)
	if err != nil || !paused {
		return err
	}
	if waiting != WaitingMaintenance {
		if err := s.q.SetCrawlWaiting(ctx, dbgen.SetCrawlWaitingParams{ID: id, WaitingReason: WaitingMaintenance}); err != nil {
			return err
		}
	}
	return river.JobSnooze(MaintenancePoll)
}
