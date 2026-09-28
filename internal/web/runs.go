package web

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Crawl triggers.
const (
	TriggerCreate   = "create"
	TriggerManual   = "manual"
	TriggerSchedule = "schedule"
	// TriggerPage re-fetches one page (docs/ui-review W3): the run's config
	// is the source's, scraping just that URL, so no link is followed; it
	// removes no pages and leaves the schedule alone (see finish).
	TriggerPage = "page"
)

// Crawl statuses.
const (
	CrawlQueued    = "queued"
	CrawlRunning   = "running"
	CrawlCompleted = "completed"
	CrawlFailed    = "failed"
	CrawlCancelled = "cancelled"
)

// Why an active run is waiting (web_crawls.waiting_reason).
const (
	WaitingSlot      = "concurrent_crawls" // queued until the team has a free crawl slot
	WaitingDailyPage = "daily_page_limit"  // paused until the next UTC day
)

// Why a run stopped early (web_crawls.truncated_reason).
const (
	TruncatedMaxPages  = "max_pages"
	TruncatedDocuments = "documents_limit"
	TruncatedStorage   = "storage_limit"
)

// Active reports whether a crawl run is queued or running.
func Active(c dbgen.WebCrawl) bool { return c.Status == CrawlQueued || c.Status == CrawlRunning }

// InProgressError is returned when a source already has an active run. It
// unwraps to a 409 crawl_in_progress apperr.Error; handlers add the run.
type InProgressError struct{ Crawl dbgen.WebCrawl }

func (e *InProgressError) Error() string { return "crawl_in_progress: " + e.Crawl.ID.String() }

func (e *InProgressError) Unwrap() error {
	return apperr.Conflict("crawl_in_progress", "This source is already syncing")
}

// StartRun starts a crawl run for a web source inside tx. The caller must
// hold a lock on the source row (so two starts cannot race). When a run is
// already active it returns *InProgressError. Paused sources do not start,
// and nothing starts during maintenance mode (503 maintenance_mode).
//
// Team limits: when the team already has concurrent_crawls runs holding a
// slot, the run is created queued with waiting reason concurrent_crawls and
// no job; Promote admits it when a slot frees. A team whose concurrent
// crawls or daily crawled pages are blocked (0) gets a *limits.Error.
func (s *Service) StartRun(ctx context.Context, tx pgx.Tx, src dbgen.DataSource, trigger string, by uuid.UUID) (dbgen.WebCrawl, error) {
	return s.startRun(ctx, tx, src, trigger, src.Config, by)
}

// StartPageRun starts a run (trigger "page") that fetches only pageURL, one
// of the source's pages, with the source's settings (tags, allowlist,
// limits). Like StartRun, the caller holds a lock on the source row.
func (s *Service) StartPageRun(ctx context.Context, tx pgx.Tx, src dbgen.DataSource, pageURL string, by uuid.UUID) (dbgen.WebCrawl, error) {
	cfg, err := Stored(src.Config)
	if err != nil {
		return dbgen.WebCrawl{}, apperr.Invalid("invalid_config", "The source configuration is invalid")
	}
	cfg.Mode, cfg.URLs, cfg.MaxPages, cfg.MaxDepth, cfg.UseSitemaps = ModeScrape, []string{pageURL}, 1, 0, false
	return s.startRun(ctx, tx, src, TriggerPage, cfg.JSON(), by)
}

func (s *Service) startRun(ctx context.Context, tx pgx.Tx, src dbgen.DataSource, trigger string, config json.RawMessage, by uuid.UUID) (dbgen.WebCrawl, error) {
	q := dbgen.New(tx)
	if src.Type != "web" {
		return dbgen.WebCrawl{}, apperr.Invalid("not_web_source", "Only web sources sync")
	}
	if src.Status == "paused" {
		return dbgen.WebCrawl{}, apperr.Conflict("source_paused", "This source is paused. Resume it to sync.")
	}
	if err := s.checkMaintenance(ctx); err != nil {
		return dbgen.WebCrawl{}, err
	}
	active, err := q.ActiveCrawl(ctx, src.ID)
	if err == nil {
		return active, &InProgressError{Crawl: active}
	} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return dbgen.WebCrawl{}, err
	}
	waiting := ""
	if src.TeamID.Valid && s.Limits != nil {
		team := src.TeamID.UUID
		set, err := s.Limits.Effective(ctx, q, team)
		if err != nil {
			return dbgen.WebCrawl{}, err
		}
		for _, k := range []limits.Key{limits.ConcurrentCrawls, limits.CrawlPagesPerDay} {
			if v := set.Get(k); v != nil && *v == 0 {
				return dbgen.WebCrawl{}, limits.Blocked(k)
			}
		}
		if slots := set.Get(limits.ConcurrentCrawls); slots != nil {
			if err := q.LockTeamCrawlSlots(ctx, team); err != nil {
				return dbgen.WebCrawl{}, err
			}
			used, err := q.CountCrawlSlots(ctx, src.TeamID)
			if err != nil {
				return dbgen.WebCrawl{}, err
			}
			if used >= *slots {
				waiting = WaitingSlot
			}
		}
	}
	cr, err := q.InsertCrawl(ctx, dbgen.InsertCrawlParams{
		SourceID: src.ID, TeamID: src.TeamID, Trigger: trigger, Config: config,
		CreatedBy: uuid.NullUUID{UUID: by, Valid: by != uuid.Nil}, WaitingReason: waiting,
	})
	if err != nil || waiting != "" {
		return cr, err
	}
	if _, err := s.Jobs.InsertTx(ctx, tx, CrawlArgs{CrawlID: cr.ID}, nil); err != nil {
		return cr, err
	}
	return cr, nil
}

// Promote admits a team's runs waiting for a crawl slot, oldest first, as
// far as its concurrent_crawls limit allows. It runs in its own transaction
// after a run ends (and periodically, for limit changes and deleted
// sources); errors are logged, since the next call retries.
func (s *Service) Promote(ctx context.Context, team uuid.NullUUID) {
	if !team.Valid || s.Limits == nil {
		return
	}
	ctx = context.WithoutCancel(ctx)
	admitted := 0
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if err := q.LockTeamCrawlSlots(ctx, team.UUID); err != nil {
			return err
		}
		set, err := s.Limits.Effective(ctx, q, team.UUID)
		if err != nil {
			return err
		}
		free := int64(100)
		if slots := set.Get(limits.ConcurrentCrawls); slots != nil {
			used, err := q.CountCrawlSlots(ctx, team)
			if err != nil {
				return err
			}
			free = min(free, *slots-used)
		}
		if free <= 0 {
			return nil
		}
		waiting, err := q.WaitingCrawls(ctx, dbgen.WaitingCrawlsParams{TeamID: team, PageSize: int32(free)})
		if err != nil {
			return err
		}
		for _, cr := range waiting {
			n, err := q.AdmitCrawl(ctx, cr.ID)
			if err != nil {
				return err
			}
			if n == 0 {
				continue
			}
			if _, err := s.Jobs.InsertTx(ctx, tx, CrawlArgs{CrawlID: cr.ID}, nil); err != nil {
				return err
			}
			admitted++
		}
		return nil
	})
	if err != nil {
		s.Log.WarnContext(ctx, "could not admit waiting crawls", "team", team.UUID, "err", err)
	} else if admitted > 0 {
		s.Log.InfoContext(ctx, "admitted waiting crawls", "team", team.UUID, "count", admitted)
	}
}

// PromoteAll admits waiting runs of every team that has some.
func (s *Service) PromoteAll(ctx context.Context) error {
	teams, err := s.q.TeamsWithWaitingCrawls(ctx)
	if err != nil {
		return err
	}
	for _, t := range teams {
		s.Promote(ctx, t)
	}
	return nil
}

// CancelRun cancels an active run of a source inside tx. The worker notices
// between pages. After commit, call Promote for the source's team. Runs that already finished return 409 crawl_not_active.
func (s *Service) CancelRun(ctx context.Context, tx pgx.Tx, sourceID, crawlID uuid.UUID) (dbgen.WebCrawl, error) {
	q := dbgen.New(tx)
	cr, err := q.LockCrawl(ctx, crawlID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && cr.SourceID != sourceID) {
		return cr, apperr.NotFound("crawl_not_found", "Crawl not found")
	} else if err != nil {
		return cr, err
	}
	if !Active(cr) {
		return cr, apperr.Conflict("crawl_not_active", "This crawl has already finished")
	}
	// No note: the status says it all (docs/ui-review P-07). Notes are for
	// cancellations with a reason, such as a paused source.
	if _, err := q.FinishCrawl(ctx, dbgen.FinishCrawlParams{ID: crawlID, Status: CrawlCancelled, Error: ""}); err != nil {
		return cr, err
	}
	return q.GetCrawl(ctx, crawlID)
}

// CancelActive cancels a source's active run, if any, inside tx (used when
// a source is paused).
func (s *Service) CancelActive(ctx context.Context, tx pgx.Tx, sourceID uuid.UUID, reason string) error {
	q := dbgen.New(tx)
	cr, err := q.ActiveCrawl(ctx, sourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	_, err = q.FinishCrawl(ctx, dbgen.FinishCrawlParams{ID: cr.ID, Status: CrawlCancelled, Error: reason})
	return err
}

// ListRuns returns a source's runs, newest first.
func (s *Service) ListRuns(ctx context.Context, sourceID uuid.UUID, limit int32) ([]dbgen.WebCrawl, error) {
	return s.q.ListSourceCrawls(ctx, dbgen.ListSourceCrawlsParams{SourceID: sourceID, PageSize: limit})
}

// ActiveRuns returns the active run of each source that has one.
func (s *Service) ActiveRuns(ctx context.Context, sourceIDs []uuid.UUID) (map[uuid.UUID]dbgen.WebCrawl, error) {
	rows, err := s.q.ActiveCrawlsForSources(ctx, sourceIDs)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]dbgen.WebCrawl, len(rows))
	for _, r := range rows {
		out[r.SourceID] = r
	}
	return out, nil
}
