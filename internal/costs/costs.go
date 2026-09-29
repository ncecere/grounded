// Package costs prices the usage ledger, reports spend and enforces
// monthly team budgets (docs/costs.md, DESIGN.md §11.3).
//
// The mode is a platform setting with per-team overrides: off (the default:
// nothing changes), track (spend is reported) or enforce (track, plus a
// monthly budget per team: a warning at the threshold and, at 100%, the
// team's model work is refused until the budget is raised, an extension is
// granted or the month ends).
//
// Spend reads the hourly usage rollup (rollup.go) plus the open hours live
// from usage_events, and prices each local day's quantities at the prices in
// effect that day (prices.go), with exact decimals (math/big), never floats.
package costs

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Modes. A team's override may also be ModeInherit.
const (
	ModeOff     = "off"
	ModeTrack   = "track"
	ModeEnforce = "enforce"
	ModeInherit = "inherit"
)

// Budget states of a team this month.
const (
	StateNone      = "none"      // costs are off, or no budget
	StateOK        = "ok"        // under the threshold
	StateWarning   = "warning"   // at or above the threshold
	StateExhausted = "exhausted" // at or above 100%: model work is refused when enforced
)

// Notice levels (budget_notices.level).
const (
	LevelWarning   = "warning"
	LevelExhausted = "exhausted"
)

// Ledger kinds that are priced (usage_events.kind), also the price units.
const (
	UnitChatIn            = "chat_tokens_in"
	UnitChatOut           = "chat_tokens_out"
	UnitEmbed             = "embed_tokens"
	UnitSystemOneTokens   = "systemone_tokens"
	UnitSystemOneRequests = "systemone_requests"
	UnitModeration        = "moderation_requests"
	// A vision model reading scanned pages (OCR, docs/ocr.md).
	UnitVisionIn  = "vision_tokens_in"
	UnitVisionOut = "vision_tokens_out"
)

// CacheTTL is how long a team's month-to-date spend is reused by the budget
// check: a team can overshoot its budget by about this much use.
const CacheTTL = 30 * time.Second

// Service reads and changes cost settings, prices and budgets, reports
// spend and checks budgets.
type Service struct {
	pool  *pgxpool.Pool
	q     *dbgen.Queries
	teams *teams.Service
	Log   *slog.Logger

	// OnNotice is called once per team, month and level when a team reaches
	// its warning threshold or uses up its budget (the notification).
	// It runs in the transaction that records the notice (budget_notices).
	OnNotice func(ctx context.Context, tx pgx.Tx, n Notice) error
	// OnChange is called after a change that can unblock work (settings,
	// prices, a team's budget or an extension) committed: team set for one
	// team, not set for every team. It wakes waiting crawls and ingestion.
	OnChange func(ctx context.Context, team uuid.NullUUID)
	// Now is the clock (tests may replace it).
	Now func() time.Time

	noticed sync.Map // notices recorded by this process

	mu     sync.Mutex
	cache  map[uuid.UUID]cached
	prices *priceCache
}

// New returns a Service.
func New(pool *pgxpool.Pool, t *teams.Service, log *slog.Logger) *Service {
	return &Service{pool: pool, q: dbgen.New(pool), teams: t, Log: log, Now: time.Now, cache: map[uuid.UUID]cached{}}
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// changed drops cached state and runs the OnChange hook.
func (s *Service) changed(ctx context.Context, team uuid.NullUUID) {
	s.mu.Lock()
	s.cache = map[uuid.UUID]cached{}
	s.prices = nil
	s.mu.Unlock()
	if s.OnChange != nil {
		s.OnChange(context.WithoutCancel(ctx), team)
	}
}

var (
	errAdminOnly = apperr.Forbidden("Only platform admins can change costs and budgets")
	errReadOnly  = apperr.Forbidden("Costs are for platform admins and auditors")
)

// canRead: platform admins and auditors in a browser session.
func canRead(a authz.Actor) bool { return a.Key == nil && a.CanReadPlatform() }

// canWrite: platform admins in a browser session.
func canWrite(a authz.Actor) bool { return a.Key == nil && a.IsPlatformAdmin() }

func by(a authz.Actor) uuid.NullUUID {
	return uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
}

// EffectiveMode is a team's mode: its override unless it inherits.
func EffectiveMode(platform, team string) string {
	if team == "" || team == ModeInherit {
		return platform
	}
	return team
}
