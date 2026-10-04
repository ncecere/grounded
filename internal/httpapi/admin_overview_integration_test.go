package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The admin Overview counts, teams near their limits, the team content
// counts on the admin team list and the user list's filters and team counts
// (docs/ui-review A1, A7).
func TestAdminOverviewAndListCounts(t *testing.T) {
	env := newRAGEnv(t)
	base := "/v1/teams/" + env.team
	var src apitypes.DataSource
	code, e := env.owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "open"}, &src, nil)
	mustCode(t, "source", code, e, 201, "")
	code, e = env.owner.call("POST", base+"/kbs", map[string]any{"name": "Handbook"}, nil, nil)
	mustCode(t, "kb", code, e, 201, "")
	// One source of two allowed: 50%, not reported; one KB of one: 100%.
	setTeamLimits(t, env.admin, env.team, map[string]any{"data_sources": 2, "knowledge_bases": 1})

	var ov apitypes.AdminOverview
	if code := env.admin.get("/v1/admin/overview", &ov); code != 200 {
		t.Fatalf("overview = %d", code)
	}
	if ov.Teams.Active < 1 || ov.Users.Total < 2 || ov.Users.PlatformAdmins < 1 || ov.Users.SignedInLast7Days < 2 {
		t.Errorf("overview counts = %+v %+v", ov.Teams, ov.Users)
	}
	if len(ov.TeamsNearLimits) != 1 || ov.TeamsNearLimits[0].Key != "knowledge_bases" || ov.TeamsNearLimits[0].Used != 1 || ov.TeamsNearLimits[0].Max != 1 || ov.TeamsNearLimits[0].TeamSlug != env.team {
		t.Errorf("near limits = %+v", ov.TeamsNearLimits)
	}
	if ov.FailedIngest == nil {
		t.Error("failedIngest is null")
	}
	// Production-readiness warnings (E7): the test app has no SMTP.
	if ov.Warnings == nil {
		t.Fatal("warnings missing")
	}
	smtp := false
	for _, w := range *ov.Warnings {
		smtp = smtp || w.Code == "smtp_not_configured"
		if w.Message == "" || w.Fix == "" || !w.Severity.Valid() {
			t.Errorf("warning = %+v", w)
		}
	}
	if !smtp {
		t.Errorf("warnings = %+v, want smtp_not_configured", *ov.Warnings)
	}

	var teams apitypes.TeamPage
	if code := env.admin.get("/v1/admin/teams?q="+env.team, &teams); code != 200 || len(teams.Items) != 1 {
		t.Fatalf("teams = %d %+v", code, teams)
	}
	if got := teams.Items[0]; got.SourceCount != 1 || got.KbCount != 1 || got.AgentCount != 0 || got.DocumentCount != 0 {
		t.Errorf("team counts = %+v", got)
	}
	var one apitypes.TeamSummary
	env.admin.get("/v1/admin/teams/"+env.team, &one)
	if one.SourceCount != 1 || one.KbCount != 1 {
		t.Errorf("team summary counts = %+v", one)
	}

	var admins apitypes.UserPage
	if code := env.admin.get("/v1/admin/users?role=platform_admin", &admins); code != 200 || len(admins.Items) == 0 {
		t.Fatalf("admins = %d %+v", code, admins)
	}
	for _, u := range admins.Items {
		if u.PlatformRole != "platform_admin" {
			t.Errorf("role filter returned %s", u.PlatformRole)
		}
	}
	var users apitypes.UserPage
	env.admin.get("/v1/admin/users?q=user@localhost&status=active", &users)
	if len(users.Items) != 1 || users.Items[0].TeamCount == nil || *users.Items[0].TeamCount != 1 {
		t.Errorf("user team count = %+v", users.Items)
	}
	code, e = env.admin.call("GET", "/v1/admin/users?role=owner", nil, nil, nil)
	mustCode(t, "bad role", code, e, 400, "invalid_role")
	// Catalog usage: the ragEnv's embedding model has one profile, used by the source and the KB.
	var usage apitypes.CatalogUsage
	if code := env.app.signIn("auditor").get("/v1/admin/catalog-usage", &usage); code != 200 {
		t.Fatalf("catalog usage = %d", code)
	}
	profiles := 0
	for _, m := range usage.Models {
		profiles += int(m.Profiles)
	}
	usedProfile := false
	for _, p := range usage.Profiles {
		usedProfile = usedProfile || (p.Sources == 1 && p.KnowledgeBases == 1)
	}
	if profiles < 1 || !usedProfile {
		t.Errorf("catalog usage = %+v", usage)
	}
	code, e = env.owner.call("GET", "/v1/admin/catalog-usage", nil, nil, nil)
	mustCode(t, "owner reads catalog usage", code, e, 403, "forbidden")
	code, e = env.owner.call("GET", "/v1/admin/overview", nil, nil, nil)
	mustCode(t, "owner reads overview", code, e, 403, "forbidden")
}

// TestAdminFeatures: the Overview's Features card and setup checklist in one
// response (AD-03), each settings object as its own GET returns it.
func TestAdminFeatures(t *testing.T) {
	env := newRAGEnv(t)
	var f apitypes.AdminFeatures
	if code := env.app.signIn("auditor").get("/v1/admin/features", &f); code != 200 {
		t.Fatalf("features = %d", code)
	}
	var mcp apitypes.MCPSettings
	env.admin.get("/v1/admin/settings/mcp", &mcp)
	var rr apitypes.RerankSettings
	env.admin.get("/v1/admin/rerank", &rr)
	if f.Mcp.Revision != mcp.Revision || f.Mcp.Enabled != mcp.Enabled || f.Rerank.Revision != rr.Revision || f.RerankModel != nil {
		t.Errorf("settings = %+v %+v", f.Mcp, f.Rerank)
	}
	if f.Setup.Connections < 1 || f.Setup.Teams < 1 || !f.Setup.DefaultProfile || f.Costs.Teams == nil || f.Setup.ChatModelClassifications == nil {
		t.Errorf("setup = %+v costs = %+v", f.Setup, f.Costs)
	}
	code, e := env.owner.call("GET", "/v1/admin/features", nil, nil, nil)
	mustCode(t, "owner reads features", code, e, 403, "forbidden")
}
