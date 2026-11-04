package httpapi_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"github.com/ncecere/grounded/internal/teamconfig"
	"net/url"
	"strings"
	"testing"
)

func TestConfigurationExportEndpoint(t *testing.T) {
	app := newTestApp(t, nil)
	owner := app.signIn("user")
	team := createTeam(t, app.signIn("admin"), "export-team", string(owner.me.User.Email))
	_ = team
	code, body := owner.raw("GET", "/v1/teams/export-team/configuration", nil, nil)
	if code != 200 {
		t.Fatalf("export: %d %s", code, body)
	}
	if !bytes.Contains(body, []byte("grounded.team/v1")) {
		t.Fatalf("not configuration: %s", body)
	}
}

func TestConfigurationExportResources(t *testing.T) {
	env := newAgentEnv(t)
	agent := env.publishAgent(t, "Portable", env.agentConfig(env.kb.Id.String()))
	_ = agent
	if err := env.app.stopWorker(); err != nil {
		t.Fatal(err)
	}
	path := env.base + "/configuration"
	requestsBefore := len(env.proxy.Requests)
	res, err := env.owner.client.Get(env.app.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	if res.Header.Get("Content-Type") != "application/yaml" || res.Header.Get("Content-Disposition") != `attachment; filename="team-configuration.yaml"` || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("unsafe download headers")
	}
	_ = res.Body.Close()
	code, raw := env.owner.raw("GET", path, nil, nil)
	if code != 200 {
		t.Fatalf("export %d %s", code, raw)
	}
	d, err := teamconfig.DecodeDocument(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Sources) != 1 || len(d.KnowledgeBases) != 1 || len(d.Agents) != 1 {
		t.Fatalf("counts %d %d %d", len(d.Sources), len(d.KnowledgeBases), len(d.Agents))
	}
	if d.KnowledgeBases[0].Sources[0].Name != "Handbook" || d.Agents[0].PublishedVersion != 1 || len(d.Agents[0].Versions) != 1 {
		t.Fatal("portable references/versions lost")
	}
	for _, forbidden := range []string{parkingDoc, housingDoc, libraryDoc, env.upload.Id.String(), env.chat.Id.String(), env.kb.Id.String(), "secretCipher", "secretHash"} {
		if bytes.Contains(raw, []byte(forbidden)) {
			t.Fatalf("export contains forbidden content or identity")
		}
	}
	for _, s := range []*session{env.owner, env.editor, env.tadmin} {
		code, got := s.raw("GET", path, nil, nil)
		if code != 200 || !bytes.Equal(got, raw) {
			t.Fatalf("nondeterministic or denied role: %d %s", code, got)
		}
	}
	for _, s := range []*session{env.member, env.admin, env.auditor} {
		code, _ := s.raw("GET", path, nil, nil)
		if code != 404 {
			t.Fatalf("nonmember authority leaked: %d", code)
		}
	}
	var key struct {
		Secret string `json:"secret"`
	}
	code, e := env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": "export", "kind": "service", "scopes": []string{"configuration:export"}, "responsibleUserId": env.owner.me.User.Id}, &key, nil)
	mustCode(t, "key", code, e, 201, "")
	if key.Secret == "" {
		t.Fatal("missing key")
	}
	code, got := env.owner.raw("GET", path, nil, map[string]string{"Authorization": "Bearer " + key.Secret})
	if code != 200 || !bytes.Equal(got, raw) {
		t.Fatalf("export-only key %d %s", code, got)
	}
	code, _ = env.owner.raw("POST", env.base+"/kbs", map[string]any{"name": "forbidden"}, map[string]string{"Authorization": "Bearer " + key.Secret})
	if code < 400 {
		t.Fatal("export scope writes")
	}
	if len(env.proxy.Requests) != requestsBefore {
		t.Fatal("export called provider")
	}
}

func TestConfigurationExportProtectedAndSecretFixtures(t *testing.T) {
	env := newAgentEnv(t)
	if err := env.app.stopWorker(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	agent := env.publishAgent(t, "Canary helper", env.agentConfig(env.kb.Id.String()))
	_ = agent
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := env.app.Pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	path := env.base + "/configuration"
	// A stored URL configuration is exported, never fetched.
	exec(`INSERT INTO data_sources(team_id,name,type,config,classification,embedding_profile_id)
 SELECT team_id,'Website','web','{"mode":"scrape","urls":["https://example.edu/guide"],"maxDepth":0,"maxPages":1,"includePrefixes":[],"exclude":[],"allowSubdomains":false,"useSitemaps":false,"schedule":"manual","tags":[]}'::jsonb,classification,embedding_profile_id FROM data_sources WHERE id=$1`, env.upload.Id)
	code, raw := env.owner.raw("GET", path, nil, nil)
	if code != 200 {
		t.Fatalf("web export %d %s", code, raw)
	}
	d, err := teamconfig.DecodeDocument(bytes.NewReader(raw))
	if err != nil || len(d.Sources) != 2 || d.Sources[1].Web == nil {
		t.Fatal("web configuration missing", err)
	}

	// An attached shared source is ONLY a permitted namespaced reference. Even
	// hostile private source configuration must never be read or serialized.
	exec(`INSERT INTO data_sources(name,type,config,classification,embedding_profile_id)
 SELECT 'Shared metadata','web','{"authorization":"synthetic-private-canary"}'::jsonb,classification,embedding_profile_id FROM data_sources WHERE id=$1`, env.upload.Id)
	exec(`INSERT INTO kb_sources(kb_id,source_id) SELECT $1,id FROM data_sources WHERE team_id IS NULL AND name='Shared metadata'`, env.kb.Id)
	code, raw = env.owner.raw("GET", path, nil, nil)
	if code != 200 || bytes.Contains(raw, []byte("private-canary")) {
		t.Fatal("shared-source extraction")
	}
	d, err = teamconfig.DecodeDocument(bytes.NewReader(raw))
	if err != nil || len(d.Sources) != 2 || len(d.KnowledgeBases[0].Sources) != 2 || d.KnowledgeBases[0].Sources[1].Namespace != "platform" {
		t.Fatal("shared-source reference lost")
	}
	exec(`INSERT INTO eval_sets(team_id,kb_id,name) SELECT team_id,id,'Portable checks' FROM knowledge_bases WHERE id=$1`, env.kb.Id)
	exec(`INSERT INTO eval_cases(set_id,question,expected,must_mention,note) SELECT id,'When is the library open?','{"urls":["https://example.edu/guide"]}'::jsonb,ARRAY['hours'],'Review hours' FROM eval_sets WHERE name='Portable checks'`)
	code, raw = env.owner.raw("GET", path, nil, nil)
	if code != 200 {
		t.Fatalf("evaluation export %d %s", code, raw)
	}
	d, err = teamconfig.DecodeDocument(bytes.NewReader(raw))
	if err != nil || len(d.EvaluationSets) != 1 || d.EvaluationSets[0].KnowledgeBase != "Student help" || len(d.EvaluationSets[0].Cases) != 1 {
		t.Fatal("evaluation reference/cases lost", err)
	}

	var evalKey struct {
		Secret string `json:"secret"`
	}
	keyCode, keyError := env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": "eval refusal", "kind": "service", "scopes": []string{"configuration:export"}}, &evalKey, nil)
	mustCode(t, "evaluation key", keyCode, keyError, 201, "")
	keyCode, _ = env.owner.raw("GET", path, nil, map[string]string{"Authorization": "Bearer " + evalKey.Secret})
	if keyCode != 409 {
		t.Fatal("export scope exposed protected evaluation questions")
	}
	// Synthetic canaries in all text-bearing kinds: refuse, never echo, including
	// URL-encoded and base64 variants. Uploaded body fixtures are tested above.
	marker := "Authorization: Bearer synthetic-export-canary"
	for _, encoded := range []string{marker, url.QueryEscape(marker), base64.StdEncoding.EncodeToString([]byte(marker))} {
		for _, sql := range []string{
			`UPDATE data_sources SET description=$1 WHERE name='Handbook'`,
			`UPDATE knowledge_bases SET description=$1 WHERE id='KBID'`,
			`UPDATE eval_cases SET note=$1`,
			`UPDATE agents SET draft=jsonb_set(draft,'{instructions}',to_jsonb($1::text))`,
		} {
			sql = strings.ReplaceAll(sql, "KBID", env.kb.Id.String())
			exec(sql, encoded)
			code, body := env.owner.raw("GET", path, nil, nil)
			if code != 409 || bytes.Contains(body, []byte("canary")) {
				t.Fatalf("canary accepted or echoed %d", code)
			}
			exec(sql, "")
		}
	}
	exec(`UPDATE eval_cases SET expected='{"documentIds":["00000000-0000-0000-0000-000000000001"]}'::jsonb`)
	code, _ = env.owner.raw("GET", path, nil, nil)
	if code != 409 {
		t.Fatal("nonportable evaluation document reference accepted")
	}
	exec(`DELETE FROM eval_sets WHERE name='Portable checks'`)
	// A webhook exports what it is (URL, description, events, on or off), never its signing material.
	exec(`INSERT INTO webhooks(team_id,url,description,events,secret_cipher,secret_hint)
 SELECT team_id,'https://example.edu/hook','Tell the help desk',ARRAY['source.synced','agent.published'],decode('73796e7468657469632d7369676e696e672d63616e617279','hex'),'nary' FROM knowledge_bases WHERE id=$1`, env.kb.Id)
	code, raw = env.owner.raw("GET", path, nil, nil)
	if code != 200 || bytes.Contains(raw, []byte("signing-canary")) || bytes.Contains(raw, []byte(`"secret`)) || bytes.Contains(raw, []byte(`"signing`)) || bytes.Contains(raw, []byte(`"hint"`)) {
		t.Fatalf("webhook export %d leaked signing material or failed", code)
	}
	d, err = teamconfig.DecodeDocument(bytes.NewReader(raw))
	if err != nil || len(d.Webhooks) != 1 || d.Webhooks[0].URL != "https://example.edu/hook" || len(d.Webhooks[0].Events) != 2 || d.Webhooks[0].Description != "Tell the help desk" {
		t.Fatalf("webhook not exported as configured: %v %+v", err, d.Webhooks)
	}
	// A query is where a receiver's token usually hides: such a webhook refuses the whole export.
	exec(`UPDATE webhooks SET url='https://example.edu/hook?token=synthetic-canary'`)
	code, raw = env.owner.raw("GET", path, nil, nil)
	if code != 409 || bytes.Contains(raw, []byte("canary")) {
		t.Fatal("credential-bearing webhook URL exported")
	}
}

func TestConfigurationExportKeyBoundaryAndReadOnly(t *testing.T) {
	env := newAgentEnv(t)
	if err := env.app.stopWorker(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	path := env.base + "/configuration"
	for _, scopes := range [][]string{{"query"}, {"ingest"}, {"manage"}, {"configuration:export"}} {
		var key struct {
			Secret string `json:"secret"`
		}
		code, e := env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": "boundary", "kind": "service", "scopes": scopes}, &key, nil)
		mustCode(t, "key", code, e, 201, "")
		snapshot := func() string {
			var result string
			// Include secret-bearing rows in the comparison, never in test output.
			if err := env.app.Pool.QueryRow(ctx, `SELECT jsonb_build_array(
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM api_keys x),
    (SELECT count(*) FROM audit_log), (SELECT count(*) FROM river_job WHERE NOT coalesce((metadata->>'periodic')::boolean, false)),
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM data_sources x),
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM agents x)
   )::text`).Scan(&result); err != nil {
				t.Fatal(err)
			}
			return result
		}
		before := snapshot()
		headers := map[string]string{"Authorization": "Bearer " + key.Secret}
		code, _ = env.owner.raw("GET", path, nil, headers)
		want := 404
		if scopes[0] == "configuration:export" {
			want = 200
		}
		if code != want {
			t.Fatalf("scope %s: %d want %d", scopes[0], code, want)
		}
		if snapshot() != before {
			t.Fatal("export changed keys/config/audit/jobs")
		}
		code, _ = env.owner.raw("GET", "/v1/teams/not-this-team/configuration", nil, headers)
		if code != 404 {
			t.Fatal("cross-team grant")
		}
	}
	// Classification ceilings are rechecked even if older data violates them.
	_, err := env.app.Pool.Exec(ctx, `UPDATE data_sources SET classification='sensitive' WHERE id=$1; `, env.upload.Id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = env.app.Pool.Exec(ctx, `UPDATE teams SET max_classification='open' WHERE slug=$1`, env.team)
	if err != nil {
		t.Fatal(err)
	}
	code, _ := env.owner.raw("GET", path, nil, nil)
	if code != 409 {
		t.Fatalf("classification bypass %d", code)
	}
}

func TestConfigurationExportRestrictedAndPersonalKeys(t *testing.T) {
	env := newAgentEnv(t)
	if err := env.app.stopWorker(); err != nil {
		t.Fatal(err)
	}
	createTeam(t, env.admin, "foreign-export", "auditor@localhost")
	for _, body := range []map[string]any{
		{"name": "limited", "kind": "service", "scopes": []string{"configuration:export"}, "knowledgeBaseIds": []string{env.kb.Id.String()}},
		{"name": "personal", "kind": "personal", "scopes": []string{"configuration:export"}},
	} {
		var key struct {
			Secret string `json:"secret"`
		}
		code, e := env.owner.call("POST", env.base+"/api-keys", body, &key, nil)
		mustCode(t, "key", code, e, 201, "")
		headers := map[string]string{"Authorization": "Bearer " + key.Secret}
		code, _ = env.owner.raw("GET", "/v1/teams/foreign-export/configuration", nil, headers)
		if code != 404 {
			t.Fatal("foreign-team grant")
		}
		code, _ = env.owner.raw("GET", env.base+"/configuration", nil, headers)
		want := 404
		if body["kind"] == "personal" {
			want = 200
		}
		if code != want {
			t.Fatalf("restriction: %d want %d", code, want)
		}
		if body["kind"] == "personal" {
			// Fixture-only role change: personal key must not retain prior authority.
			_, err := env.app.Pool.Exec(context.Background(), `UPDATE team_members SET role='member' WHERE team_id=(SELECT id FROM teams WHERE slug=$1) AND user_id=$2`, env.team, env.owner.me.User.Id)
			if err != nil {
				t.Fatal(err)
			}
			code, _ = env.owner.raw("GET", env.base+"/configuration", nil, headers)
			if code != 404 {
				t.Fatal("personal key retained authority after demotion")
			}
		}
	}
}
