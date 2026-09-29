package httpapi_test

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The team audit log follows the spend rule (docs/costs.md §5, the v0.2.1
// walkthrough): the team's cost entries (its budget, enforcement mode and
// budget extensions with their reasons) are for those who may see its
// spend, the team's owners and admins and platform staff. Editors read the
// rest of the log; a cost entry is not found for them, in the list or by
// ID. Members can't read the log at all. Every caller, as in the
// authorization matrix, with the expected outcome.
func TestTeamAuditHidesSpendFromEditors(t *testing.T) {
	env := newAgentEnv(t)
	setCostSettings(t, env.admin, "track")
	setTeamBudget(t, env.admin, env.team, "enforce", "5")
	code, e := env.admin.call("POST", "/v1/admin/teams/"+env.team+"/budget/extensions",
		map[string]any{"amount": "1", "reason": "Finish the September evaluation"}, nil, nil)
	mustCode(t, "extension", code, e, 201, "")
	budgetID := env.scalar(t, `SELECT coalesce(max(id), 0) FROM audit_log WHERE action = 'costs.budget_update'`)
	if budgetID == 0 {
		t.Fatal("no costs.budget_update entry")
	}
	budgetEntry := strconv.FormatInt(budgetID, 10)

	callers := []struct {
		name  string
		s     *session
		read  bool // may read the log
		spend bool // sees its cost entries
	}{
		{"team owner", env.owner, true, true},
		{"team admin", env.tadmin, true, true},
		{"editor", env.editor, true, false},
		{"member", env.member, false, false},
		{"platform admin", env.admin, true, true},
		{"platform auditor", env.auditor, true, true},
	}
	for _, c := range callers {
		t.Run(c.name, func(t *testing.T) {
			var page apitypes.AuditPage
			code := c.s.get(env.base+"/audit?limit=200", &page)
			if !c.read {
				if code != 403 {
					t.Fatalf("log = %d, want 403", code)
				}
				return
			}
			if code != 200 || len(page.Items) == 0 {
				t.Fatalf("log = %d, %d entries", code, len(page.Items))
			}
			costs := 0
			for _, it := range page.Items {
				if strings.HasPrefix(it.Action, "costs.") {
					costs++
				}
			}
			var filtered apitypes.AuditPage
			if code := c.s.get(env.base+"/audit?action=costs.", &filtered); code != 200 {
				t.Fatalf("costs filter = %d", code)
			}
			one := c.s.get(env.base+"/audit/"+budgetEntry, nil)
			switch {
			case c.spend && (costs != 2 || len(filtered.Items) != 2 || one != 200):
				t.Errorf("sees %d cost entries (%d filtered), entry = %d; want 2, 2, 200", costs, len(filtered.Items), one)
			case !c.spend && (costs != 0 || len(filtered.Items) != 0 || one != 404):
				t.Errorf("sees %d cost entries (%d filtered), entry = %d; want 0, 0, 404", costs, len(filtered.Items), one)
			}
			// What the entries hold: the amounts and the extension's reason.
			if raw, _ := json.Marshal(filtered.Items); c.spend && !strings.Contains(string(raw), "Finish the September evaluation") {
				t.Errorf("the extension's reason is missing: %s", raw)
			}
		})
	}
	// An editor's page is still full: other entries fill it, and the cursor works.
	var first apitypes.AuditPage
	if code := env.editor.get(env.base+"/audit?limit=1", &first); code != 200 || len(first.Items) != 1 || first.NextCursor == nil {
		t.Fatalf("editor's first page = %d %+v", code, first)
	}
	if strings.HasPrefix(first.Items[0].Action, "costs.") {
		t.Fatalf("editor's first entry = %s", first.Items[0].Action)
	}
}
