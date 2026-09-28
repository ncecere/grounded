package web

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Queue is the River queue for crawl jobs; its worker count
// (CRAWL_CONCURRENCY) bounds concurrent crawls per worker process.
const Queue = "web"

// Per-invocation budget: a crawl job processes this much, then snoozes
// itself so worker slots are shared fairly and shutdown is quick.
const (
	DefaultPageBudget = 200
	DefaultTimeBudget = 10 * time.Minute
)

// CrawlArgs processes one crawl run.
type CrawlArgs struct {
	CrawlID uuid.UUID `json:"crawlId"`
}

func (CrawlArgs) Kind() string { return "web.crawl" }

func (CrawlArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: 10}
}

// CrawlWorker runs crawl jobs.
type CrawlWorker struct {
	river.WorkerDefaults[CrawlArgs]
	S          *Service
	PageBudget int           // default DefaultPageBudget
	TimeBudget time.Duration // default DefaultTimeBudget
}

func (w *CrawlWorker) timeBudget() time.Duration {
	if w.TimeBudget > 0 {
		return w.TimeBudget
	}
	return DefaultTimeBudget
}

func (w *CrawlWorker) Timeout(*river.Job[CrawlArgs]) time.Duration {
	return w.timeBudget() + 5*time.Minute
}

func (w *CrawlWorker) Work(ctx context.Context, job *river.Job[CrawlArgs]) (err error) {
	defer func() {
		var snooze *rivertype.JobSnoozeError
		if err != nil && !errors.As(err, &snooze) && job.Attempt >= job.MaxAttempts {
			// Final attempt: record the failure so the source can sync again.
			w.S.Log.ErrorContext(ctx, "crawl failed", "crawl", job.Args.CrawlID, "err", err)
			if cr, gerr := w.S.q.GetCrawl(context.WithoutCancel(ctx), job.Args.CrawlID); gerr == nil {
				_ = w.S.fail(ctx, cr.ID, cr.TeamID, CrawlFailed, "The crawl stopped after repeated internal errors.")
			}
		}
	}()
	budget := w.PageBudget
	if budget <= 0 {
		budget = DefaultPageBudget
	}
	return w.S.runCrawl(ctx, job.Args.CrawlID, budget, w.timeBudget())
}

// run is one invocation of a crawl job.
type run struct {
	s        *Service
	crawl    dbgen.WebCrawl
	src      dbgen.DataSource
	cfg      Config
	scope    crawl.Scope
	frontier int64 // rows in the frontier
	// flushed is pages_fetched when page_crawled usage was last recorded.
	flushed int32
}

// limitStop ends a run early because a team resource cap (documents or
// storage) was reached. The run is marked truncated with reason.
type limitStop struct{ reason string }

func (e *limitStop) Error() string { return "crawl stopped: " + e.reason }

func truncatedReason(k limits.Key) string {
	if k == limits.StorageBytes {
		return TruncatedStorage
	}
	return TruncatedDocuments
}

func (s *Service) runCrawl(ctx context.Context, id uuid.UUID, pageBudget int, timeBudget time.Duration) error {
	r, pageBudget, err := s.admitRun(ctx, id, pageBudget)
	if r == nil || err != nil {
		return err
	}
	// Record crawled pages as they are fetched (per invocation), so the
	// daily limit sees them while a long crawl is still running.
	defer func() {
		bg := context.WithoutCancel(ctx)
		if cur, err := s.q.GetCrawl(bg, id); err == nil {
			if _, err := r.flushUsage(bg, s.q, cur.PagesFetched); err != nil {
				s.Log.WarnContext(ctx, "could not record crawled pages", "crawl", id, "err", err)
			}
		}
	}()
	// Every request of this run (pages, robots.txt, sitemaps, redirects)
	// must pass the owner's allowlist, re-read at most AllowlistTTL late.
	ctx = crawl.WithHostPolicy(ctx, s.Allow.Policy(ctx, r.src.TeamID))
	if r.frontier, err = s.q.CountFrontier(ctx, id); err != nil {
		return err
	}
	if r.frontier == 0 {
		if err := r.seed(ctx); err != nil {
			return r.retryable(ctx, err)
		}
	}
	return r.crawlPages(ctx, pageBudget, time.Now().Add(timeBudget))
}

// admitRun loads a crawl run for this invocation and starts it. A nil run
// means there is nothing (more) to do now; pageBudget is reduced to the
// team's pages left today.
func (s *Service) admitRun(ctx context.Context, id uuid.UUID, pageBudget int) (*run, int, error) {
	cr, err := s.q.GetCrawl(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil, 0, nil
	} else if err != nil {
		return nil, 0, err
	}
	if !Active(cr) || cr.WaitingReason == WaitingSlot {
		return nil, 0, nil // finished, or not admitted yet (Promote inserts its job)
	}
	src, err := s.q.GetSource(ctx, cr.SourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil, 0, nil
	} else if err != nil {
		return nil, 0, err
	}
	if src.Status == "paused" {
		return nil, 0, s.fail(ctx, id, src.TeamID, CrawlCancelled, "The source was paused")
	}
	cfg, err := Stored(cr.Config)
	if err != nil {
		return nil, 0, s.fail(ctx, id, src.TeamID, CrawlFailed, "The source configuration is invalid")
	}
	if err := s.parkIfMaintenance(ctx, id, cr.WaitingReason); err != nil {
		return nil, 0, err
	}
	if err := s.parkIfBudget(ctx, cr, src.TeamID); err != nil {
		return nil, 0, err
	}
	pageBudget, stop, err := s.dailyBudget(ctx, cr, src.TeamID, pageBudget)
	if stop || err != nil {
		return nil, 0, err
	}
	if cr.WaitingReason != "" {
		if err := s.q.SetCrawlWaiting(ctx, dbgen.SetCrawlWaitingParams{ID: id}); err != nil {
			return nil, 0, err
		}
	}
	if cr.Status == CrawlQueued {
		n, err := s.q.StartCrawl(ctx, id)
		if err != nil || n == 0 {
			return nil, 0, err // n == 0: cancelled or finished since we read it
		}
	}
	return &run{s: s, crawl: cr, src: src, cfg: cfg, scope: cfg.Scope(), flushed: cr.PagesFetched}, pageBudget, nil
}

// dailyBudget applies the team's crawled pages per day (from the usage
// ledger) to pageBudget. When today's pages are used up the run waits for
// the next UTC day, or a raised limit (dailylimit.go), snoozing; when
// crawling is blocked it fails. stop reports that the run must not
// continue now.
func (s *Service) dailyBudget(ctx context.Context, cr dbgen.WebCrawl, team uuid.NullUUID, pageBudget int) (int, bool, error) {
	id := cr.ID
	if !team.Valid || s.Limits == nil {
		return pageBudget, false, nil
	}
	left, limit, err := s.dailyPagesLeft(ctx, team.UUID)
	if err != nil {
		return 0, true, err
	}
	switch {
	case left == nil:
		return pageBudget, false, nil
	case *left < 0: // blocked
		return 0, true, s.fail(ctx, id, team, CrawlFailed, "Crawling is blocked for this team (crawled pages per day is 0). Ask a platform admin.")
	case *left == 0:
		s.Limits.ReachedDaily(ctx, team.UUID, limits.CrawlPagesPerDay, limit)
		now := s.Limits.Now()
		until := limits.NextDay(now)
		already := cr.WaitingReason == WaitingDailyPage && cr.WaitingUntil != nil && cr.WaitingUntil.Equal(until)
		if !already {
			if err := s.q.SetCrawlWaiting(ctx, dbgen.SetCrawlWaitingParams{ID: id, WaitingReason: WaitingDailyPage, WaitingUntil: &until}); err != nil {
				return 0, true, err
			}
		}
		return 0, true, river.JobSnooze(dailyLimitSnooze(now, until))
	}
	return min(pageBudget, int(*left)), false, nil
}

// crawlPages processes frontier URLs until the invocation's budget runs out
// (the job snoozes to continue), the frontier is empty or a page limit ends
// the run.
func (r *run) crawlPages(ctx context.Context, pageBudget int, deadline time.Time) error {
	s, id := r.s, r.crawl.ID
	for processed := 0; ; processed++ {
		if ctx.Err() != nil || processed >= pageBudget || time.Now().After(deadline) {
			return river.JobSnooze(0) // continue in a fresh invocation
		}
		cur, err := s.q.GetCrawl(ctx, id)
		if err != nil {
			return r.retryable(ctx, err)
		}
		if !Active(cur) {
			return nil // cancelled
		}
		// Maintenance mode: the page before this one is done; wait here.
		if err := s.parkIfMaintenance(ctx, id, cur.WaitingReason); err != nil {
			return r.retryable(ctx, err)
		}
		next, err := s.q.NextFrontier(ctx, dbgen.NextFrontierParams{CrawlID: id, PageSize: 1})
		if err != nil {
			return r.retryable(ctx, err)
		}
		if len(next) == 0 {
			return r.finish(ctx, "")
		}
		if int(cur.PagesFetched) >= r.cfg.MaxPages {
			return r.finish(ctx, TruncatedMaxPages)
		}
		if err := r.page(ctx, next[0].URL, int(next[0].Depth)); err != nil {
			var stop *limitStop
			if errors.As(err, &stop) {
				return r.finish(ctx, stop.reason)
			}
			return r.retryable(ctx, err)
		}
	}
}

// dailyPagesLeft returns how many pages the team may still crawl today
// (nil = unlimited, -1 = blocked by a limit of 0) and the limit.
func (s *Service) dailyPagesLeft(ctx context.Context, team uuid.UUID) (*int64, int64, error) {
	set, err := s.Limits.Effective(ctx, s.q, team)
	if err != nil {
		return nil, 0, err
	}
	limit := set.Get(limits.CrawlPagesPerDay)
	if limit == nil {
		return nil, 0, nil
	}
	left := int64(-1)
	if *limit > 0 {
		used, err := s.Limits.UsageToday(ctx, s.q, team, limits.UsagePageCrawled)
		if err != nil {
			return nil, 0, err
		}
		left = max(*limit-used, 0)
	}
	return &left, *limit, nil
}

// flushUsage records page_crawled usage for pages fetched since the last
// flush and returns the new mark (applied by the caller after commit).
func (r *run) flushUsage(ctx context.Context, q *dbgen.Queries, fetched int32) (int32, error) {
	delta := fetched - r.flushed
	if delta <= 0 {
		return r.flushed, nil
	}
	meta, _ := json.Marshal(map[string]any{"crawlId": r.crawl.ID})
	if err := q.InsertUsage(ctx, dbgen.InsertUsageParams{
		Kind: limits.UsagePageCrawled, Quantity: int64(delta), TeamID: r.src.TeamID,
		SourceID: uuid.NullUUID{UUID: r.src.ID, Valid: true}, Metadata: meta,
	}); err != nil {
		return r.flushed, err
	}
	r.flushed = fetched
	return fetched, nil
}

// retryable turns a context error from shutdown into a snooze, so the run
// resumes immediately on the next worker without using an attempt.
func (r *run) retryable(ctx context.Context, err error) error {
	if ctx.Err() != nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
		return river.JobSnooze(0)
	}
	return err
}

// fail ends a run and admits the team's next waiting run. A failed run of
// a team source notifies the team's editors and above.
func (s *Service) fail(ctx context.Context, id uuid.UUID, team uuid.NullUUID, status, msg string) error {
	bg := context.WithoutCancel(ctx)
	err := pgx.BeginFunc(bg, s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		n, err := q.FinishCrawl(bg, dbgen.FinishCrawlParams{ID: id, Status: status, Error: msg})
		if err != nil || n == 0 || status != CrawlFailed || !team.Valid {
			return err
		}
		return s.notifySyncFailed(bg, q, tx, id, msg)
	})
	if err == nil {
		s.Promote(ctx, team)
	}
	return err
}

func (s *Service) notifySyncFailed(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, crawlID uuid.UUID, msg string) error {
	if s.Notify == nil {
		return nil
	}
	cr, err := q.GetCrawl(ctx, crawlID)
	if err != nil {
		return err
	}
	src, err := q.GetSource(ctx, cr.SourceID)
	if err != nil {
		return err
	}
	t, err := q.GetTeamByID(ctx, src.TeamID.UUID)
	if err != nil {
		return err
	}
	ref := notify.TeamRef{ID: t.ID, Slug: t.Slug, Name: t.Name}
	return s.Notify.Emit(ctx, tx, notify.SyncFailedEvent(ref, src.ID, src.Name, crawlID, msg))
}

// finish completes a run: stale pages are removed unless the run was
// truncated (reason non-empty now, or earlier), and the next scheduled sync
// is set. The team's next waiting run is then admitted.
func (r *run) finish(ctx context.Context, reason string) error {
	s := r.s
	truncated := reason != ""
	var deleted []dbgen.DeleteUnseenDocumentsRow
	flushed := r.flushed
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		cur, err := q.LockCrawl(ctx, r.crawl.ID)
		if err != nil {
			return err
		}
		if !Active(cur) {
			return nil // cancelled meanwhile
		}
		if truncated {
			if err := q.MarkCrawlTruncated(ctx, dbgen.MarkCrawlTruncatedParams{ID: cur.ID, Reason: reason}); err != nil {
				return err
			}
		}
		// Stale pages are removed only after a complete run that reached the
		// site: a run where no page was fetched (robots.txt or the site
		// temporarily down, the host no longer allowed) deletes nothing.
		// A page re-fetch saw only its page: it removes nothing.
		reached := cur.PagesChanged+cur.PagesUnchanged > 0
		if !truncated && !cur.Truncated && reached && cur.Trigger != TriggerPage {
			if deleted, err = q.DeleteUnseenDocuments(ctx, dbgen.DeleteUnseenDocumentsParams{
				SourceID: r.src.ID, CrawlID: uuid.NullUUID{UUID: cur.ID, Valid: true},
			}); err != nil {
				return err
			}
			// Their stored files go when the deleted-files retention says
			// (docs/operations/retention.md).
			for _, d := range deleted {
				if err := retention.RecordDeletedFiles(ctx, q, retention.DeletedContent{
					TeamID: r.src.TeamID, SourceID: r.src.ID, DocumentID: uuid.NullUUID{UUID: d.ID, Valid: true},
					Prefix: ingest.DocumentPrefix(r.src.TeamID, r.src.ID, d.ID), CreatedAt: d.CreatedAt,
				}); err != nil {
					return err
				}
			}
		}
		if _, err := q.FinishCrawl(ctx, dbgen.FinishCrawlParams{ID: cur.ID, Status: CrawlCompleted, DocumentsDeleted: int32(len(deleted))}); err != nil {
			return err
		}
		if err := q.PruneFrontiers(ctx, dbgen.PruneFrontiersParams{SourceID: r.src.ID, KeepCrawlID: cur.ID}); err != nil {
			return err
		}
		if _, err := r.flushUsage(ctx, q, cur.PagesFetched); err != nil {
			return err
		}
		// Recount repeated blocks once the run's pages are processed, and
		// re-chunk pages indexed before they were known (ADR-0021).
		if err := ingest.RequestRefresh(ctx, s.Jobs, tx, r.src.ID); err != nil {
			return err
		}
		if cur.Trigger == TriggerPage {
			return nil // not a sync: the schedule and last sync stay
		}
		// The schedule comes from the current configuration, which may
		// have changed during the run.
		schedule := r.cfg.Schedule
		if src, err := q.GetSource(ctx, r.src.ID); err == nil {
			if c, err := Stored(src.Config); err == nil {
				schedule = c.Schedule
			}
		}
		now := time.Now()
		return q.SetNextSync(ctx, dbgen.SetNextSyncParams{ID: r.src.ID, NextSyncAt: NextSync(schedule, now), LastSyncAt: &now})
	})
	if err != nil {
		r.flushed = flushed // the usage row was rolled back
		return r.retryable(ctx, err)
	}
	s.Promote(ctx, r.src.TeamID)
	return nil
}

// deletePrefix removes stored files after the database change committed. A
// failure only leaks storage, so it is logged.
func (s *Service) deletePrefix(ctx context.Context, prefix string) {
	if err := s.Blob.DeletePrefix(context.WithoutCancel(ctx), prefix); err != nil {
		s.Log.WarnContext(ctx, "could not delete stored files", "prefix", prefix, "err", err)
	}
}
