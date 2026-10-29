package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Editors' and owners' pages, polish from the v0.6.0 QA pass (#132): what the API says and writes for a key without the
// ingest scope, a PATCH that changes nothing, and publishing a draft that has not changed.

func errorMessage(raw []byte) string {
	var env struct{ Error struct{ Message string } }
	_ = json.Unmarshal(raw, &env)
	return env.Error.Message
}

func TestQueryOnlyKeyUploadNamesTheIngestScope(t *testing.T) {
	env := newKeyAuthzEnv(t)
	query := createKey(t, env.owner, env.base, map[string]any{"name": "search", "kind": "service", "scopes": []string{"query"}})

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	w, _ := mw.CreateFormFile("files", "a-new.md")
	_, _ = w.Write([]byte("# New\n\nbody"))
	_ = mw.Close()
	req, _ := http.NewRequest("POST", env.app.URL+env.base+"/sources/"+env.srcA.Id.String()+"/documents", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+query.Secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	msg := errorMessage(raw)
	if res.StatusCode != 403 || errorCode(raw) != "forbidden" || !strings.Contains(msg, "ingest scope") || strings.Contains(msg, "editors") {
		t.Fatalf("a query-only key uploads = %d %s", res.StatusCode, raw)
	}

	// A member's own session still hears the role rule.
	alex := env.app.signIn("alex")
	if code, e := env.owner.call("POST", env.base+"/members", map[string]string{"email": "alex@localhost", "role": "member"}, nil, nil); code != 201 {
		t.Fatalf("add alex = %d %s", code, e)
	}
	alex.refresh()
	code, raw2 := alex.raw("PATCH", env.base+"/sources/"+env.srcA.Id.String(), map[string]any{"description": "x"}, ifMatch(env.srcA.Revision))
	if code != 403 || !strings.Contains(errorMessage(raw2), "Only team editors, admins and owners") {
		t.Fatalf("a member changes a source = %d %s", code, raw2)
	}
}

func TestPatchThatChangesNothingWritesNothing(t *testing.T) {
	env := newKeyAuthzEnv(t)
	path := env.base + "/sources/" + env.srcA.Id.String()
	count := func(action string) int64 {
		var n int64
		if err := env.app.Pool.QueryRow(t.Context(), `SELECT count(*) FROM audit_log WHERE target_id = $1 AND action = $2`, env.srcA.Id.String(), action).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	var cur apitypes.DataSource
	if code := env.owner.get(path, &cur); code != 200 {
		t.Fatalf("get source = %d", code)
	}
	before := count("source.update") + count("source.classification_change")

	for name, body := range map[string]map[string]any{
		"the same classification": {"classification": cur.Classification},
		"the same name":           {"name": cur.Name, "description": cur.Description},
		"nothing":                 {},
	} {
		var out apitypes.DataSource
		code, e := env.owner.call("PATCH", path, body, &out, ifMatch(cur.Revision))
		mustCode(t, name, code, e, 200, "")
		if out.Revision != cur.Revision {
			t.Errorf("%s: revision %d, want %d", name, out.Revision, cur.Revision)
		}
	}
	if after := count("source.update") + count("source.classification_change"); after != before {
		t.Errorf("no-op PATCHes wrote %d audit entries", after-before)
	}
	// The revision did not move, so the same If-Match still works for a real change, which is written.
	var out apitypes.DataSource
	code, e := env.owner.call("PATCH", path, map[string]any{"description": "Where to park"}, &out, ifMatch(cur.Revision))
	mustCode(t, "a real change", code, e, 200, "")
	if out.Revision != cur.Revision+1 || count("source.update") != before+1 {
		t.Errorf("a real change: revision %d (was %d), audit %d (was %d)", out.Revision, cur.Revision, count("source.update"), before)
	}
	// A real change of classification is written too (a lowered one needs its reason).
	var lowered apitypes.DataSource
	code, e = env.owner.call("PATCH", path, map[string]any{"classification": "open", "reason": "Reviewed: nothing sensitive in it"}, &lowered, ifMatch(out.Revision))
	mustCode(t, "lower the classification", code, e, 200, "")
	if lowered.Classification != "open" || lowered.Revision != out.Revision+1 || count("source.classification_change") != 1 {
		t.Errorf("lowered: %q revision %d (was %d), classification audit %d", lowered.Classification, lowered.Revision, out.Revision, count("source.classification_change"))
	}
	// A stale precondition is still refused, change or not.
	code, e = env.owner.call("PATCH", path, map[string]any{}, nil, ifMatch(cur.Revision))
	mustCode(t, "stale no-op", code, e, 412, "")
}

func TestPublishingAnUnchangedDraftIsRefused(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	versions := func() int64 {
		return env.scalar(t, `SELECT count(*) FROM agent_versions WHERE agent_id = $1`, ag.Id.String())
	}
	if n := versions(); n != 1 {
		t.Fatalf("versions = %d", n)
	}
	code, e := env.editor.call("POST", env.base+"/agents/"+ag.Id.String()+"/publish", map[string]any{"note": "again"}, nil, nil)
	mustCode(t, "publish the same draft", code, e, 409, "no_changes")
	if n := versions(); n != 1 {
		t.Errorf("an identical version was created: %d versions", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent.publish' AND target_id = $1`, ag.Id.String()); n != 1 {
		t.Errorf("publish audit entries = %d", n)
	}

	// Once the draft changes, publishing works again.
	var cur apitypes.Agent
	env.editor.get(env.base+"/agents/"+ag.Id.String(), &cur)
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["instructions"] = "Be even briefer."
	code, e = env.editor.call("PATCH", env.base+"/agents/"+ag.Id.String(), map[string]any{"config": cfg}, nil, ifMatch(cur.Revision))
	mustCode(t, "edit the draft", code, e, 200, "")
	code, e = env.editor.call("POST", env.base+"/agents/"+ag.Id.String()+"/publish", map[string]any{"note": "second"}, nil, nil)
	mustCode(t, "publish the change", code, e, 201, "")
	if n := versions(); n != 2 {
		t.Errorf("versions = %d, want 2", n)
	}
}
