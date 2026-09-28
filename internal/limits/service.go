package limits

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Usage ledger kinds that daily limits count (usage_events.kind).
const (
	UsageQuery       = "query"
	UsagePageCrawled = "page_crawled"
	UsageChatIn      = "chat_tokens_in"
	UsageChatOut     = "chat_tokens_out"
)

// Options adjust built-in defaults from configuration.
type Options struct {
	// IngestJobsDefault is the built-in default of concurrent_ingest_jobs
	// (INGEST_MAX_INFLIGHT_PER_TEAM); 0 keeps the registry value.
	IngestJobsDefault int
}

// Service reads and changes limits and checks them.
type Service struct {
	pool     *pgxpool.Pool
	q        *dbgen.Queries
	teams    *teams.Service
	limiter  *ratelimit.Limiter // nil: per-minute limits are not enforced
	builtins map[Key]*int64

	// OnBackendError is called when Valkey fails and a rate check fails open.
	OnBackendError func()
	// OnDailyLimit is called when a team is refused because it used up a
	// daily limit (max > 0), for the "daily limit reached" notification.
	// It must be cheap on repeat calls (the caller dedupes per day).
	OnDailyLimit func(ctx context.Context, teamID uuid.UUID, key Key, max int64)
	// Now is the clock (tests may replace it).
	Now func() time.Time
}

// New returns a Service. kvs may be nil (no per-minute limits).
func New(pool *pgxpool.Pool, t *teams.Service, kvs *kv.Store, opts Options) *Service {
	s := &Service{pool: pool, q: dbgen.New(pool), teams: t, builtins: map[Key]*int64{}, Now: time.Now}
	if kvs != nil {
		s.limiter = &ratelimit.Limiter{KV: kvs}
	}
	for _, d := range registry {
		s.builtins[d.Key] = d.Default
	}
	if opts.IngestJobsDefault > 0 {
		s.builtins[ConcurrentIngestJobs] = ptr(int64(opts.IngestJobsDefault))
	}
	return s
}

// BuiltIn returns a key's built-in default (nil = unlimited).
func (s *Service) BuiltIn(k Key) *int64 { return s.builtins[k] }

var errAdminOnly = apperr.Forbidden("Only platform admins can change limits")

func (s *Service) platform(ctx context.Context, q *dbgen.Queries, lock bool) (Platform, error) {
	var (
		row dbgen.PlatformLimit
		err error
	)
	if lock {
		row, err = q.LockPlatformLimits(ctx)
	} else {
		row, err = q.GetPlatformLimits(ctx)
	}
	if err != nil {
		return Platform{}, err
	}
	settings, custom, err := parsePlatform(row.Settings, s.builtins)
	if err != nil {
		return Platform{}, err
	}
	return Platform{Settings: settings, Custom: custom, Revision: row.Revision, UpdatedAt: row.UpdatedAt}, nil
}

// Effective returns a team's effective limits. q may be bound to a transaction.
func (s *Service) Effective(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID) (Set, error) {
	if q == nil {
		q = s.q
	}
	row, err := q.TeamLimitConfig(ctx, teamID)
	if err != nil {
		return Set{}, err
	}
	settings, custom, err := parsePlatform(row.Platform, s.builtins)
	if err != nil {
		return Set{}, err
	}
	o, err := parseOverrides(row.Overrides)
	if err != nil {
		return Set{}, err
	}
	return Set{Platform: Platform{Settings: settings, Custom: custom}, Overrides: o}, nil
}

// ReachedDaily reports that a team used up a daily limit of max (> 0).
func (s *Service) ReachedDaily(ctx context.Context, teamID uuid.UUID, key Key, max int64) {
	if s != nil && s.OnDailyLimit != nil && max > 0 {
		s.OnDailyLimit(ctx, teamID, key, max)
	}
}
