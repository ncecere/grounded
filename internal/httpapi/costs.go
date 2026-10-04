package httpapi

import (
	"bytes"
	"math/big"
	"net/http"
	"time"

	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// Costs and budgets (docs/costs.md): settings, prices, reports, budgets
// and a team's own spend.

// costsRoutes: Admin → Costs, model prices, team budgets and team spend.
func (a *api) costsRoutes() []route {
	return []route{
		{"GET", "/v1/admin/costs/settings", a.admin(a.adminGetCostSettings)},
		{"PUT", "/v1/admin/costs/settings", a.admin(a.adminUpdateCostSettings)},
		{"GET", "/v1/admin/costs/prices", a.admin(a.adminListCostPrices)},
		{"GET", "/v1/admin/models/{modelId}/prices", a.admin(a.adminGetModelPrices)},
		{"POST", "/v1/admin/models/{modelId}/prices", a.admin(a.adminAddModelPrices)},
		{"DELETE", "/v1/admin/models/{modelId}/prices/{priceId}", a.admin(a.adminDeleteModelPrice)},
		{"GET", "/v1/admin/costs/report", a.admin(a.adminGetCostReport)},
		{"GET", "/v1/admin/costs/report.csv", a.admin(a.adminExportCostReport)},
		{"GET", "/v1/admin/costs/budgets", a.admin(a.adminListBudgets)},
		{"GET", "/v1/admin/teams/{team}/budget", a.admin(a.adminGetTeamBudget)},
		{"PUT", "/v1/admin/teams/{team}/budget", a.admin(a.adminUpdateTeamBudget)},
		{"POST", "/v1/admin/teams/{team}/budget/extensions", a.admin(a.adminGrantBudgetExtension)},
		{"DELETE", "/v1/admin/teams/{team}/budget/extensions/{extensionId}", a.admin(a.adminRevokeBudgetExtension)},
		{"GET", "/v1/teams/{team}/spend", a.session(a.getTeamSpend)},
		{"GET", "/v1/teams/{team}/budget-status", a.session(a.getTeamBudgetStatus)},
	}
}

func money(r *big.Rat) string { return costs.Format(r) }

func optMoney(r *big.Rat) *string {
	if r == nil {
		return nil
	}
	s := costs.Format(r)
	return &s
}

func toAPICostSettings(st costs.Settings) apitypes.CostSettings {
	return apitypes.CostSettings{Mode: apitypes.CostMode(st.Mode), Currency: st.Currency, TimeZone: st.TimeZone, WarnPercent: st.WarnPercent,
		DefaultBudget: optMoney(st.DefaultBudget), Revision: st.Revision, UpdatedAt: st.UpdatedAt}
}

func (a *api) adminGetCostSettings(w http.ResponseWriter, r *http.Request) {
	st, err := a.Costs.Settings(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPICostSettings(st))
}

func (a *api) adminUpdateCostSettings(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.CostSettingsUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.Costs.UpdateSettings(r.Context(), a.actor(r), costs.SettingsInput{
		Mode: string(in.Mode), Currency: in.Currency, TimeZone: in.TimeZone, WarnPercent: in.WarnPercent, DefaultBudget: in.DefaultBudget,
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPICostSettings(st))
}

func unitPrices(list []costs.UnitPrice) []apitypes.UnitPrice {
	out := make([]apitypes.UnitPrice, len(list))
	for i, u := range list {
		out[i] = apitypes.UnitPrice{Unit: apitypes.PriceUnit(u.Unit), Price: optMoney(u.Price)}
		if u.EffectiveFrom != nil {
			d := date(*u.EffectiveFrom)
			out[i].EffectiveFrom = &d
		}
	}
	return out
}

func toAPIPricing(mp costs.ModelPricing) apitypes.ModelPricing {
	out := apitypes.ModelPricing{ModelId: mp.Model.ID, ModelKey: mp.Model.Key, DisplayName: mp.Model.DisplayName, Kind: mp.Model.Kind,
		Currency: mp.Currency, Units: []apitypes.PriceUnit{}, Current: unitPrices(mp.Current), History: []apitypes.ModelPrice{}}
	for _, u := range mp.Units {
		out.Units = append(out.Units, apitypes.PriceUnit(u))
	}
	for _, p := range mp.History {
		out.History = append(out.History, apitypes.ModelPrice{Id: p.ID, Unit: apitypes.PriceUnit(p.Unit), Price: money(p.Price),
			EffectiveFrom: date(p.EffectiveFrom), CreatedAt: p.CreatedAt, CreatedByName: p.CreatedByName})
	}
	return out
}

func (a *api) adminListCostPrices(w http.ResponseWriter, r *http.Request) {
	list, err := a.Costs.Prices(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	out := apitypes.CostPriceList{Currency: list.Currency, Items: []apitypes.CostPriceItem{}}
	for _, it := range list.Items {
		out.Items = append(out.Items, apitypes.CostPriceItem{ModelId: it.Model.ID, ModelKey: it.Model.Key, DisplayName: it.Model.DisplayName,
			Kind: it.Model.Kind, Enabled: it.Model.Enabled, Current: unitPrices(it.Current), Unpriced: it.Unpriced})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminGetModelPrices(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "modelId")
	if !ok {
		return
	}
	mp, err := a.Costs.ModelPrices(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIPricing(mp))
}

func (a *api) adminAddModelPrices(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "modelId")
	if !ok {
		return
	}
	var in apitypes.ModelPricesCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	prices := make([]costs.PriceInput, len(in.Prices))
	for i, p := range in.Prices {
		prices[i] = costs.PriceInput{Unit: string(p.Unit), Price: p.Price}
	}
	mp, err := a.Costs.AddPrices(r.Context(), a.actor(r), id, in.EffectiveFrom.Time, prices)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPIPricing(mp))
}

func (a *api) adminDeleteModelPrice(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "modelId")
	if !ok {
		return
	}
	priceID, ok := pathUUID(w, r, "priceId")
	if !ok {
		return
	}
	writeOK(w, r, a.Costs.DeletePrice(r.Context(), a.actor(r), id, priceID))
}

func totals(t *costs.Totals) (apitypes.CostByKind, apitypes.CostTotals) {
	by := apitypes.CostByKind{Chat: money(t.ByCategory["chat"]), Embedding: money(t.ByCategory["embedding"]),
		Systemone: money(t.ByCategory["systemone"]), Moderation: money(t.ByCategory["moderation"]),
		Ocr: money(t.ByCategory["ocr"]), Mcp: money(t.ByCategory["mcp"]), Rerank: money(t.ByCategory["rerank"])}
	return by, apitypes.CostTotals{Spend: money(t.Spend), ByKind: by, Tokens: t.Tokens, Requests: t.Requests, Unpriced: t.Unpriced}
}

func reportRows(rows []costs.ReportRow) []apitypes.CostReportRow {
	out := make([]apitypes.CostReportRow, len(rows))
	for i, row := range rows {
		by, _ := totals(row.Totals)
		out[i] = apitypes.CostReportRow{Key: row.Key, Label: row.Label, Deleted: row.Deleted, Spend: money(row.Spend), ByKind: by,
			Tokens: row.Tokens, Requests: row.Requests, Unpriced: row.Unpriced}
		if row.TeamSlug != "" {
			out[i].TeamSlug, out[i].TeamName = &row.TeamSlug, &row.TeamName
		}
		if row.ModelKind != "" {
			out[i].ModelKind = &row.ModelKind
		}
	}
	return out
}

// reportFilter reads from, to and groupBy.
func reportFilter(w http.ResponseWriter, r *http.Request) (costs.ReportFilter, bool) {
	q := r.URL.Query()
	from, err := costs.ParseDay(q.Get("from"), "from date")
	if failed(w, r, err) {
		return costs.ReportFilter{}, false
	}
	to, err := costs.ParseDay(q.Get("to"), "to date")
	if failed(w, r, err) {
		return costs.ReportFilter{}, false
	}
	return costs.ReportFilter{From: from, To: to, GroupBy: q.Get("groupBy")}, true
}

func (a *api) adminGetCostReport(w http.ResponseWriter, r *http.Request) {
	f, ok := reportFilter(w, r)
	if !ok {
		return
	}
	rep, err := a.Costs.Report(r.Context(), a.actor(r), f)
	if failed(w, r, err) {
		return
	}
	_, total := totals(rep.Total)
	httpx.JSON(w, http.StatusOK, apitypes.CostReport{From: date(rep.From), To: date(rep.To), GroupBy: apitypes.CostReportGroupBy(rep.GroupBy),
		Currency: rep.Currency, TimeZone: rep.TimeZone, Total: total, Rows: reportRows(rep.Rows)})
}

// adminExportCostReport sends the report as a CSV attachment.
func (a *api) adminExportCostReport(w http.ResponseWriter, r *http.Request) {
	f, ok := reportFilter(w, r)
	if !ok {
		return
	}
	rep, err := a.Costs.Report(r.Context(), a.actor(r), f)
	if failed(w, r, err) {
		return
	}
	var buf bytes.Buffer
	if err := costs.WriteCSV(&buf, rep); err != nil {
		failed(w, r, err)
		return
	}
	name := "costs-by-" + rep.GroupBy + "-" + rep.From.Format(time.DateOnly) + "-to-" + rep.To.Format(time.DateOnly) + ".csv"
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}
