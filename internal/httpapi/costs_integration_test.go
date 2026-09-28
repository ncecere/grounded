package httpapi_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// budgetError is a 429 budget_exhausted body.
type budgetError struct {
	Error struct {
		Code    string
		Message string
		Details struct {
			Budget, Spent, Currency, ResetsAt string
		}
	}
}

func setCostSettings(t *testing.T, admin *session, mode string) {
	t.Helper()
	var st apitypes.CostSettings
	if code := admin.get("/v1/admin/costs/settings", &st); code != 200 {
		t.Fatalf("cost settings = %d", code)
	}
	body := map[string]any{"mode": mode, "currency": "USD", "timeZone": "UTC", "warnPercent": 80, "defaultBudget": nil}
	code, e := admin.call("PUT", "/v1/admin/costs/settings", body, nil, ifMatch(st.Revision))
	mustCode(t, "cost settings", code, e, 200, "")
}

func setTeamBudget(t *testing.T, admin *session, team, mode string, amount any) apitypes.TeamBudget {
	t.Helper()
	var tb apitypes.TeamBudget
	path := "/v1/admin/teams/" + team + "/budget"
	if code := admin.get(path, &tb); code != 200 {
		t.Fatalf("team budget = %d", code)
	}
	code, e := admin.call("PUT", path, map[string]any{"mode": mode, "amount": amount, "warnPercent": nil}, &tb, ifMatch(tb.Revision))
	mustCode(t, "team budget", code, e, 200, "")
	return tb
}

func chatOnce(t *testing.T, s *session, path string) (int, []byte) {
	t.Helper()
	return s.raw("POST", path, map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, nil)
}

// Costs end to end: with the mode off nothing changes; prices and an
// enforced budget refuse chats (every channel) and retrieval at 100%,
// ingestion and crawls wait, the owners and admins are notified once, and an
// extension brings everything back at once.
func TestBudgetEnforcement(t *testing.T) {
	env := newPublishEnv(t)
	admin, owner, member := env.admin, env.owner, env.member
	ag := env.publishAgent(t, "Budget helper", env.agentConfig(env.kb.Id.String()))
	pub := env.publicAgent(t, "Open help")
	chatPath := env.chatPath(ag.Slug)

	// Off (the default): no spend view, no banner state, chats as before.
	if code, e := owner.call("GET", env.base+"/spend", nil, nil, nil); code != 404 || e != "costs_off" {
		t.Fatalf("spend while off = %d %s", code, e)
	}
	var banner apitypes.TeamBudgetBanner
	if code := member.get(env.base+"/budget-status", &banner); code != 200 || banner.State != "none" || banner.Amounts != nil {
		t.Fatalf("banner while off = %d %+v", code, banner)
	}
	// Admin writes need a revision.
	if code, e := admin.call("PUT", "/v1/admin/costs/settings", map[string]any{"mode": "track", "currency": "USD", "timeZone": "UTC",
		"warnPercent": 80, "defaultBudget": nil}, nil, nil); code != 428 {
		t.Fatalf("settings without If-Match = %d %s", code, e)
	}
	if code, e := admin.call("PUT", "/v1/admin/costs/settings", map[string]any{"mode": "track", "currency": "USD", "timeZone": "Mars/Base",
		"warnPercent": 80, "defaultBudget": nil}, nil, ifMatch(1)); code != 400 || e != "invalid_time_zone" {
		t.Fatalf("unknown zone = %d %s", code, e)
	}
	today := time.Now().UTC().Format(time.DateOnly)
	var mp apitypes.ModelPricing
	code, e := admin.call("POST", "/v1/admin/models/"+env.chat.Id.String()+"/prices", map[string]any{"effectiveFrom": today,
		"prices": []any{map[string]any{"unit": "chat_tokens_in", "price": "1000000"}, map[string]any{"unit": "chat_tokens_out", "price": "1000000"}}}, &mp, nil)
	mustCode(t, "prices", code, e, 201, "")
	if len(mp.History) != 2 || mp.Current[0].Price == nil || *mp.Current[0].Price != "1000000.000000" {
		t.Fatalf("pricing = %+v", mp)
	}
	code, e = admin.call("POST", "/v1/admin/models/"+env.chat.Id.String()+"/prices", map[string]any{"effectiveFrom": today,
		"prices": []any{map[string]any{"unit": "chat_tokens_in", "price": "2"}}}, nil, nil)
	mustCode(t, "a second price on the same day", code, e, 409, "price_exists")

	setCostSettings(t, admin, "enforce")
	setTeamBudget(t, admin, env.team, "inherit", "1000000")
	if code, raw := chatOnce(t, member, chatPath); code != 200 {
		t.Fatalf("chat under budget = %d %s", code, raw)
	}
	var sp apitypes.TeamSpend
	if code := owner.get(env.base+"/spend", &sp); code != 200 || sp.Status.Spent == nil || *sp.Status.Spent == "0.000000" || len(sp.Agents) == 0 {
		t.Fatalf("spend = %d %+v", code, sp)
	}
	if code, e := member.call("GET", env.base+"/spend", nil, nil, nil); code != 403 {
		t.Fatalf("a member read the spend: %d %s", code, e)
	}

	// Lower the budget to what was spent: everything that calls a model stops.
	tb := setTeamBudget(t, admin, env.team, "inherit", *sp.Status.Spent)
	if tb.Status.State != "exhausted" {
		t.Fatalf("state = %+v", tb.Status)
	}
	for range 2 {
		code, raw := chatOnce(t, member, chatPath)
		var be budgetError
		_ = json.Unmarshal(raw, &be)
		if code != 429 || be.Error.Code != "budget_exhausted" || be.Error.Details.Currency != "USD" || be.Error.Details.Budget != *sp.Status.Spent ||
			be.Error.Details.ResetsAt == "" {
			t.Fatalf("chat at 100%% = %d %s", code, raw)
		}
	}
	code, raw := owner.raw("POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve", map[string]any{"query": "parking"}, nil)
	if code != 429 || !strings.Contains(string(raw), "budget_exhausted") {
		t.Fatalf("retrieve at 100%% = %d %s", code, raw)
	}
	v := newVisitor(t, env.app.URL)
	if code, e := v.start(pub.Id, "", ""); code != 201 {
		t.Fatalf("public session = %d %s", code, e)
	}
	if code, _, e := v.ask(pub.Id, "Where do students buy a parking permit?"); code != 503 || e != "agent_unavailable" {
		t.Fatalf("anonymous chat at 100%% = %d %s", code, e)
	}
	if code := member.get(env.base+"/budget-status", &banner); code != 200 || banner.State != "exhausted" || banner.Amounts != nil || banner.ResetsAt == nil {
		t.Fatalf("member banner = %d %+v", code, banner)
	}
	if code := owner.get(env.base+"/budget-status", &banner); code != 200 || banner.Amounts == nil || banner.Amounts.Currency != "USD" {
		t.Fatalf("owner banner = %d %+v", code, banner)
	}

	// Notified once: the owner and the team admin, not the member.
	if n := env.scalar(t, `SELECT count(*) FROM notification_events WHERE type = 'team.budget_exhausted'`); n != 1 {
		t.Fatalf("budget events = %d", n)
	}
	if n := env.scalar(t, `SELECT count(DISTINCT n.user_id) FROM notifications n JOIN users u ON u.id = n.user_id
		WHERE n.type = 'team.budget_exhausted' AND u.email IN ('user@localhost', 'casey@localhost')`); n != 2 {
		t.Fatalf("notified owners and admins = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.type LIKE 'team.budget%' AND u.email = 'blair@localhost'`); n != 0 {
		t.Fatal("a member was notified")
	}

	// Ingestion waits (nothing fails); a crawl waits.
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	code, results, e := owner.uploadFiles(docs, []upload{{"budget.md", []byte("# Budget\n\nThe budget office is in Hall B.\n")}}, "")
	if code != 200 || results[0].Status != "created" {
		t.Fatalf("upload while blocked = %d %s", code, e)
	}
	docPath := docs + "/" + results[0].Document.Id.String()
	for range 20 {
		var d apitypes.Document
		owner.get(docPath, &d)
		if d.Status != "pending" {
			t.Fatalf("document while blocked = %s", d.Status)
		}
		time.Sleep(150 * time.Millisecond)
	}
	web := env.createWeb(t, owner, env.base+"/sources", "Budget site", map[string]any{"mode": "scrape", "urls": []string{env.site.url("/")}})
	webPath := env.base + "/sources/" + web.Id.String()
	eventually(t, "the crawl waits for the budget", func() bool {
		var list []apitypes.Crawl
		owner.get(webPath+"/crawls", &list)
		return len(list) > 0 && list[0].WaitingReason != nil && *list[0].WaitingReason == "monthly_budget" && list[0].WaitingUntil != nil
	})

	// An extension wakes everything at once.
	var after apitypes.TeamBudget
	code, e = admin.call("POST", "/v1/admin/teams/"+env.team+"/budget/extensions", map[string]any{"amount": "1000000", "reason": "Exam period"}, &after, nil)
	mustCode(t, "extension", code, e, 201, "")
	if after.Status.State != "ok" || len(after.Extensions) != 1 || after.Extensions[0].Reason != "Exam period" {
		t.Fatalf("after the extension = %+v", after)
	}
	eventually(t, "the waiting document is ingested", func() bool {
		var d apitypes.Document
		owner.get(docPath, &d)
		return d.Status == "ready"
	})
	if run := waitCrawl(t, owner, webPath, web.ActiveCrawl.Id); run.Status != "completed" {
		t.Fatalf("crawl after the extension = %+v", run)
	}
	if code, raw := chatOnce(t, member, chatPath); code != 200 {
		t.Fatalf("chat after the extension = %d %s", code, raw)
	}

	// Admin views and the audit trail.
	var list apitypes.BudgetList
	if code := env.auditor.get("/v1/admin/costs/budgets", &list); code != 200 || list.Mode != "enforce" || len(list.Items) == 0 {
		t.Fatalf("budgets = %d %+v", code, list)
	}
	var rep apitypes.CostReport
	if code := env.auditor.get("/v1/admin/costs/report?from="+today+"&to="+today+"&groupBy=agent", &rep); code != 200 || rep.Total.Spend == "0.000000" ||
		rep.Rows[0].Label != "Budget helper" {
		t.Fatalf("report = %d %+v", code, rep)
	}
	res := getRaw(t, env.auditor, "/v1/admin/costs/report.csv?from="+today+"&to="+today+"&groupBy=model")
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "text/csv; charset=utf-8" {
		t.Fatalf("csv = %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	if body, _ := io.ReadAll(res.Body); !strings.HasPrefix(string(body), "model_id,model_name,model_kind,currency,spend") || !strings.Contains(string(body), "Chat Tools") {
		t.Fatalf("csv = %s", body)
	}
	if code, e := env.auditor.call("POST", "/v1/admin/teams/"+env.team+"/budget/extensions", map[string]any{"amount": "1", "reason": "x"}, nil, nil); code != 403 {
		t.Fatalf("an auditor granted an extension: %d %s", code, e)
	}
	for _, action := range []string{"costs.settings_update", "costs.price_add", "costs.budget_update", "costs.extension_grant"} {
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = $1`, action); n == 0 {
			t.Errorf("no %s audit entry", action)
		}
	}
	var ov apitypes.AdminOverview
	if code := admin.get("/v1/admin/overview", &ov); code != 200 || ov.TeamsNearBudget == nil {
		t.Fatalf("overview = %d %+v", code, ov)
	}
}

func getRaw(t *testing.T, s *session, path string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("GET", s.app.URL+path, nil)
	res, err := s.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}
