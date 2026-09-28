// Runs waiting for their team's monthly budget (docs/costs.md §4). When a
// team's enforced budget is used up, a run parks (reason "monthly_budget")
// with its job snoozed, like the daily page limit (dailylimit.go): the pages
// it would fetch become documents that couldn't be embedded anyway. It
// continues when the month ends, or at once when an admin raises the budget
// or grants an extension: the costs service's OnChange hook (BudgetChanged)
// wakes it, and a parked run re-checks every DailyLimitRecheck in case a
// wake was missed.

package web

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// WaitingBudget: the run waits for the team's monthly budget.
const WaitingBudget = "monthly_budget"

// BudgetGate reports whether a team's enforced monthly budget is used up,
// and when it resets (internal/costs).
type BudgetGate interface {
	Blocked(ctx context.Context, teamID uuid.UUID) (bool, time.Time, error)
}

// parkIfBudget parks run cr while its team's budget is used up: it records
// the waiting reason and returns the job's snooze. It returns nil when the
// run may continue.
func (s *Service) parkIfBudget(ctx context.Context, cr dbgen.WebCrawl, team uuid.NullUUID) error {
	if s.Budget == nil || !team.Valid {
		return nil
	}
	blocked, resets, err := s.Budget.Blocked(ctx, team.UUID)
	if err != nil || !blocked {
		return err
	}
	if cr.WaitingReason != WaitingBudget || cr.WaitingUntil == nil || !cr.WaitingUntil.Equal(resets) {
		if err := s.q.SetCrawlWaiting(ctx, dbgen.SetCrawlWaitingParams{ID: cr.ID, WaitingReason: WaitingBudget, WaitingUntil: &resets}); err != nil {
			return err
		}
	}
	return river.JobSnooze(dailyLimitSnooze(time.Now(), resets))
}

// WakeBudgetWaiting makes runs waiting for their team's budget check it
// again now: team's runs, or every team's when team is not set. A run whose
// budget is still used up parks again. It returns how many were woken.
func (s *Service) WakeBudgetWaiting(ctx context.Context, team uuid.NullUUID) (int, error) {
	if s.Jobs == nil {
		return 0, nil
	}
	ids, err := s.q.BudgetWaitingCrawls(ctx, team)
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	return s.wake(ctx, ids)
}

// BudgetChanged is the costs service's OnChange hook: runs waiting for
// their team's budget check it now. A failure only delays them to their
// next recheck.
func (s *Service) BudgetChanged(ctx context.Context, team uuid.NullUUID) {
	n, err := s.WakeBudgetWaiting(context.WithoutCancel(ctx), team)
	if err != nil {
		s.Log.WarnContext(ctx, "could not wake crawls waiting for the monthly budget", "team", team.UUID, "err", err)
		return
	}
	if n > 0 {
		s.Log.InfoContext(ctx, "woke crawls waiting for the monthly budget", "team", team.UUID, "crawls", n)
	}
}
