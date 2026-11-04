package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/teamconfig"
	"github.com/ncecere/grounded/internal/web"
)

// Configuration files: plan and apply (docs/specs/config-as-code-import).

type cfgEnv struct {
	*agentEnv
	slug string
}

func newCfgEnv(t *testing.T) *cfgEnv {
	env := newAgentEnv(t)
	if err := env.app.stopWorker(); err != nil { // nothing may run because of a file; a stopped worker shows jobs as rows
		t.Fatal(err)
	}
	env.publishAgent(t, "Portable", env.agentConfig(env.kb.Id.String()))
	return &cfgEnv{agentEnv: env, slug: strings.TrimPrefix(env.base, "/v1/teams/")}
}

// yaml sends a configuration file as the body.
func (env *cfgEnv) yaml(t *testing.T, s *session, path string, body []byte, headers map[string]string) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest("POST", s.app.URL+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/yaml")
	req.Header.Set("Origin", s.app.URL)
	req.Header.Set("X-CSRF-Token", s.csrf)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := s.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res.StatusCode, out
}

func (env *cfgEnv) export(t *testing.T) teamconfig.Document {
	t.Helper()
	code, raw := env.owner.raw("GET", env.base+"/configuration", nil, nil)
	if code != 200 {
		t.Fatalf("export %d %s", code, raw)
	}
	d, err := teamconfig.DecodeDocument(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func file(t *testing.T, d teamconfig.Document) []byte {
	t.Helper()
	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func (env *cfgEnv) plan(t *testing.T, s *session, body []byte, headers map[string]string) teamconfig.Plan {
	t.Helper()
	code, raw := env.yaml(t, s, env.base+"/configuration/plan", body, headers)
	if code != 200 {
		t.Fatalf("plan %d %s", code, raw)
	}
	var out struct{ Data teamconfig.Plan }
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out.Data
}

func (env *cfgEnv) apply(t *testing.T, s *session, body []byte, digest string, headers map[string]string) (int, teamconfig.Applied, []byte) {
	t.Helper()
	h := map[string]string{"If-Match": `"` + digest + `"`}
	for k, v := range headers {
		h[k] = v
	}
	code, raw := env.yaml(t, s, env.base+"/configuration/apply", body, h)
	var out struct{ Data teamconfig.Applied }
	_ = json.Unmarshal(raw, &out)
	return code, out.Data, raw
}

func rowOf(p teamconfig.Plan, kind, key string) teamconfig.Row {
	for _, r := range p.Rows {
		if r.Kind == kind && strings.EqualFold(r.Key, key) {
			return r
		}
	}
	return teamconfig.Row{}
}

// The team's own export, checked and applied, changes nothing: every row is a no-op and there is no audit entry.
func TestConfigurationRoundTripIsNoOp(t *testing.T) {
	env := newCfgEnv(t)
	body := file(t, env.export(t))
	requests, jobs := len(env.proxy.Requests), env.scalar(t, "SELECT count(*) FROM river_job")
	audits := env.scalar(t, "SELECT count(*) FROM audit_log")
	p := env.plan(t, env.owner, body, nil)
	if p.Counts.Create+p.Counts.Update+p.Counts.Blocked != 0 || p.Counts.NoOp != 3 || p.PlanDigest == "" {
		t.Fatalf("round trip is not a no-op: %+v", p.Rows)
	}
	if again := env.plan(t, env.editor, body, nil); again.PlanDigest != p.PlanDigest {
		t.Fatal("the digest depends on who asks, not on the file and the team")
	}
	code, out, raw := env.apply(t, env.owner, body, p.PlanDigest, nil)
	if code != 200 || out.Plan.PlanDigest != p.PlanDigest || len(out.WebhookSecrets) != 0 {
		t.Fatalf("apply %d %s", code, raw)
	}
	if env.scalar(t, "SELECT count(*) FROM audit_log") != audits || env.scalar(t, "SELECT count(*) FROM river_job") != jobs || len(env.proxy.Requests) != requests {
		t.Fatal("a plan or a no-op apply wrote, queued or called something")
	}
}

// A file adds a paused web source, a draft agent, an evaluation set and a webhook that is off, and changes a knowledge
// base: nothing crawls, nothing publishes, nothing is sent, and the webhook's new secret is shown once.
func TestConfigurationApplyCreatesAndUpdates(t *testing.T) {
	env := newCfgEnv(t)
	must(t, env.admin, "POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": "docs.example.net"}, nil)
	var ws struct {
		Revision int64 `json:"revision"`
	}
	env.admin.get("/v1/admin/settings/webhooks", &ws)
	must(t, env.admin, "PUT", "/v1/admin/settings/webhooks", map[string]any{"enabled": true}, ifMatch(ws.Revision))
	must(t, env.admin, "POST", "/v1/admin/webhook-destinations", map[string]any{"pattern": "*.example.com"}, nil)

	d := env.export(t)
	d.KnowledgeBases[0].Description = "Answers for students, from a file"
	d.KnowledgeBases[0].Sources = append(d.KnowledgeBases[0].Sources, teamconfig.SourceRef{Namespace: "team", Name: "Library site"})
	d.Sources = append(d.Sources, teamconfig.Source{Name: "Library site", Type: "web", Classification: d.Sources[0].Classification,
		EmbeddingProfile: d.Sources[0].EmbeddingProfile, Status: "active", OCREnabled: true,
		Web: &web.Config{Mode: "crawl", URLs: []string{"https://docs.example.net/library"}, MaxDepth: 1, MaxPages: 20, IncludePrefixes: []string{}, Exclude: []string{}, Schedule: "manual", Tags: []string{}}})
	helper := d.Agents[0]
	helper.Name, helper.Slug, helper.Versions, helper.PublishedVersion = "Library helper", "library-helper", []teamconfig.AgentVersion{}, 0
	d.Agents = append(d.Agents, helper)
	d.EvaluationSets = []teamconfig.EvaluationSet{{Name: "Library checks", KnowledgeBase: d.KnowledgeBases[0].Name,
		Cases: []teamconfig.EvaluationCase{{Question: "When is the library open late?", URLs: []string{"https://docs.example.net/library"}, MustMention: []string{"finals"}}}}}
	d.Webhooks = []teamconfig.Webhook{{URL: "https://hooks.example.com/grounded", Description: "Help desk", Events: []string{"source.synced"}, Enabled: true}}
	body := file(t, d)

	p := env.plan(t, env.owner, body, nil)
	if p.Counts.Create != 4 || p.Counts.Update != 1 || p.Counts.Blocked != 0 {
		t.Fatalf("counts %+v rows %+v", p.Counts, p.Rows)
	}
	if kb := rowOf(p, teamconfig.KindKnowledgeBase, d.KnowledgeBases[0].Name); len(kb.Changes) != 2 {
		t.Fatalf("knowledge base changes %+v", kb.Changes)
	}
	code, out, raw := env.apply(t, env.owner, body, p.PlanDigest, nil)
	if code != 200 {
		t.Fatalf("apply %d %s", code, raw)
	}
	if len(out.WebhookSecrets) != 1 || !strings.HasPrefix(out.WebhookSecrets[0].Secret, "whsec_") {
		t.Fatalf("the new webhook's secret was not shown once: %+v", out.WebhookSecrets)
	}
	for _, check := range []struct{ what, sql string }{
		{"the web source starts paused", "SELECT count(*) FROM data_sources WHERE name='Library site' AND status='paused'"},
		{"the knowledge base searches it", "SELECT count(*) FROM kb_sources l JOIN data_sources s ON s.id=l.source_id WHERE s.name='Library site'"},
		{"the agent is a draft", "SELECT count(*) FROM agents WHERE slug='library-helper' AND published_version_id IS NULL"},
		{"the set has its question", "SELECT count(*) FROM eval_cases c JOIN eval_sets s ON s.id=c.set_id WHERE s.name='Library checks'"},
		{"the webhook is off", "SELECT count(*) FROM webhooks WHERE url='https://hooks.example.com/grounded' AND NOT enabled"},
		{"one apply entry", "SELECT count(*) FROM audit_log WHERE action='team.configuration_apply'"},
	} {
		if env.scalar(t, check.sql) != 1 {
			t.Errorf("%s: no", check.what)
		}
	}
	if env.scalar(t, "SELECT count(*) FROM web_crawls r JOIN data_sources s ON s.id=r.source_id WHERE s.name='Library site'") != 0 {
		t.Error("the import started a crawl")
	}
	// Applied, the same file is a no-op again (the webhook's enabled flag is never applied, so it is a note only).
	again := env.plan(t, env.owner, body, nil)
	if again.Counts.Create+again.Counts.Update != 0 {
		t.Fatalf("re-plan is not a no-op: %+v", again.Rows)
	}
}

// Apply refuses a stale plan (412, with the fresh plan), a missing digest (428) and a blocked one (409), and writes
// nothing in each case.
func TestConfigurationApplyRefusesDriftAndBlockers(t *testing.T) {
	env := newCfgEnv(t)
	d := env.export(t)
	d.KnowledgeBases[0].Description = "From a file"
	body := file(t, d)
	p := env.plan(t, env.owner, body, nil)
	if code, _, raw := env.apply(t, env.owner, body, "", nil); code != 428 {
		t.Fatalf("apply without a plan %d %s", code, raw)
	}
	if _, err := env.app.Pool.Exec(t.Context(), "UPDATE knowledge_bases SET top_k=5 WHERE id=$1", env.kb.Id); err != nil {
		t.Fatal(err)
	}
	code, _, raw := env.apply(t, env.owner, body, p.PlanDigest, nil)
	if code != 412 || !bytes.Contains(raw, []byte("planDigest")) {
		t.Fatalf("stale apply %d %s", code, raw)
	}
	if env.scalar(t, "SELECT count(*) FROM knowledge_bases WHERE description='From a file'") != 0 {
		t.Fatal("a stale apply wrote")
	}

	d.Sources[0].Classification = "no-such-level"
	d.Agents[0].Draft.Model = &teamconfig.ModelRef{Connection: "nowhere", Name: "nothing"}
	body = file(t, d)
	p = env.plan(t, env.owner, body, nil)
	if p.Counts.Blocked != 2 || len(rowOf(p, teamconfig.KindSource, d.Sources[0].Name).Blockers) == 0 || len(rowOf(p, teamconfig.KindAgent, d.Agents[0].Slug).Blockers) == 0 {
		t.Fatalf("missing references are not blockers: %+v", p.Rows)
	}
	if code, _, raw := env.apply(t, env.owner, body, p.PlanDigest, nil); code != 409 || !bytes.Contains(raw, []byte("configuration_blocked")) {
		t.Fatalf("blocked apply %d %s", code, raw)
	}
	// A file that is not a configuration file names where, never what.
	code, raw = env.yaml(t, env.owner, env.base+"/configuration/plan", []byte("apiVersion: grounded.team/v1\nsources: [{name: x, password: Tr0ub4dor}]\n"), nil)
	if code != 400 || bytes.Contains(raw, []byte("Tr0ub4dor")) {
		t.Fatalf("invalid file %d %s", code, raw)
	}
}

// Keys need configuration:apply with manage; evaluation sets stay out of their reach. Objects the file omits stay.
func TestConfigurationApplyKeysAndOmissions(t *testing.T) {
	env := newCfgEnv(t)
	key := func(scopes ...string) (int, string) {
		var k struct {
			Secret string `json:"secret"`
		}
		code, _ := env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": "config " + strings.Join(scopes, "+"), "kind": "service", "scopes": scopes, "responsibleUserId": env.owner.me.User.Id}, &k, nil)
		return code, k.Secret
	}
	if code, _ := key("configuration:apply"); code != 400 {
		t.Fatalf("configuration:apply without manage: %d", code)
	}
	_, manageOnly := key("manage")
	_, applier := key("manage", "configuration:apply")
	d := env.export(t)
	body := file(t, d)
	if code, _ := env.yaml(t, env.owner, env.base+"/configuration/plan", body, map[string]string{"Authorization": "Bearer " + manageOnly}); code != 404 {
		t.Fatalf("manage alone planned: %d", code)
	}
	bearer := map[string]string{"Authorization": "Bearer " + applier}
	d.KnowledgeBases[0].Description = "From a pipeline"
	d.Sources = d.Sources[:0] // the file no longer lists the team's source
	d.KnowledgeBases[0].Sources = []teamconfig.SourceRef{{Namespace: "team", Name: "Handbook"}}
	body = file(t, d)
	p := env.plan(t, env.owner, body, bearer)
	if r := rowOf(p, teamconfig.KindSource, "Handbook"); r.Action != teamconfig.ActionNotInFile {
		t.Fatalf("an omitted source is not shown as kept: %+v", r)
	}
	if code, _, raw := env.apply(t, env.owner, body, p.PlanDigest, bearer); code != 200 {
		t.Fatalf("key apply %d %s", code, raw)
	}
	if env.scalar(t, "SELECT count(*) FROM data_sources WHERE name='Handbook'") != 1 || env.scalar(t, "SELECT count(*) FROM knowledge_bases WHERE description='From a pipeline'") != 1 {
		t.Fatal("the key's apply deleted the omitted source or did not apply")
	}
	d.EvaluationSets = []teamconfig.EvaluationSet{{Name: "Pipeline checks", KnowledgeBase: d.KnowledgeBases[0].Name, Cases: []teamconfig.EvaluationCase{{Question: "Where do I park?", URLs: []string{"https://docs.example.net/parking"}, MustMention: []string{}}}}}
	p = env.plan(t, env.owner, file(t, d), bearer)
	if r := rowOf(p, teamconfig.KindEvaluationSet, "Pipeline checks"); len(r.Blockers) == 0 {
		t.Fatalf("an API key may write evaluation questions: %+v", r)
	}
}

// A refusal inside the services (here, the team's data source limit) rolls the whole file back.
func TestConfigurationApplyIsAtomic(t *testing.T) {
	env := newCfgEnv(t)
	setTeamLimits(t, env.admin, env.slug, map[string]any{"data_sources": 2})
	d := env.export(t)
	d.KnowledgeBases[0].Description = "Should roll back"
	for _, name := range []string{"Second", "Third"} {
		d.Sources = append(d.Sources, teamconfig.Source{Name: name, Type: "upload", Classification: d.Sources[0].Classification, EmbeddingProfile: d.Sources[0].EmbeddingProfile, Status: "active", OCREnabled: true})
	}
	body := file(t, d)
	p := env.plan(t, env.owner, body, nil)
	code, _, raw := env.apply(t, env.owner, body, p.PlanDigest, nil)
	if code < 400 || !bytes.Contains(raw, []byte("Third")) {
		t.Fatalf("over the limit %d %s", code, raw)
	}
	if env.scalar(t, "SELECT count(*) FROM data_sources WHERE name IN ('Second','Third')") != 0 || env.scalar(t, "SELECT count(*) FROM knowledge_bases WHERE description='Should roll back'") != 0 {
		t.Fatal("a failed apply left part of the file applied")
	}
}
