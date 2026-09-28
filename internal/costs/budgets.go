package costs

import (
	"context"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Team budgets and extensions (docs/costs.md §4): platform admins set them,
// auditors read them.

// BudgetRow is one team on the Budgets tab.
type BudgetRow struct {
	TeamID             uuid.UUID
	TeamSlug, TeamName string
	ModeOverride       string // inherit, off, track, enforce
	Status             Status
	Projected          *big.Rat
	HasOwnBudget       bool // false: the platform default budget applies
}

// BudgetList is every active team's budget state this month.
type BudgetList struct {
	Settings Settings
	Month    Day
	Start    time.Time
	ResetsAt time.Time
	Items    []BudgetRow
}

// Budgets lists every active team's mode, budget and month-to-date spend
// (platform admins and auditors).
func (s *Service) Budgets(ctx context.Context, a authz.Actor) (BudgetList, error) {
	if !canRead(a) {
		return BudgetList{}, errReadOnly
	}
	st, err := s.current(ctx)
	if err != nil {
		return BudgetList{}, err
	}
	now, loc := s.now(), st.Location()
	start, end, month := MonthBounds(now, loc)
	spend, err := s.teamSpend(ctx, st, start, end, uuid.NullUUID{})
	if err != nil {
		return BudgetList{}, err
	}
	extRows, err := s.q.SumBudgetExtensionsByTeam(ctx, pgDate(month))
	if err != nil {
		return BudgetList{}, err
	}
	ext := map[uuid.UUID]*big.Rat{}
	for _, r := range extRows {
		ext[r.TeamID] = mustRat(r.Total)
	}
	teams, err := s.q.ListTeamBudgets(ctx)
	if err != nil {
		return BudgetList{}, err
	}
	out := BudgetList{Settings: st, Month: month, Start: start, ResetsAt: end, Items: make([]BudgetRow, 0, len(teams))}
	for _, t := range teams {
		row := BudgetRow{TeamID: t.ID, TeamSlug: t.Slug, TeamName: t.Name, ModeOverride: t.Mode, HasOwnBudget: t.Amount != ""}
		row.Status = offlineStatus(st, t, start, end, month, spend[t.ID], ext[t.ID])
		if row.Status.Spent != nil {
			row.Projected = Projected(row.Status.Spent, start, end, now)
		}
		out.Items = append(out.Items, row)
	}
	return out, nil
}

// offlineStatus computes a team's status from values already loaded.
func offlineStatus(st Settings, t dbgen.ListTeamBudgetsRow, start, end time.Time, month Day, spend *Totals, ext *big.Rat) Status {
	out := Status{TeamID: t.ID, Mode: EffectiveMode(st.Mode, t.Mode), Currency: st.Currency, Location: st.Location(), Month: month,
		Start: start, ResetsAt: end, WarnPercent: st.WarnPercent, State: StateNone}
	if t.WarnPercent != nil {
		out.WarnPercent = int(*t.WarnPercent)
	}
	if out.Mode == ModeOff {
		return out
	}
	out.Spent = new(big.Rat)
	if spend != nil {
		out.Spent = spend.Spend
	}
	if out.Mode != ModeEnforce {
		return out
	}
	out.Budget, out.Extensions = optRat(t.Amount), new(big.Rat)
	if out.Budget == nil && st.DefaultBudget != nil {
		out.Budget = new(big.Rat).Set(st.DefaultBudget)
	}
	if ext != nil {
		out.Extensions = ext
	}
	if out.Budget != nil {
		out.Limit = new(big.Rat).Add(out.Budget, out.Extensions)
		out.State = stateOf(out.Spent, out.Limit, out.WarnPercent)
	}
	return out
}

// Extension is an amount added to one budget month.
type Extension struct {
	ID            uuid.UUID
	Month         Day
	Amount        *big.Rat
	Reason        string
	CreatedByName string
	CreatedAt     time.Time
}

// TeamBudget is a team's budget settings and state (Admin → Teams → a team).
type TeamBudget struct {
	Team          dbgen.Team
	ModeOverride  string
	Amount        *big.Rat // the team's own budget (nil: the platform default)
	WarnPercent   *int     // the team's own threshold (nil: the platform's)
	DefaultBudget *big.Rat
	Status        Status
	Extensions    []Extension
	Revision      int64
}

// TeamBudget returns a team's budget (platform admins and auditors).
func (s *Service) TeamBudget(ctx context.Context, a authz.Actor, teamRef string) (TeamBudget, error) {
	if !canRead(a) {
		return TeamBudget{}, errReadOnly
	}
	acc, err := s.teams.Get(ctx, a, teamRef)
	if err != nil {
		return TeamBudget{}, err
	}
	return s.teamBudget(ctx, acc.Team)
}

func (s *Service) teamBudget(ctx context.Context, t dbgen.Team) (TeamBudget, error) {
	cfg, err := s.q.TeamCostConfig(ctx, t.ID)
	if err != nil {
		return TeamBudget{}, err
	}
	st, err := s.status(ctx, t.ID, true)
	if err != nil {
		return TeamBudget{}, err
	}
	out := TeamBudget{Team: t, ModeOverride: cfg.TeamMode, Amount: optRat(cfg.Amount), DefaultBudget: optRat(cfg.DefaultBudget),
		Status: st, Revision: cfg.Revision, Extensions: []Extension{}}
	if cfg.WarnPercent != nil {
		w := int(*cfg.WarnPercent)
		out.WarnPercent = &w
	}
	rows, err := s.q.ListBudgetExtensions(ctx, dbgen.ListBudgetExtensionsParams{TeamID: t.ID, Month: pgDate(st.Month)})
	if err != nil {
		return TeamBudget{}, err
	}
	for _, r := range rows {
		name := r.CreatedByName
		if name == "" {
			name = r.CreatedByEmail
		}
		out.Extensions = append(out.Extensions, Extension{ID: r.ID, Month: r.Month.Time, Amount: mustRat(r.Amount), Reason: r.Reason,
			CreatedByName: name, CreatedAt: r.CreatedAt})
	}
	return out, nil
}

// TeamBudgetInput replaces a team's budget settings.
type TeamBudgetInput struct {
	Mode        string  // inherit, off, track, enforce
	Amount      *string // nil: the platform default budget
	WarnPercent *int    // nil: the platform threshold
}

func (in TeamBudgetInput) validate() (*big.Rat, error) {
	if in.Mode != ModeInherit && !ValidMode(in.Mode) {
		return nil, apperr.Invalid("invalid_mode", "The mode must be inherit, off, track or enforce")
	}
	if in.WarnPercent != nil {
		if err := validWarn(*in.WarnPercent); err != nil {
			return nil, err
		}
	}
	if in.Amount == nil {
		return nil, nil
	}
	return ParseAmount(*in.Amount, "budget")
}

// UpdateTeamBudget replaces a team's mode override, budget and threshold
// (platform admins; expectedRevision guards concurrent edits). Audited as
// costs.budget_update.
func (s *Service) UpdateTeamBudget(ctx context.Context, a authz.Actor, teamRef string, in TeamBudgetInput, expectedRevision int64) (TeamBudget, error) {
	if !canWrite(a) {
		return TeamBudget{}, errAdminOnly
	}
	amount, err := in.validate()
	if err != nil {
		return TeamBudget{}, err
	}
	acc, err := s.teams.Get(ctx, a, teamRef)
	if err != nil {
		return TeamBudget{}, err
	}
	teamID := acc.Team.ID
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockTeamBudget(ctx, teamID)
		exists := err == nil
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			cur, err = dbgen.LockTeamBudgetRow{Mode: ModeInherit, Revision: 1}, nil
		}
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		var warn *int32
		if in.WarnPercent != nil {
			w := int32(*in.WarnPercent)
			warn = &w
		}
		if exists {
			err = q.UpdateTeamBudget(ctx, dbgen.UpdateTeamBudgetParams{Mode: in.Mode, Amount: optFormat(amount), WarnPercent: warn,
				UpdatedBy: by(a), TeamID: teamID})
		} else {
			var n int64
			n, err = q.InsertTeamBudget(ctx, dbgen.InsertTeamBudgetParams{TeamID: teamID, Mode: in.Mode, Amount: optFormat(amount),
				WarnPercent: warn, UpdatedBy: by(a)})
			if err == nil && n == 0 {
				err = apperr.Stale()
			}
		}
		if err != nil {
			return err
		}
		if err := q.BumpCostGeneration(ctx); err != nil {
			return err
		}
		e := a.Audit("costs.budget_update", "team", teamID.String())
		e.TeamID = teamID
		e.Before = map[string]any{"mode": cur.Mode, "amount": optFormat(optRat(cur.Amount)), "warnPercent": cur.WarnPercent}
		e.After = map[string]any{"mode": in.Mode, "amount": optFormat(amount), "warnPercent": in.WarnPercent}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return TeamBudget{}, err
	}
	s.changed(ctx, uuid.NullUUID{UUID: teamID, Valid: true})
	return s.teamBudget(ctx, acc.Team)
}

// GrantExtension adds an amount to a team's budget for the current month
// only, with a reason (platform admins). Audited as costs.extension_grant.
func (s *Service) GrantExtension(ctx context.Context, a authz.Actor, teamRef, amount, reason string) (TeamBudget, error) {
	if !canWrite(a) {
		return TeamBudget{}, errAdminOnly
	}
	amt, err := ParseAmount(amount, "extension")
	if err != nil {
		return TeamBudget{}, err
	}
	if amt.Sign() <= 0 {
		return TeamBudget{}, apperr.Invalid("invalid_amount", "The extension must be more than zero")
	}
	reason = strings.TrimSpace(reason)
	if n := len([]rune(reason)); n < 1 || n > 500 {
		return TeamBudget{}, apperr.Invalid("invalid_reason", "Give a reason of 1-500 characters")
	}
	acc, err := s.teams.Get(ctx, a, teamRef)
	if err != nil {
		return TeamBudget{}, err
	}
	st, err := s.current(ctx)
	if err != nil {
		return TeamBudget{}, err
	}
	month := MonthOf(s.now(), st.Location())
	teamID := acc.Team.ID
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		row, err := q.InsertBudgetExtension(ctx, dbgen.InsertBudgetExtensionParams{TeamID: teamID, Month: pgDate(month), Amount: Format(amt),
			Reason: reason, CreatedBy: by(a)})
		if err != nil {
			return err
		}
		if err := q.BumpCostGeneration(ctx); err != nil {
			return err
		}
		e := a.Audit("costs.extension_grant", "team", teamID.String())
		e.TeamID = teamID
		e.After = map[string]any{"extensionId": row.ID, "month": month.Format("2006-01"), "amount": Format(amt), "reason": reason}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return TeamBudget{}, err
	}
	s.changed(ctx, uuid.NullUUID{UUID: teamID, Valid: true})
	return s.teamBudget(ctx, acc.Team)
}
