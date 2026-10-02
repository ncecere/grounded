package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// publishEnv is a moderation environment with helpers for audiences and
// public access (docs/phase4-publishing.md §3, §5-§7).
type publishEnv struct {
	*moderationEnv
}

func newPublishEnv(t *testing.T) *publishEnv {
	t.Helper()
	return &publishEnv{moderationEnv: newModerationEnv(t)}
}

// setPublic turns public access on or off as the platform admin.
func (env *publishEnv) setPublic(t *testing.T, on bool) {
	t.Helper()
	var cur apitypes.PublicAccessSettings
	if code := env.admin.get("/v1/admin/settings/public-access", &cur); code != 200 {
		t.Fatalf("get public access = %d", code)
	}
	code, e := env.admin.call("PUT", "/v1/admin/settings/public-access", map[string]any{"publicAgentsEnabled": on}, nil, ifMatch(cur.Revision))
	mustCode(t, "set public access", code, e, 200, "")
}

// publicPolicy gives the public audience a working provider (buffer, fail closed).
func (env *publishEnv) publicPolicy(t *testing.T) {
	t.Helper()
	env.putPolicy(t, "public", map[string]any{
		"modelId": env.classifier.Id, "outputMode": "buffer", "failClosed": true,
		"categories": map[string]any{"violence": rules(rule("block", 0.5), rule("block", 0.5))},
	})
}

// draftAgent creates an agent (as the editor) whose draft has an audience.
func (env *publishEnv) draftAgent(t *testing.T, name, kb, audience string) apitypes.Agent {
	t.Helper()
	cfg := env.agentConfig(kb)
	cfg["audience"] = audience
	var ag apitypes.Agent
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": name, "config": cfg}, &ag, nil)
	mustCode(t, "create "+name, code, e, 201, "")
	if string(ag.Draft.Audience) != audience || ag.Audience != "team" {
		t.Fatalf("draft audience = %s, published %s", ag.Draft.Audience, ag.Audience)
	}
	return ag
}

func (env *publishEnv) publish(s *session, ag apitypes.Agent) (int, []byte) {
	return s.raw("POST", env.base+"/agents/"+ag.Id.String()+"/publish", map[string]any{}, nil)
}

// publicAgent publishes an Open public agent over the team's KB.
func (env *publishEnv) publicAgent(t *testing.T, name string) apitypes.Agent {
	t.Helper()
	env.setPublic(t, true)
	env.publicPolicy(t)
	ag := env.draftAgent(t, name, env.kb.Id.String(), "public")
	if code, raw := env.publish(env.tadmin, ag); code != 201 {
		t.Fatalf("publish public = %d %s", code, raw)
	}
	return ag
}

// sensitiveKB is a KB over a Sensitive upload source.
func (env *publishEnv) sensitiveKB(t *testing.T) apitypes.KnowledgeBase {
	t.Helper()
	var src apitypes.DataSource
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": "Advising notes", "classification": "sensitive"}, &src, nil)
	mustCode(t, "sensitive source", code, e, 201, "")
	docs := env.base + "/sources/" + src.Id.String() + "/documents"
	env.owner.uploadFiles(docs, []upload{{"advising.md", []byte("# Advising\n\nAdvisors hold walk-in hours on Mondays in the student center.\n")}}, "")
	env.owner.waitForDocuments(t, docs)
	var kb apitypes.KnowledgeBase
	env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Advising"}, &kb, nil)
	code, e = env.owner.call("PUT", env.base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, nil, nil)
	mustCode(t, "attach sensitive", code, e, 200, "")
	return kb
}

func notificationTypes(t *testing.T, s *session) map[string]int {
	t.Helper()
	var page apitypes.NotificationPage
	if code := s.get("/v1/notifications", &page); code != 200 {
		t.Fatalf("notifications = %d", code)
	}
	out := map[string]int{}
	for _, n := range page.Items {
		out[string(n.Type)]++
	}
	return out
}

func cardsByGroup(cards []apitypes.AgentCard) map[string][]string {
	out := map[string][]string{}
	for _, c := range cards {
		g := ""
		if c.Group != nil {
			g = string(*c.Group)
		}
		out[g] = append(out[g], c.Name)
	}
	return out
}

// ---- anonymous visitors --------------------------------------------------------------

// visitor is an anonymous browser: its own cookie jar, no session.
type visitor struct {
	t      *testing.T
	base   string
	client *http.Client
	origin string // sent on writes (Grounded's own pages by default)
	// channel is the Grounded-Channel header ("": none, the public page).
	channel string
}

func newVisitor(t *testing.T, base string) *visitor {
	jar, _ := cookiejar.New(nil)
	return &visitor{t: t, base: base, client: &http.Client{Jar: jar}, origin: base}
}

func (v *visitor) do(method, path string, body any, headers map[string]string) (*http.Response, []byte) {
	v.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, v.base+path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet && v.origin != "" {
		req.Header.Set("Origin", v.origin)
	}
	if v.channel != "" {
		req.Header.Set("Grounded-Channel", v.channel)
	}
	for k, val := range headers {
		req.Header.Set(k, val)
	}
	res, err := v.client.Do(req)
	if err != nil {
		v.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res, raw
}

func (v *visitor) call(method, path string, body, out any) (int, string) {
	v.t.Helper()
	res, raw := v.do(method, path, body, nil)
	if res.StatusCode < 300 && out != nil {
		env := struct{ Data any }{Data: out}
		if err := json.Unmarshal(raw, &env); err != nil {
			v.t.Fatalf("decode %s: %v", raw, err)
		}
	}
	return res.StatusCode, errorCode(raw)
}

// start creates a session for an agent (key "" on the public page).
func (v *visitor) start(agentID uuid.UUID, key, embedOrigin string) (int, string) {
	body := map[string]any{"agentId": agentID}
	if key != "" {
		body["key"] = key
	}
	if embedOrigin != "" {
		body["embedOrigin"] = embedOrigin
	}
	return v.call("POST", "/v1/public/sessions", body, nil)
}

// chat asks a question and returns the SSE events.
func (v *visitor) chat(agentID uuid.UUID, body map[string]any) (int, sseEvents, string, http.Header) {
	v.t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", v.base+"/v1/public/agents/"+agentID.String()+"/chat", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", v.origin)
	if v.channel != "" {
		req.Header.Set("Grounded-Channel", v.channel)
	}
	res, err := v.client.Do(req)
	if err != nil {
		v.t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		raw, _ := io.ReadAll(res.Body)
		return res.StatusCode, nil, errorCode(raw), res.Header
	}
	return 200, readSSE(v.t, res.Body), "", res.Header
}

func (v *visitor) ask(agentID uuid.UUID, q string) (int, sseEvents, string) {
	code, evs, e, _ := v.chat(agentID, map[string]any{"message": q})
	return code, evs, e
}

// ---- audiences, directory and short names -----------------------------------------

func TestPublishAudiencesDirectoryAndShortNames(t *testing.T) {
	env := newPublishEnv(t)
	outsider := env.auditor // signed in, not a member of the team

	// Editors publish to the team only; admins beyond it (owners notified).
	org := env.draftAgent(t, "Org helper", env.kb.Id.String(), "all_authenticated")
	code, raw := env.publish(env.editor, org)
	if code != 403 || errorCode(raw) != "audience_forbidden" {
		t.Fatalf("editor publishes to all = %d %s", code, raw)
	}
	if code, raw := env.publish(env.tadmin, org); code != 201 {
		t.Fatalf("admin publishes to all = %d %s", code, raw)
	}
	env.editor.get(env.base+"/agents/"+org.Id.String(), &org)
	if org.Audience != "all_authenticated" || org.HasUnpublishedChanges {
		t.Fatalf("published org = %+v", org)
	}
	if n := notificationTypes(t, env.owner)["agent.published"]; n != 1 {
		t.Fatalf("owner notifications after all_authenticated = %d", n)
	}

	// Public: the switch, then moderation, then the classification ceiling.
	pub := env.draftAgent(t, "Open help", env.kb.Id.String(), "public")
	code, raw = env.publish(env.tadmin, pub)
	if code != 409 || errorCode(raw) != "public_disabled" {
		t.Fatalf("public while off = %d %s", code, raw)
	}
	code, e := outsider.call("PUT", "/v1/admin/settings/public-access", map[string]any{"publicAgentsEnabled": true}, nil, ifMatch(1))
	mustCode(t, "auditor switches", code, e, 403, "forbidden")
	code, e = env.admin.call("PUT", "/v1/admin/settings/public-access", map[string]any{"publicAgentsEnabled": true}, nil, nil)
	mustCode(t, "switch without If-Match", code, e, 428, "revision_required")
	env.setPublic(t, true)
	var settings apitypes.PublicAccessSettings
	if code := outsider.get("/v1/admin/settings/public-access", &settings); code != 200 || !settings.PublicAgentsEnabled ||
		settings.Captcha.Provider != "none" || settings.AnonSessionTtlSeconds != 86400 || settings.Revision != 2 {
		t.Fatalf("settings = %d %+v", code, settings)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.public_access'`); n != 1 {
		t.Errorf("public access audits = %d", n)
	}
	var sh apitypes.AgentSharing
	env.tadmin.get(env.base+"/agents/"+pub.Id.String()+"/sharing", &sh)
	if opt := sh.Options[2]; opt.Audience != "public" || opt.Allowed || len(opt.Reasons) != 1 {
		t.Fatalf("public option without moderation = %+v", opt)
	}
	code, raw = env.publish(env.tadmin, pub)
	if code != 409 || errorCode(raw) != "moderation_not_ready" {
		t.Fatalf("public without moderation = %d %s", code, raw)
	}
	env.publicPolicy(t)
	if code, raw := env.publish(env.tadmin, pub); code != 201 {
		t.Fatalf("publish public = %d %s", code, raw)
	}
	if n := notificationTypes(t, env.owner)["agent.published"]; n != 2 {
		t.Fatalf("owner notifications after public = %d", n)
	}
	// Republishing to the same audience notifies nobody again.
	env.publish(env.tadmin, pub)
	if n := notificationTypes(t, env.owner)["agent.published"]; n != 2 {
		t.Fatalf("owner notifications after republish = %d", n)
	}
	advising := env.sensitiveKB(t)
	sens := env.draftAgent(t, "Advising", advising.Id.String(), "public")
	code, raw = env.publish(env.tadmin, sens)
	if pb := decodeProblems(t, raw); code != 422 || !hasField(pb.Error.Details.Problems, "audience") {
		t.Fatalf("public over Sensitive = %d %s", code, raw)
	}
	env.tadmin.get(env.base+"/agents/"+sens.Id.String()+"/sharing", &sh)
	if sh.Classification != "sensitive" || sh.MaxAudience != "all_authenticated" || !sh.Options[1].Allowed || sh.Options[2].Allowed {
		t.Fatalf("sensitive sharing = %+v", sh)
	}
	code, e = env.tadmin.call("PATCH", env.base+"/agents/"+sens.Id.String(), map[string]any{"config": map[string]any{
		"chatModelId": env.chat.Id, "kbs": []map[string]any{{"kbId": advising.Id}}, "audience": "all_authenticated"}}, nil, ifMatch(sens.Revision))
	mustCode(t, "narrow draft audience", code, e, 200, "")
	if code, raw := env.publish(env.tadmin, sens); code != 201 {
		t.Fatalf("sensitive to all = %d %s", code, raw)
	}
	team := env.publishAgent(t, "Team only", env.agentConfig(env.kb.Id.String()))

	// Narrowing a level below its published agents is refused.
	var open apitypes.Classification
	for _, c := range func() []apitypes.Classification {
		var l []apitypes.Classification
		env.admin.get("/v1/classifications", &l)
		return l
	}() {
		if c.Key == "open" {
			open = c
		}
	}
	code, e = env.admin.call("PATCH", "/v1/admin/classifications/open", map[string]any{"maxAudience": "all_authenticated"}, nil, ifMatch(open.Revision))
	mustCode(t, "narrow open", code, e, 409, "classification_impact")
	if open.AnonymousRetentionHours != 24 {
		t.Errorf("anonymous retention = %d", open.AnonymousRetentionHours)
	}

	// The directory: team agents for members; organisation and public for others.
	var dir []apitypes.AgentCard
	env.member.get("/v1/agents", &dir)
	if g := cardsByGroup(dir); len(g["team"]) != 4 || len(g) != 1 {
		t.Fatalf("member directory = %v", g)
	}
	outsider.get("/v1/agents", &dir)
	g := cardsByGroup(dir)
	if len(g["organisation"]) != 2 || len(g["public"]) != 1 || g["public"][0] != "Open help" || len(g["team"]) != 0 {
		t.Fatalf("outsider directory = %v", g)
	}
	if outsider.get("/v1/agents?q=advis", &dir); len(dir) != 1 || dir[0].Name != "Advising" {
		t.Fatalf("search = %+v", dir)
	}
	if outsider.get("/v1/agents?team=other", &dir); len(dir) != 0 {
		t.Fatalf("team filter = %+v", dir)
	}
	if code := outsider.get("/v1/agents/"+env.team+"/"+team.Slug, nil); code != 404 {
		t.Fatalf("team agent profile for outsider = %d", code)
	}

	// A non-member chats with an authenticated Sensitive agent: logged.
	if code, _, e := outsider.stream(env.chatPath(sens.Slug), map[string]any{"message": "When are advising walk-in hours?"}); code != 200 {
		t.Fatalf("outsider chat = %d %s", code, e)
	}
	if code, _, e := outsider.stream(env.chatPath(team.Slug), map[string]any{"message": "Hi"}); code != 404 {
		t.Fatalf("outsider chat with team agent = %d %s", code, e)
	}
	var logPage apitypes.AccessLogPage
	env.admin.get("/v1/admin/access-log?agentId="+sens.Id.String(), &logPage)
	if len(logPage.Items) != 1 || logPage.Items[0].UserEmail != "auditor@localhost" || logPage.Items[0].Rank != 1 {
		t.Fatalf("access log = %+v", logPage.Items)
	}

	// Short names: platform admins, validated, unique, audited.
	short := "/v1/admin/agents/" + pub.Id.String() + "/short-name"
	for _, bad := range []string{"embed", "A!", "x", "0a1b2c3d-0000-0000-0000-000000000000"} {
		code, e = env.admin.call("PUT", short, map[string]any{"shortName": bad}, nil, nil)
		mustCode(t, "short name "+bad, code, e, 400, "invalid_short_name")
	}
	code, e = outsider.call("PUT", short, map[string]any{"shortName": "open-help"}, nil, nil)
	mustCode(t, "auditor sets short name", code, e, 403, "forbidden")
	var aa apitypes.AdminAgent
	code, e = env.admin.call("PUT", short, map[string]any{"shortName": " Open-Help "}, &aa, nil)
	mustCode(t, "set short name", code, e, 200, "")
	if aa.ShortName == nil || *aa.ShortName != "open-help" || aa.Audience != "public" {
		t.Fatalf("admin agent = %+v", aa)
	}
	code, e = env.admin.call("PUT", "/v1/admin/agents/"+org.Id.String()+"/short-name", map[string]any{"shortName": "open-help"}, nil, nil)
	mustCode(t, "duplicate short name", code, e, 409, "short_name_taken")
	var card apitypes.AgentCard
	if code := outsider.get("/v1/agents/short/open-help", &card); code != 200 || card.Id != pub.Id || card.ShortName == nil {
		t.Fatalf("by short name = %d %+v", code, card)
	}
	anon := newVisitor(t, env.app.URL)
	var pa apitypes.PublicAgent
	if code, e := anon.call("GET", "/v1/public/agents/open-help", nil, &pa); code != 200 || pa.Id != pub.Id || pa.Captcha.Provider != "none" || pa.MaxMessageChars != 2000 {
		t.Fatalf("public profile = %d %s %+v", code, e, pa)
	}
	if code, _ := anon.call("GET", "/v1/public/agents/"+org.Id.String(), nil, nil); code != 404 {
		t.Fatalf("public profile of an authenticated agent = %d", code)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent.short_name'`); n != 1 {
		t.Errorf("short name audits = %d", n)
	}

	// The switch off hides public agents everywhere.
	env.setPublic(t, false)
	outsider.get("/v1/agents", &dir)
	if g := cardsByGroup(dir); len(g["public"]) != 0 {
		t.Fatalf("directory with public off = %v", g)
	}
	if code := outsider.get("/v1/agents/id/"+pub.Id.String(), nil); code != 404 {
		t.Fatalf("public agent profile with public off = %d", code)
	}
	if code, e := anon.call("GET", "/v1/public/agents/open-help", nil, nil); code != 503 || e != "public_disabled" {
		t.Fatalf("public profile with public off = %d %s", code, e)
	}
}

// F-19: raising a source used by a public agent names the audience, not
// the chat model, when only the audience blocks it.
func TestRaiseBlockedByAudienceSaysSo(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	var src apitypes.DataSource
	env.owner.get(env.base+"/sources/"+env.upload.Id.String(), &src)
	code, raw := env.owner.raw("PATCH", env.base+"/sources/"+src.Id.String(), map[string]any{"classification": "sensitive"}, ifMatch(src.Revision))
	var impact struct {
		Error struct {
			Code, Message string
			Details       apitypes.ClassificationImpact
		}
	}
	if err := json.Unmarshal(raw, &impact); err != nil || code != 409 || impact.Error.Code != "classification_impact" {
		t.Fatalf("raise = %d %s", code, raw)
	}
	var found *apitypes.ImpactedAgent
	for i := range impact.Error.Details.Agents {
		if impact.Error.Details.Agents[i].AgentId == pub.Id {
			found = &impact.Error.Details.Agents[i]
		}
	}
	if found == nil || len(found.Reasons) != 1 || found.Reasons[0] != apitypes.ImpactedAgentReasonsAudience ||
		len(found.ReasonText) != 1 || !strings.Contains(found.ReasonText[0], "audience (public)") {
		t.Fatalf("agent = %+v", found)
	}
	if !strings.Contains(impact.Error.Message, "audience isn't allowed") || strings.Contains(impact.Error.Message, "chat model") {
		t.Errorf("message = %q", impact.Error.Message)
	}
}
