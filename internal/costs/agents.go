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
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Per-agent budgets (E17; docs/specs/agent-budgets/DESIGN.md): a monthly cap on one agent's spend inside its team's
// budget, set by the team's owners and admins. Enforced only when the team's effective mode is Enforce.

// AgentStatus is an agent's budget state this month.
type AgentStatus struct {
	AgentID uuid.UUID
	Team    Status // the team's status (mode, month, currency, threshold)
	Budget  *big.Rat
	Spent   *big.Rat // month to date (nil while the mode is off)
	State   string
	// Revision is the budget's revision for If-Match (NoBudgetRevision: no budget).
	Revision int64
}

// Enforced reports whether the agent's budget can refuse its chats.
func (st AgentStatus) Enforced() bool { return st.Team.Enforced() && st.Budget != nil }

// agentStatus computes an agent's state from the team's cached month to date.
func (s *Service) agentStatus(ctx context.Context, teamID, agentID uuid.UUID, fresh bool) (AgentStatus, error) {
	team, err := s.status(ctx, teamID, fresh)
	if err != nil {
		return AgentStatus{}, err
	}
	out := AgentStatus{AgentID: agentID, Team: team, State: StateNone, Revision: NoBudgetRevision}
	b, err := s.q.GetAgentBudget(ctx, agentID)
	if err == nil {
		out.Budget, out.Revision = mustRat(b.Amount), b.Revision
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return AgentStatus{}, err
	}
	if team.Mode == ModeOff {
		return out, nil
	}
	cfg, err := s.teamConfig(ctx, teamID)
	if err != nil {
		return AgentStatus{}, err
	}
	_, _, agents, err := s.monthToDate(ctx, cfg, teamID, team.Month, team.Start, team.ResetsAt, false)
	if err != nil {
		return AgentStatus{}, err
	}
	out.Spent = new(big.Rat)
	if v := agents[agentID]; v != nil {
		out.Spent = v
	}
	if out.Budget != nil {
		out.State = stateOf(out.Spent, out.Budget, team.WarnPercent)
		if out.State == StateWarning || out.State == StateExhausted {
			s.markNear(teamID)
		}
	}
	return out, nil
}

// NoBudgetRevision is the revision of an agent without a budget; a new budget starts at 2.
const NoBudgetRevision = 1

// ErrCodeAgentExhausted is the error code of a refusal at 100% of an agent's budget.
const ErrCodeAgentExhausted = "agent_budget_exhausted"

// agentExhausted is the 429 refusal of an agent's chats. The message names no amount (editors and members see it).
func agentExhausted(st AgentStatus) *apperr.Error {
	resets := st.Team.ResetsAt.In(st.Team.Location).Format("Jan 2, 2006")
	return &apperr.Error{
		Status: http.StatusTooManyRequests, Code: ErrCodeAgentExhausted,
		Message: fmt.Sprintf("This agent's monthly budget is used up. It resets on %s, or the team's owners or admins can raise it.", resets),
		Details: map[string]any{"budget": Format(st.Budget), "spent": Format(st.Spent), "currency": st.Team.Currency,
			"resetsAt": st.Team.ResetsAt.UTC().Format(time.RFC3339), "agentId": st.AgentID.String()},
		RetryAfter: time.Until(st.Team.ResetsAt),
	}
}

// IsAgentExhausted reports an agent_budget_exhausted refusal.
func IsAgentExhausted(err error) bool {
	e, ok := apperr.As(err)
	return ok && e.Code == ErrCodeAgentExhausted
}

// CheckAgent admits a chat of an agent: 429 agent_budget_exhausted when its enforced budget is used up. The team's own
// budget is checked separately (Check), first. Owners and admins are notified at the threshold and at 100%, once per agent,
// month and level. nil receivers admit everything.
func (s *Service) CheckAgent(ctx context.Context, teamID, agentID uuid.UUID) error {
	if s == nil {
		return nil
	}
	st, err := s.agentStatus(ctx, teamID, agentID, false)
	if err != nil || !st.Enforced() {
		return err
	}
	switch st.State {
	case StateWarning:
		s.agentNotice(ctx, st, LevelWarning)
	case StateExhausted:
		s.agentNotice(ctx, st, LevelExhausted)
		return agentExhausted(st)
	}
	return nil
}

// agentNotice records a level once per agent and month and runs OnNotice with the agent, in the same transaction.
func (s *Service) agentNotice(ctx context.Context, st AgentStatus, level string) {
	key := "agent:" + st.AgentID.String() + ":" + st.Team.Month.Format(time.DateOnly) + ":" + level
	if _, dup := s.noticed.Load(key); dup {
		return
	}
	ctx = context.WithoutCancel(ctx)
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		inserted, err := q.InsertAgentBudgetNotice(ctx, dbgen.InsertAgentBudgetNoticeParams{AgentID: st.AgentID, Month: pgDate(st.Team.Month), Level: level})
		if err != nil || inserted == 0 || s.OnNotice == nil {
			return err
		}
		ag, err := q.GetAgent(ctx, st.AgentID)
		if err != nil {
			return err
		}
		return s.OnNotice(ctx, tx, Notice{TeamID: st.Team.TeamID, Level: level, Month: st.Team.Month, Spent: st.Spent, Limit: st.Budget,
			Currency: st.Team.Currency, WarnPercent: st.Team.WarnPercent, ResetsAt: st.Team.ResetsAt, TimeZone: st.Team.Location,
			AgentID: uuid.NullUUID{UUID: ag.ID, Valid: true}, AgentName: ag.Name})
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		if s.Log != nil {
			s.Log.WarnContext(ctx, "could not record an agent budget notice", "agent", st.AgentID, "level", level, "err", err)
		}
		return
	}
	s.noticed.Store(key, struct{}{})
}

// teamAgent resolves a team the actor can reach and one of its agents, for the owners and admins of the team (never a key)
// and platform staff; write requires an owner, an admin or a platform admin.
func (s *Service) teamAgent(ctx context.Context, a authz.Actor, teamRef string, agentID uuid.UUID, write bool) (dbgen.Team, dbgen.Agent, error) {
	acc, err := s.teams.Get(ctx, a, teamRef)
	if err != nil {
		return dbgen.Team{}, dbgen.Agent{}, err
	}
	owner := a.Key == nil && authz.RoleAtLeast(acc.Role, authz.RoleAdmin)
	staff := a.Key == nil && (a.IsPlatformAdmin() || (!write && a.CanReadPlatform()))
	if !owner && !staff {
		return dbgen.Team{}, dbgen.Agent{}, apperr.Forbidden("Only the team's owners and admins can see and set its agents' budgets")
	}
	ag, err := s.q.GetAgent(ctx, agentID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && ag.TeamID != acc.Team.ID) {
		return dbgen.Team{}, dbgen.Agent{}, apperr.NotFound("not_found", "Agent not found")
	}
	return acc.Team, ag, err
}

// AgentBudget is an agent's budget and spend this month (404 costs_off while the team's mode is off).
func (s *Service) AgentBudget(ctx context.Context, a authz.Actor, teamRef string, agentID uuid.UUID) (AgentStatus, error) {
	t, _, err := s.teamAgent(ctx, a, teamRef, agentID, false)
	if err != nil {
		return AgentStatus{}, err
	}
	st, err := s.agentStatus(ctx, t.ID, agentID, false)
	if err == nil && st.Team.Mode == ModeOff {
		return AgentStatus{}, errCostsOff
	}
	return st, err
}

// SetAgentBudget sets or (amount nil) removes an agent's budget: the team's owners and admins, or a platform admin.
// expectedRevision is the budget's revision (NoBudgetRevision when it has none). Audited as costs.agent_budget_update.
func (s *Service) SetAgentBudget(ctx context.Context, a authz.Actor, teamRef string, agentID uuid.UUID, amount *string, expectedRevision int64) (AgentStatus, error) {
	t, ag, err := s.teamAgent(ctx, a, teamRef, agentID, true)
	if err != nil {
		return AgentStatus{}, err
	}
	var amt *big.Rat
	if amount != nil {
		if amt, err = ParseAmount(*amount, "budget"); err != nil {
			return AgentStatus{}, err
		}
	}
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.GetAgentBudget(ctx, agentID)
		rev := cur.Revision
		if errors.Is(err, pgx.ErrNoRows) {
			rev, err = NoBudgetRevision, nil
		}
		if err != nil {
			return err
		}
		if rev != NoBudgetRevision {
			if rev, err = q.LockAgentBudget(ctx, agentID); err != nil {
				return err
			}
		}
		if rev != expectedRevision {
			return apperr.Stale()
		}
		if amt == nil {
			_, err = q.DeleteAgentBudget(ctx, agentID)
		} else {
			_, err = q.UpsertAgentBudget(ctx, dbgen.UpsertAgentBudgetParams{AgentID: agentID, TeamID: t.ID, Amount: Format(amt), UpdatedBy: by(a)})
		}
		if err != nil {
			return err
		}
		if err := q.BumpCostGeneration(ctx); err != nil {
			return err
		}
		e := a.Audit("costs.agent_budget_update", "agent", ag.ID.String())
		e.TeamID = t.ID
		e.Before = map[string]any{"amount": optFormat(optRat(cur.Amount))}
		e.After = map[string]any{"amount": optFormat(amt)}
		e.Metadata = map[string]any{"agentName": ag.Name}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return AgentStatus{}, err
	}
	return s.agentStatus(ctx, t.ID, agentID, true)
}

// AgentBudgets is every budget of a team's agents, with each agent's state (for the team's spend breakdown).
func (s *Service) AgentBudgets(ctx context.Context, teamID uuid.UUID) (map[uuid.UUID]AgentStatus, error) {
	rows, err := s.q.ListAgentBudgets(ctx, teamID)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]AgentStatus, len(rows))
	for _, r := range rows {
		st, err := s.agentStatus(ctx, teamID, r.AgentID, false)
		if err != nil {
			return nil, err
		}
		out[r.AgentID] = st
	}
	return out, nil
}
