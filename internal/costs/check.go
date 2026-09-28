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
	State                     string
}

type cached struct {
	generation int64
	month      Day
	loc        *time.Location
	spent, ext *big.Rat
	at         time.Time
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
	for _, u := range usage {
		if !u.ModelID.Valid {
			continue
		}
		if p, ok := s.prices.book.At(u.ModelID.UUID, u.Kind, today); ok {
			spent.Add(spent, Cost(u.Quantity, u.Kind, p.Price))
		}
	}
	c.spent = spent
	s.cache[teamID] = c
}

// status computes a team's budget state; fresh skips the cache.
func (s *Service) status(ctx context.Context, teamID uuid.UUID, fresh bool) (Status, error) {
	cfg, err := s.q.TeamCostConfig(ctx, teamID)
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
	spent, ext, err := s.monthToDate(ctx, cfg, teamID, month, start, end, fresh)
	if err != nil {
		return Status{}, err
	}
	st.Spent = spent
	if st.Mode != ModeEnforce {
		return st, nil
	}
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

// monthToDate is the team's spend and extensions this month, cached.
func (s *Service) monthToDate(ctx context.Context, cfg dbgen.TeamCostConfigRow, teamID uuid.UUID, month Day, start, end time.Time,
	fresh bool) (spent, ext *big.Rat, err error) {
	now := s.now()
	s.mu.Lock()
	c, ok := s.cache[teamID]
	s.mu.Unlock()
	if ok && !fresh && c.generation == cfg.Generation && c.month.Equal(month) && now.Sub(c.at) < CacheTTL {
		return c.spent, c.ext, nil
	}
	st := Settings{TimeZone: cfg.TimeZone, Generation: cfg.Generation}
	by, err := s.teamSpend(ctx, st, start, end, uuid.NullUUID{UUID: teamID, Valid: true})
	if err != nil {
		return nil, nil, err
	}
	spent = new(big.Rat)
	if t := by[teamID]; t != nil {
		spent = t.Spend
	}
	total, err := s.q.SumBudgetExtensions(ctx, dbgen.SumBudgetExtensionsParams{TeamID: teamID, Month: pgDate(month)})
	if err != nil {
		return nil, nil, err
	}
	ext = mustRat(total)
	s.mu.Lock()
	s.cache[teamID] = cached{generation: cfg.Generation, month: month, loc: zone(cfg.TimeZone), spent: spent, ext: ext, at: now}
	s.mu.Unlock()
	return spent, ext, nil
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
// per month and level. nil receivers admit everything.
func (s *Service) Check(ctx context.Context, teamID uuid.UUID) error {
	if s == nil {
		return nil
	}
	st, err := s.status(ctx, teamID, false)
	if err != nil {
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

// pendingTeamsSQL lists teams with pending documents (a loose index scan,
// as in the ingestion dispatcher).
const pendingTeamsSQL = `
WITH RECURSIVE t AS (
    (SELECT team_id FROM documents WHERE status = 'pending' AND team_id IS NOT NULL ORDER BY team_id LIMIT 1)
    UNION ALL
    SELECT (SELECT d.team_id FROM documents d WHERE d.status = 'pending' AND d.team_id > t.team_id ORDER BY d.team_id LIMIT 1)
    FROM t WHERE t.team_id IS NOT NULL
)
SELECT team_id FROM t WHERE team_id IS NOT NULL`

// BlockedTeams lists the teams with pending documents whose enforced budget
// is used up: the ingestion dispatcher skips them.
func (s *Service) BlockedTeams(ctx context.Context) ([]uuid.UUID, error) {
	if s == nil {
		return nil, nil
	}
	st, err := s.current(ctx)
	if err != nil {
		return nil, err
	}
	enforced, err := s.q.EnforcedTeamOverrides(ctx)
	if err != nil || (st.Mode != ModeEnforce && len(enforced) == 0) {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, pendingTeamsSQL)
	if err != nil {
		return nil, err
	}
	pending, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, err
	}
	var out []uuid.UUID
	for _, t := range pending {
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
