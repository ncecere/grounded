package httpapi_test

import (
	"testing"
	"time"
)

// Classification of costs and budgets (docs/costs.md §6): platform admins
// change prices, settings, budgets and extensions; auditors read the admin
// views; a team's owners and admins read its spend; every member reads its
// budget state (without amounts). API keys never reach them. The matrix
// runs with the platform mode on track (seedPlatform), so a team's spend is
// readable.

func init() {
	for id, p := range costAdminPolicies {
		p.scope = scopeGlobal
		register(id, p)
	}
	for id, p := range costTeamPolicies {
		p.scope = scopeTeam
		register(id, p)
	}
}

const costReport = "/v1/admin/costs/report?from=2026-09-01&to=2026-09-30&groupBy="

var costAdminPolicies = map[string]policy{
	"adminGetCostSettings": adminRead("/v1/admin/costs/settings"),
	"adminUpdateCostSettings": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/costs/settings"
		return put(p, map[string]any{"mode": "track", "currency": "USD", "timeZone": "UTC", "warnPercent": 80, "defaultBudget": nil}).h(c.rev(p))
	}},
	"adminListCostPrices": adminRead("/v1/admin/costs/prices"),
	"adminGetModelPrices": {own: platform, build: func(c *mctx) request { return get("/v1/admin/models/" + c.e.chat.Id.String() + "/prices") }},
	"adminAddModelPrices": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/models/"+c.e.chat.Id.String()+"/prices", map[string]any{"effectiveFrom": c.e.priceDate(),
			"prices": []any{map[string]any{"unit": "chat_tokens_in", "price": "0.5"}}})
	}},
	"adminDeleteModelPrice": {own: padmin, build: func(c *mctx) request {
		return del("/v1/admin/models/" + c.e.chat.Id.String() + "/prices/" + c.pickP(c.e.price, c.e.freshPrice))
	}},
	"adminGetCostReport":    adminRead(costReport + "team"),
	"adminExportCostReport": adminRead("/v1/admin/costs/report.csv?from=2026-09-01&to=2026-09-30&groupBy=agent"),
	"adminListBudgets":      adminRead("/v1/admin/costs/budgets"),
	"adminGetTeamBudget":    {own: platform, build: func(c *mctx) request { return get("/v1/admin/teams/" + c.e.b.slug + "/budget") }},
	"adminUpdateTeamBudget": {own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/teams/" + c.e.b.slug + "/budget"
		return put(p, map[string]any{"mode": "inherit", "amount": nil, "warnPercent": nil}).h(c.rev(p))
	}},
	"adminGrantBudgetExtension": {own: padmin, build: func(c *mctx) request {
		return post("/v1/admin/teams/"+c.e.b.slug+"/budget/extensions", map[string]any{"amount": "1", "reason": "Authorization matrix"})
	}},
	"adminRevokeBudgetExtension": {own: padmin, build: func(c *mctx) request {
		return del("/v1/admin/teams/" + c.e.b.slug + "/budget/extensions/" + c.e.freshExtension(c.t))
	}},
}

// freshExtension grants team B an extension this month and returns its id.
func (e *matrixEnv) freshExtension(t *testing.T) string {
	body := map[string]any{"amount": "1", "reason": "Authorization matrix"}
	return field(must(t, e.admin, "POST", "/v1/admin/teams/"+e.b.slug+"/budget/extensions", body, nil), "extensions.0.id")
}

var costTeamPolicies = map[string]policy{
	"getTeamSpend":        {own: admins, foreign: platform, build: func(c *mctx) request { return get(c.team("/spend")) }},
	"getTeamBudgetStatus": {own: members, foreign: platform, build: func(c *mctx) request { return get(c.team("/budget-status")) }},
}

// priceDate is a date no price row uses yet (one a day from 2001).
func (e *matrixEnv) priceDate() string {
	return time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, int(e.next())).Format(time.DateOnly)
}
