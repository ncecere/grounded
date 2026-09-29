package httpapi

import (
	"net/http"
	"sort"

	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

func budgetState(st costs.Status) apitypes.TeamBudgetState {
	return apitypes.TeamBudgetState{Mode: apitypes.CostMode(st.Mode), State: apitypes.BudgetState(st.State), Enforced: st.Enforced(), Currency: st.Currency,
		Month: date(st.Month), ResetsAt: st.ResetsAt, Budget: optMoney(st.Budget), Extensions: optMoney(st.Extensions), Limit: optMoney(st.Limit),
		Spent: optMoney(st.Spent), Percent: percent(st), WarnPercent: st.WarnPercent}
}

func percent(st costs.Status) *int {
	if st.Spent == nil {
		return nil
	}
	return costs.Percent(st.Spent, st.Limit)
}

func (a *api) adminListBudgets(w http.ResponseWriter, r *http.Request) {
	list, err := a.Costs.Budgets(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	out := apitypes.BudgetList{Mode: apitypes.CostMode(list.Settings.Mode), Currency: list.Settings.Currency, TimeZone: list.Settings.TimeZone,
		Month: date(list.Month), ResetsAt: list.ResetsAt, Items: []apitypes.BudgetListItem{}}
	for _, it := range list.Items {
		out.Items = append(out.Items, apitypes.BudgetListItem{TeamId: it.TeamID, TeamSlug: it.TeamSlug, TeamName: it.TeamName,
			ModeOverride: apitypes.CostModeOverride(it.ModeOverride), OwnBudget: it.HasOwnBudget, Status: budgetState(it.Status),
			Projected: optMoney(it.Projected)})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func toAPITeamBudget(tb costs.TeamBudget) apitypes.TeamBudget {
	out := apitypes.TeamBudget{TeamId: tb.Team.ID, TeamSlug: tb.Team.Slug, TeamName: tb.Team.Name, ModeOverride: apitypes.CostModeOverride(tb.ModeOverride),
		Amount: optMoney(tb.Amount), WarnPercent: tb.WarnPercent, DefaultBudget: optMoney(tb.DefaultBudget), Status: budgetState(tb.Status),
		Extensions: []apitypes.BudgetExtension{}, Revision: tb.Revision}
	for _, e := range tb.Extensions {
		out.Extensions = append(out.Extensions, apitypes.BudgetExtension{Id: e.ID, Month: date(e.Month), Amount: money(e.Amount), Reason: e.Reason,
			CreatedByName: e.CreatedByName, CreatedAt: e.CreatedAt})
	}
	return out
}

func (a *api) adminGetTeamBudget(w http.ResponseWriter, r *http.Request) {
	tb, err := a.Costs.TeamBudget(r.Context(), a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, tb.Revision, toAPITeamBudget(tb))
}

func (a *api) adminUpdateTeamBudget(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.TeamBudgetUpdate](w, r)
	if !ok {
		return
	}
	tb, err := a.Costs.UpdateTeamBudget(r.Context(), a.actor(r), r.PathValue("team"),
		costs.TeamBudgetInput{Mode: string(in.Mode), Amount: in.Amount, WarnPercent: in.WarnPercent}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, tb.Revision, toAPITeamBudget(tb))
}

func (a *api) adminGrantBudgetExtension(w http.ResponseWriter, r *http.Request) {
	var in apitypes.BudgetExtensionCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	tb, err := a.Costs.GrantExtension(r.Context(), a.actor(r), r.PathValue("team"), in.Amount, in.Reason)
	if failed(w, r, err) {
		return
	}
	setETag(w, tb.Revision)
	httpx.JSON(w, http.StatusCreated, toAPITeamBudget(tb))
}

func (a *api) getTeamSpend(w http.ResponseWriter, r *http.Request) {
	var from, to *costs.Day
	for name, dst := range map[string]**costs.Day{"from": &from, "to": &to} {
		if v := r.URL.Query().Get(name); v != "" {
			d, err := costs.ParseDay(v, name+" date")
			if failed(w, r, err) {
				return
			}
			*dst = &d
		}
	}
	sp, err := a.Costs.TeamSpend(r.Context(), a.actor(r), r.PathValue("team"), from, to)
	if failed(w, r, err) {
		return
	}
	_, total := totals(sp.Total)
	httpx.JSON(w, http.StatusOK, apitypes.TeamSpend{Status: budgetState(sp.Status), TimeZone: sp.TimeZone, From: date(sp.From), To: date(sp.To),
		Total: total, Agents: reportRows(sp.Agents), Models: reportRows(sp.Models)})
}

func (a *api) getTeamBudgetStatus(w http.ResponseWriter, r *http.Request) {
	bs, err := a.Costs.TeamBudgetStatus(r.Context(), a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	st := bs.Status
	out := apitypes.TeamBudgetBanner{State: apitypes.BudgetState(st.State), Enforced: st.Enforced()}
	if st.State == costs.StateNone {
		httpx.JSON(w, http.StatusOK, out)
		return
	}
	out.ResetsAt = &st.ResetsAt
	if bs.ShowAmounts && st.Limit != nil {
		out.Amounts = &struct {
			Currency string         `json:"currency"`
			Limit    apitypes.Money `json:"limit"`
			Percent  *int           `json:"percent"`
			Spent    apitypes.Money `json:"spent"`
		}{Currency: st.Currency, Limit: money(st.Limit), Percent: percent(st), Spent: money(st.Spent)}
	}
	httpx.JSON(w, http.StatusOK, out)
}

// nearBudget lists enforced teams at or above their warning threshold,
// fullest first, for the admin Overview. Track-only budgets never need
// attention: they show progress on the Budgets tab and nothing else.
func (a *api) nearBudget(r *http.Request) ([]apitypes.AdminNearBudget, error) {
	out := []apitypes.AdminNearBudget{}
	if a.Costs == nil {
		return out, nil
	}
	list, err := a.Costs.Budgets(r.Context(), a.actor(r))
	if err != nil {
		return nil, err
	}
	for _, it := range list.Items {
		st := it.Status
		if !st.Enforced() || (st.State != costs.StateWarning && st.State != costs.StateExhausted) {
			continue
		}
		out = append(out, apitypes.AdminNearBudget{TeamSlug: it.TeamSlug, TeamName: it.TeamName, State: apitypes.AdminNearBudgetState(st.State),
			Percent: percent(st), Spent: money(st.Spent), Limit: money(st.Limit), Currency: st.Currency})
	}
	sortNearBudget(out)
	return out, nil
}

func sortNearBudget(list []apitypes.AdminNearBudget) {
	val := func(p *int) int {
		if p == nil {
			return 0
		}
		return *p
	}
	sort.SliceStable(list, func(i, j int) bool { return val(list[i].Percent) > val(list[j].Percent) })
}
