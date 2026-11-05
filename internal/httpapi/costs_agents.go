package httpapi

import (
	"net/http"
	"sort"

	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Per-agent budgets (docs/specs/agent-budgets/DESIGN.md): the team's owners and admins set them.

func toAPIAgentBudget(st costs.AgentStatus) apitypes.AgentBudget {
	return apitypes.AgentBudget{AgentId: st.AgentID, Amount: optMoney(st.Budget), Spent: optMoney(st.Spent), Currency: st.Team.Currency,
		State: apitypes.BudgetState(st.State), Enforced: st.Enforced(), ResetsAt: st.Team.ResetsAt, Revision: st.Revision}
}

func (a *api) getAgentBudget(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	st, err := a.Costs.AgentBudget(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIAgentBudget(st))
}

func (a *api) putAgentBudget(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.PutAgentBudgetJSONRequestBody](w, r)
	if !ok {
		return
	}
	st, err := a.Costs.SetAgentBudget(r.Context(), a.actor(r), r.PathValue("team"), id, in.Amount, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIAgentBudget(st))
}

// agentBudgets is the team's agent budgets for /spend, in a stable order.
func (a *api) agentBudgets(r *http.Request, sp costs.TeamSpend) ([]apitypes.AgentBudget, error) {
	m, err := a.Costs.AgentBudgets(r.Context(), sp.Status.TeamID)
	if err != nil {
		return nil, err
	}
	out := make([]apitypes.AgentBudget, 0, len(m))
	for _, st := range m {
		out = append(out, toAPIAgentBudget(st))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AgentId.String() < out[j].AgentId.String() })
	return out, nil
}
