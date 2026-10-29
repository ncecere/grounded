package httpapi_test

import (
	"context"
	"reflect"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

func displaySnapshot(t *testing.T, who *session, path string) map[string]any {
	t.Helper()
	var out map[string]any
	if code := who.get(path, &out); code != 200 {
		t.Fatalf("snapshot %s = %d", path, code)
	}
	if team, ok := out["team"].(map[string]any); ok {
		return team
	}
	return out
}

func TestUnsafeRenamesLeaveNamesRevisionsAndAuditUnchanged(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Display updates", env.agentConfig(env.kb.Id.String()))
	var shared apitypes.DataSource
	code, e := env.admin.call("POST", "/v1/admin/shared-sources", map[string]any{"name": "Shared display", "classification": "open"}, &shared, nil)
	mustCode(t, "shared source", code, e, 201, "")
	for _, tc := range []struct {
		label, method, path string
		who                 *session
		body                map[string]any
	}{
		{"team", "PATCH", "/v1/admin/teams/" + env.team, env.admin, nil},
		{"agent", "PATCH", env.base + "/agents/" + ag.Id.String(), env.editor, nil},
		{"kb", "PATCH", env.base + "/kbs/" + env.kb.Id.String(), env.owner, map[string]any{"description": "changed", "topK": 4}},
		{"source", "PATCH", env.base + "/sources/" + env.upload.Id.String(), env.owner, nil},
		{"shared", "PATCH", "/v1/admin/shared-sources/" + shared.Id.String(), env.admin, nil},
	} {
		t.Run(tc.label, func(t *testing.T) {
			before := displaySnapshot(t, tc.who, tc.path)
			for _, name := range []string{"\tNew name", "New name\n", "New\u202ename", "New\u200dname"} {
				body := map[string]any{"name": name}
				for key, value := range tc.body {
					body[key] = value
				}
				var auditsBefore, auditsAfter int64
				if err := env.app.Pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_log WHERE target_id = $1 AND action IN ('team.update','agent.update','kb.update','source.update')", before["id"]).Scan(&auditsBefore); err != nil {
					t.Fatal(err)
				}
				code, e := tc.who.call(tc.method, tc.path, body, nil, ifMatch(int64(before["revision"].(float64))))
				mustCode(t, "unsafe rename", code, e, 400, "invalid_name")
				after := displaySnapshot(t, tc.who, tc.path)
				for _, key := range []string{"name", "revision", "updatedAt", "description"} {
					if !reflect.DeepEqual(before[key], after[key]) {
						t.Errorf("rejected rename changed %s: %v -> %v", key, before[key], after[key])
					}
				}
				if err := env.app.Pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_log WHERE target_id = $1 AND action IN ('team.update','agent.update','kb.update','source.update')", before["id"]).Scan(&auditsAfter); err != nil || auditsBefore != auditsAfter {
					t.Fatalf("rejected rename audit count %d -> %d, %v", auditsBefore, auditsAfter, err)
				}
			}
		})
	}
}

func TestDisplayNamesKeepOrdinaryUnicode(t *testing.T) {
	env := newAgentEnv(t)
	for _, name := range []string{"Café", "Cafe\u0301", "العربية", "עברית", "中文", "हिन्दी", "Help ☕️", "Guide 😀"} {
		t.Run(name, func(t *testing.T) {
			var agent apitypes.Agent
			code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": name}, &agent, nil)
			mustCode(t, "Unicode agent", code, e, 201, "")
			if agent.Name != name {
				t.Fatalf("Unicode name changed: %q -> %q", name, agent.Name)
			}
			code, results, e := env.owner.uploadFiles(env.base+"/sources/"+env.upload.Id.String()+"/documents", []upload{{name + ".txt", []byte("Ordinary readable text.")}}, "")
			if code != 200 || e != "" || len(results) != 1 || results[0].Status != "created" || results[0].Filename != name+".txt" {
				t.Fatalf("Unicode upload = %d %s %+v", code, e, results)
			}
		})
	}
}
