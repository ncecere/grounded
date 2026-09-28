// Runs waiting for the next day's crawled-page quota (crawl_pages_per_day).
// A run that used up today's pages parks (reason "daily_page_limit") with
// its job snoozed. It continues on its own at the next UTC day, or sooner
// when an admin raises the limit: the limits service's OnChange hook
// (LimitsChanged) wakes it after every change (a team's override, or a
// platform default), and a parked run re-checks the limit every
// DailyLimitRecheck in case a wake was missed (a failed call).

package web

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
)

// DailyLimitRecheck is how often a run waiting for the next day's quota
// checks whether the limit was raised.
const DailyLimitRecheck = 15 * time.Minute

// dailyLimitSnooze is how long a parked run sleeps before its next check.
func dailyLimitSnooze(now, until time.Time) time.Duration {
	return min(until.Sub(now)+time.Second, DailyLimitRecheck)
}

// WakeDailyLimited makes runs waiting for the next day's quota check their
// limit again now: team's runs, or every team's when team is not set (a
// platform default changed). A run whose limit still leaves no pages parks
// again. It returns how many runs were woken.
func (s *Service) WakeDailyLimited(ctx context.Context, team uuid.NullUUID) (int, error) {
	if s.Jobs == nil {
		return 0, nil
	}
	ids, err := s.q.DailyLimitedCrawls(ctx, team)
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	pending := map[string]bool{}
	for _, id := range ids {
		pending[id.String()] = true
	}
	// A run that has just parked may not have its snooze recorded yet (River
	// records job results in batches, every 50ms): its job still reads
	// running. Look again shortly for those.
	woken := 0
	for try := 0; try < wakeTries && len(pending) > 0; try++ {
		if try > 0 {
			select {
			case <-ctx.Done():
				return woken, ctx.Err()
			case <-time.After(wakeRetryDelay):
			}
		}
		n, err := s.retryParked(ctx, pending)
		woken += n
		if err != nil {
			return woken, err
		}
	}
	return woken, nil
}

// Waking a run whose job is not snoozed yet: how often to look, and how
// long to wait in between.
const (
	wakeTries      = 3
	wakeRetryDelay = 200 * time.Millisecond
)

// retryParked makes the snoozed jobs of the pending runs available now and
// removes those runs from pending.
func (s *Service) retryParked(ctx context.Context, pending map[string]bool) (int, error) {
	crawlIDs := make([]string, 0, len(pending))
	for id := range pending {
		crawlIDs = append(crawlIDs, id)
	}
	// Snoozed jobs are scheduled.
	params := river.NewJobListParams().
		Kinds(CrawlArgs{}.Kind()).
		States(rivertype.JobStateScheduled).
		Where("args->>'crawlId' = ANY(@crawl_ids::text[])", river.NamedArgs{"crawl_ids": crawlIDs}).
		First(len(crawlIDs))
	res, err := s.Jobs.JobList(ctx, params)
	if err != nil {
		return 0, err
	}
	woken := 0
	for _, j := range res.Jobs {
		var args CrawlArgs
		if err := json.Unmarshal(j.EncodedArgs, &args); err != nil {
			return woken, err
		}
		if _, err := s.Jobs.JobRetry(ctx, j.ID); err != nil {
			return woken, err
		}
		delete(pending, args.CrawlID.String())
		woken++
	}
	return woken, nil
}

// LimitsChanged is the limits service's OnChange hook: runs waiting for
// the next day's quota check the new limit now. A failure only delays them
// to their next recheck.
func (s *Service) LimitsChanged(ctx context.Context, team uuid.NullUUID) {
	n, err := s.WakeDailyLimited(context.WithoutCancel(ctx), team)
	if err != nil {
		s.Log.WarnContext(ctx, "could not wake crawls waiting for the daily page limit", "team", team.UUID, "err", err)
		return
	}
	if n > 0 {
		s.Log.InfoContext(ctx, "woke crawls waiting for the daily page limit", "team", team.UUID, "crawls", n)
	}
}
