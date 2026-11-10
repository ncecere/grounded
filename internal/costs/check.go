package costs

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/requestcache"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Enforcement (docs/costs.md §4): at 100% of an enforced budget everything
// that calls a model is refused (chats in every channel, retrieval queries)
// and ingestion waits. Month-to-date spend is cached per team for CacheTTL;
// every change that can move a team's state bumps the settings' generation,
// which drops the cache in every process.

// Status is a team's budget state this month.
type Status struct {
	TeamID   uuid.UUID
	Mode     string // effective: off, track or enforce
	Currency string
	Location *time.Location // the platform time zone
	Month    Day
	// Start and ResetsAt bound the budget month (instants).
	Start, ResetsAt time.Time
	// Budget is the monthly budget (the team's or the platform default; nil:
	// none). Extensions are this month's; Limit is their sum (nil: none).
	Budget, Extensions, Limit *big.Rat
	Spent                     *big.Rat // month to date (nil when the mode is off)
	WarnPercent               int
	// State is spent against the limit. With Track only it is computed the
	// same way (owner decision 2 of docs/v0.2.0.md §7), but only Enforced
	// refuses work or notifies anyone.
	State string
}

// Enforced reports whether the budget can refuse work and notify: only in
// Enforce. A Track-only budget shows progress and nothing else.
func (st Status) Enforced() bool { return st.Mode == ModeEnforce }

type cached struct {
	generation int64
	month      Day
	loc        *time.Location
	spent, ext *big.Rat
	agents     map[uuid.UUID]*big.Rat // month-to-date spend per agent
	at         time.Time
	// near: the team or one of its agents is at its warning threshold or over, so the entry lives NearCacheTTL.
	near bool
}

// ttl is how long the entry is used: shorter close to a limit, so a team overshoots less (docs/specs/agent-budgets).
func (c cached) ttl() time.Duration {
	if c.near {
		return NearCacheTTL
	}
	return CacheTTL
}

// markNear shortens a team's cache entry once it is close to a limit.
func (s *Service) markNear(teamID uuid.UUID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.cache[teamID]; ok && !c.near {
		c.near = true
		s.cache[teamID] = c
	}
}

// Recorded adds usage this process just wrote to the ledger to the team's
// cached month-to-date spend (at today's prices), so the next check sees it
// without waiting for the cache to expire. Usage of other processes is seen
// when the cache expires.
func (s *Service) Recorded(teamID uuid.UUID, usage []dbgen.InsertUsageParams) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.cache[teamID]
	if !ok || s.prices == nil || s.prices.generation != c.generation {
		return
	}
	today := DayOf(s.now(), c.loc)
	spent := new(big.Rat).Set(c.spent)
	agents := make(map[uuid.UUID]*big.Rat, len(c.agents))
	for k, v := range c.agents {
		agents[k] = v
	}
	for _, u := range usage {
		if !u.ModelID.Valid {
			continue
		}
		if p, ok := s.prices.book.At(u.ModelID.UUID, u.Kind, today); ok {
			cost := Cost(u.Quantity, u.Kind, p.Price)
			spent.Add(spent, cost)
			if u.AgentID.Valid {
				a := new(big.Rat)
				if prev := agents[u.AgentID.UUID]; prev != nil {
					a.Set(prev)
				}
				agents[u.AgentID.UUID] = a.Add(a, cost)
			}
		}
	}
	c.spent, c.agents = spent, agents
	s.cache[teamID] = c
}

// costConfigKey is a team's cost settings in a request's cache.
type costConfigKey struct{ team uuid.UUID }

// teamConfig reads a team's cost settings: once per request where the request
// keeps a cache (requestcache), since the team's and the agent's budget checks
// of one chat answer both need them.
func (s *Service) teamConfig(ctx context.Context, teamID uuid.UUID) (dbgen.TeamCostConfigRow, error) {
	return requestcache.Get(ctx, costConfigKey{teamID}, func() (dbgen.TeamCostConfigRow, error) { return s.q.TeamCostConfig(ctx, teamID) })
}

// status computes a team's budget state; fresh skips the cache.
func (s *Service) status(ctx context.Context, teamID uuid.UUID, fresh bool) (Status, error) {
	cfg, err := s.teamConfig(ctx, teamID)
	if err != nil {
		return Status{}, err
	}
	now := s.now()
	loc := zone(cfg.TimeZone)
	start, end, month := MonthBounds(now, loc)
	st := Status{TeamID: teamID, Mode: EffectiveMode(cfg.PlatformMode, cfg.TeamMode), Currency: cfg.Currency, Location: loc, Month: month,
		Start: start, ResetsAt: end, WarnPercent: int(cfg.PlatformWarnPercent), State: StateNone}
	if cfg.WarnPercent != nil {
		st.WarnPercent = int(*cfg.WarnPercent)
	}
	if st.Mode == ModeOff {
		return st, nil
	}
	spent, ext, _, err := s.monthToDate(ctx, cfg, teamID, month, start, end, fresh)
	if err != nil {
		return Status{}, err
	}
	st.Spent = spent
	st.Budget = optRat(cfg.Amount)
	if st.Budget == nil {
		st.Budget = optRat(cfg.DefaultBudget)
	}
	st.Extensions = ext
	if st.Budget == nil {
		return st, nil
	}
	st.Limit = new(big.Rat).Add(st.Budget, ext)
	st.State = stateOf(spent, st.Limit, st.WarnPercent)
	if st.State == StateWarning || st.State == StateExhausted {
		s.markNear(teamID)
	}
	return st, nil
}

// stateOf is the state of spent against limit with a warning threshold.
func stateOf(spent, limit *big.Rat, warnPercent int) string {
	if spent.Cmp(limit) >= 0 {
		return StateExhausted
	}
	warn := new(big.Rat).Mul(limit, big.NewRat(int64(warnPercent), 100))
	if spent.Cmp(warn) >= 0 {
		return StateWarning
	}
	return StateOK
}

// monthToDate is the team's spend, extensions and spend per agent this month, cached (CacheTTL, or NearCacheTTL close to a
// limit).
func (s *Service) monthToDate(ctx context.Context, cfg dbgen.TeamCostConfigRow, teamID uuid.UUID, month Day, start, end time.Time,
	fresh bool) (spent, ext *big.Rat, agents map[uuid.UUID]*big.Rat, err error) {
	now := s.now()
	s.mu.Lock()
	c, ok := s.cache[teamID]
	s.mu.Unlock()
	if ok && !fresh && c.generation == cfg.Generation && c.month.Equal(month) && now.Sub(c.at) < c.ttl() {
		return c.spent, c.ext, c.agents, nil
	}
	st := Settings{TimeZone: cfg.TimeZone, Generation: cfg.Generation}
	spent, agents, err = s.agentSpend(ctx, st, start, end, teamID)
	if err != nil {
		return nil, nil, nil, err
	}
	total, err := s.q.SumBudgetExtensions(ctx, dbgen.SumBudgetExtensionsParams{TeamID: teamID, Month: pgDate(month)})
	if err != nil {
		return nil, nil, nil, err
	}
	ext = mustRat(total)
	s.mu.Lock()
	s.cache[teamID] = cached{generation: cfg.Generation, month: month, loc: zone(cfg.TimeZone), spent: spent, ext: ext, agents: agents, at: now,
		near: ok && c.near && c.month.Equal(month)}
	s.mu.Unlock()
	return spent, ext, agents, nil
}

// agentSpend is one team's spend in [from, to), in total and per agent (usage without an agent counts in the total only).
func (s *Service) agentSpend(ctx context.Context, st Settings, from, to time.Time, teamID uuid.UUID) (*big.Rat, map[uuid.UUID]*big.Rat, error) {
	book, err := s.priceBook(ctx, st.Generation)
	if err != nil {
		return nil, nil, err
	}
	rows, err := s.usage(ctx, from, to, st.TimeZone, groupAgent, uuid.NullUUID{UUID: teamID, Valid: true})
	if err != nil {
		return nil, nil, err
	}
	total, agents := new(big.Rat), map[uuid.UUID]*big.Rat{}
	for agent, t := range Sum(book, rows, func(u usageRow) uuid.NullUUID { return u.Agent }) {
		total.Add(total, t.Spend)
		if agent.Valid {
			agents[agent.UUID] = t.Spend
		}
	}
	return total, agents, nil
}

// ErrCodeExhausted is the error code of a refusal at 100% of a budget.
const ErrCodeExhausted = "budget_exhausted"

// Exhausted is the 429 budget_exhausted refusal of a team's model work.
func Exhausted(st Status) *apperr.Error {
	resets := st.ResetsAt.In(st.Location).Format("Jan 2, 2006")
	return &apperr.Error{
		Status: http.StatusTooManyRequests, Code: ErrCodeExhausted,
		Message: fmt.Sprintf("Your team's monthly budget is used up. It resets on %s, or a platform admin can raise it or grant an extension.", resets),
		Details: map[string]any{"budget": Format(st.Limit), "spent": Format(st.Spent), "currency": st.Currency,
			"resetsAt": st.ResetsAt.UTC().Format(time.RFC3339)},
		RetryAfter: time.Until(st.ResetsAt),
	}
}

// IsExhausted reports a budget_exhausted refusal.
func IsExhausted(err error) bool {
	e, ok := apperr.As(err)
	return ok && e.Code == ErrCodeExhausted
}

// Check admits model work for a team: a *apperr.Error (429
// budget_exhausted) when the team's enforced budget is used up. Reaching
// the threshold or the budget notifies the team's owners and admins, once
// per month and level. A Track-only budget never refuses or notifies. nil
// receivers admit everything.
func (s *Service) Check(ctx context.Context, teamID uuid.UUID) error {
	if s == nil {
		return nil
	}
	st, err := s.status(ctx, teamID, false)
	if err != nil || !st.Enforced() {
		return err
	}
	switch st.State {
	case StateWarning:
		s.notice(ctx, st, LevelWarning)
	case StateExhausted:
		s.notice(ctx, st, LevelExhausted)
		return Exhausted(st)
	}
	return nil
}

// Blocked reports whether a team's enforced budget is used up, and when it
// resets (for crawls, which wait rather than fail).
func (s *Service) Blocked(ctx context.Context, teamID uuid.UUID) (bool, time.Time, error) {
	err := s.Check(ctx, teamID)
	if IsExhausted(err) {
		st, _ := s.status(ctx, teamID, false)
		return true, st.ResetsAt, nil
	}
	return false, time.Time{}, err
}

// activeTeamsSQL lists the active teams (the candidates when the platform
// mode is Enforce).
const activeTeamsSQL = `SELECT id FROM teams WHERE status = 'active' ORDER BY id`

// BlockedTeams lists the teams whose enforced budget is used up, for the
// ingestion dispatcher. It checks every team that can be enforced (every
// active team when the platform mode is Enforce, else the teams set to
// Enforce), not only those with pending documents: the dispatcher reuses the
// list between dispatch jobs, and a blocked team's next upload must already
// be on it. Check caches each team's spend (CacheTTL).
func (s *Service) BlockedTeams(ctx context.Context) ([]uuid.UUID, error) {
	if s == nil {
		return nil, nil
	}
	st, err := s.current(ctx)
	if err != nil {
		return nil, err
	}
	candidates, err := s.q.EnforcedTeamOverrides(ctx)
	if err != nil {
		return nil, err
	}
	if st.Mode == ModeEnforce {
		rows, err := s.pool.Query(ctx, activeTeamsSQL)
		if err != nil {
			return nil, err
		}
		if candidates, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID]); err != nil {
			return nil, err
		}
	}
	var out []uuid.UUID
	for _, t := range candidates {
		if err := s.Check(ctx, t); IsExhausted(err) {
			out = append(out, t)
		} else if err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Notice is a team reaching its threshold or using up its budget.
type Notice struct {
	TeamID      uuid.UUID
	Level       string
	Month       Day
	Spent       *big.Rat
	Limit       *big.Rat
	Currency    string
	WarnPercent int
	ResetsAt    time.Time
	TimeZone    *time.Location
	// AgentID and AgentName name the agent whose own budget this is (invalid: the team's budget).
	AgentID   uuid.NullUUID
	AgentName string
}

// notice records a level once per team and month and runs OnNotice in the
// same transaction. Errors are logged: a notification never fails a request.
func (s *Service) notice(ctx context.Context, st Status, level string) {
	key := st.TeamID.String() + ":" + st.Month.Format(time.DateOnly) + ":" + level
	if _, dup := s.noticed.Load(key); dup {
		return
	}
	ctx = context.WithoutCancel(ctx)
	n := Notice{TeamID: st.TeamID, Level: level, Month: st.Month, Spent: st.Spent, Limit: st.Limit, Currency: st.Currency,
		WarnPercent: st.WarnPercent, ResetsAt: st.ResetsAt, TimeZone: st.Location}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		inserted, err := dbgen.New(tx).InsertBudgetNotice(ctx, dbgen.InsertBudgetNoticeParams{TeamID: st.TeamID, Month: pgDate(st.Month), Level: level})
		if err != nil || inserted == 0 || s.OnNotice == nil {
			return err
		}
		return s.OnNotice(ctx, tx, n)
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		if s.Log != nil {
			s.Log.WarnContext(ctx, "could not record a budget notice", "team", st.TeamID, "level", level, "err", err)
		}
		return
	}
	s.noticed.Store(key, struct{}{})
}
