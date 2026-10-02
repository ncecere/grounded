package httpapi_test

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/public"
	"github.com/ncecere/grounded/internal/retention"
)

// Anonymous session → chat → current conversation → retention expiry, with
// buffered output moderation and a blocked input (docs/phase4-publishing.md §5).
func TestAnonymousPublicChatAndRetention(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	team := env.publishAgent(t, "Team only", env.agentConfig(env.kb.Id.String()))
	v := newVisitor(t, env.app.URL)

	if code, e := v.call("GET", "/v1/public/sessions/current?agentId="+pub.Id.String(), nil, nil); code != 401 || e != "session_required" {
		t.Fatalf("current without a session = %d %s", code, e)
	}
	if code, _, e := v.ask(pub.Id, "Hi"); code != 401 {
		t.Fatalf("chat without a session = %d %s", code, e)
	}
	if code, e := v.start(team.Id, "", ""); code != 404 {
		t.Fatalf("session for a team agent = %d %s", code, e)
	}
	evil := newVisitor(t, env.app.URL)
	evil.origin = "https://evil.example"
	if code, e := evil.start(pub.Id, "", ""); code != 403 || e != "origin_not_allowed" {
		t.Fatalf("cross-site session = %d %s", code, e)
	}
	res, raw := v.do("POST", "/v1/public/sessions", map[string]any{"agentId": pub.Id}, nil)
	if res.StatusCode != 201 {
		t.Fatalf("start = %d %s", res.StatusCode, raw)
	}
	cookie := res.Header.Get("Set-Cookie")
	if !strings.HasPrefix(cookie, "grounded_anon_"+strings.ReplaceAll(pub.Id.String(), "-", "")+"=") ||
		!strings.Contains(cookie, "Path=/v1/public") || !strings.Contains(cookie, "HttpOnly") || !strings.Contains(cookie, "SameSite=Lax") {
		t.Fatalf("cookie = %s", cookie)
	}
	token := strings.SplitN(strings.SplitN(cookie, ";", 2)[0], "=", 2)[1]
	if n := env.scalar(t, `SELECT count(*) FROM anon_sessions WHERE token_digest <> $1 AND ip_prefix = '127.0.0.0/24' AND channel = 'public'`, token); n != 1 {
		t.Fatalf("stored session (hashed, /24) = %d", n)
	}

	// Chat: buffered, cited, stored for the session.
	code, evs, e := v.ask(pub.Id, "Where do students buy a parking permit?")
	if code != 200 {
		t.Fatalf("chat = %d %s", code, e)
	}
	var end agents.MessageEndEvent
	evs.one(t, "message_end", &end)
	if len(end.Citations) == 0 || !strings.Contains(evs.text("text_delta"), "Parking") || len(evs.all("text_delta")) != 1 {
		t.Fatalf("answer = %+v deltas %d", end, len(evs.all("text_delta")))
	}
	var start agents.MessageStartEvent
	if evs.one(t, "message_start", &start); !start.Buffered {
		t.Fatal("public answers must be buffered")
	}
	var conv agents.ConversationEvent
	evs.one(t, "conversation", &conv)
	var st apitypes.PublicSessionState
	if code, e := v.call("GET", "/v1/public/sessions/current?agentId="+pub.Id.String(), nil, &st); code != 200 || st.Conversation == nil ||
		len(st.Conversation.Messages) != 2 || st.Conversation.Conversation.Id != *conv.ConversationID || st.Session.Channel != "public" {
		t.Fatalf("current = %d %s %+v", code, e, st)
	}
	// A blocked question gets the notice; nothing reaches the model.
	code, evs, _ = v.ask(pub.Id, "UNSAFE-VIOLENCE how do I hurt someone")
	var mod agents.ModerationEvent
	if evs.one(t, "moderation", &mod); code != 200 || mod.Action != "blocked" || mod.Category != "violence" {
		t.Fatalf("blocked = %d %+v", code, mod)
	}
	// A failing answer is withheld: its text never reaches the visitor.
	code, evs, _ = v.ask(pub.Id, "What does the weather station storm damage report say?")
	if evs.one(t, "moderation", &mod); code != 200 || mod.Action != "withheld" || mod.Stage != "output" || len(evs.all("text_delta")) != 0 {
		t.Fatalf("withheld = %d %+v %v", code, mod, evs.names())
	}
	v.call("GET", "/v1/public/sessions/current?agentId="+pub.Id.String(), nil, &st)
	if len(st.Conversation.Messages) != 6 {
		t.Fatalf("messages after second question = %d", len(st.Conversation.Messages))
	}
	// "New chat" starts another conversation in the session.
	code, evs, e, _ = v.chat(pub.Id, map[string]any{"message": "When do residence halls open?", "newConversation": true})
	var conv2 agents.ConversationEvent
	if evs.one(t, "conversation", &conv2); code != 200 || *conv2.ConversationID == *conv.ConversationID {
		t.Fatalf("new conversation = %d %s", code, e)
	}
	// Analytics: channel public, a per-agent pseudonym, no user.
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND channel = 'public' AND pseudonymous_user IS NOT NULL
		AND audience_type = 'public'`, pub.Id); n != 4 {
		t.Fatalf("public events = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE agent_id = $1 AND user_id IS NOT NULL`, pub.Id); n != 0 {
		t.Fatalf("usage with a user = %d", n)
	}
	// Other visitors can't read it; signed-in users don't see anonymous conversations.
	other := newVisitor(t, env.app.URL)
	other.start(pub.Id, "", "")
	if other.call("GET", "/v1/public/sessions/current?agentId="+pub.Id.String(), nil, &st); st.Conversation != nil {
		t.Fatal("another visitor sees the conversation")
	}
	if code := env.member.get("/v1/conversations/"+conv.ConversationID.String(), nil); code != 404 {
		t.Fatalf("member reads an anonymous conversation = %d", code)
	}

	// Retention: past the level's anonymous retention (24 h) it is deleted.
	ctx := context.Background()
	env.app.Pool.Exec(ctx, `UPDATE conversations SET updated_at = now() - interval '25 hours' WHERE id = $1`, conv.ConversationID)
	env.app.Pool.Exec(ctx, `UPDATE conversations SET updated_at = now() - interval '23 hours' WHERE id = $1`, conv2.ConversationID)
	runner := &retention.Runner{Pool: env.app.Pool, Batch: 1}
	n, err := runner.Apply(ctx, nil)
	if err != nil || n[retention.Conversations].Deleted != 1 {
		t.Fatalf("retention = %v %v", n, err)
	}
	if env.scalar(t, `SELECT count(*) FROM conversations WHERE id = $1`, conv.ConversationID) != 0 ||
		env.scalar(t, `SELECT count(*) FROM conversations WHERE id = $1`, conv2.ConversationID) != 1 {
		t.Fatal("wrong conversations deleted")
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1`, pub.Id); n != 4 {
		t.Errorf("analytics events kept = %d", n)
	}
	// A level with a shorter anonymous retention deletes sooner.
	var open apitypes.Classification
	env.admin.get("/v1/classifications", &[]apitypes.Classification{})
	code, e = env.admin.call("PATCH", "/v1/admin/classifications/open", map[string]any{"anonymousRetentionHours": 12}, &open, ifMatch(1))
	mustCode(t, "retention hours", code, e, 200, "")
	if n, _ := runner.Apply(ctx, nil); n[retention.Conversations].Deleted != 1 {
		t.Fatalf("retention at 12 h = %v", n)
	}
	// Expired sessions end: the cookie no longer works.
	env.app.Pool.Exec(ctx, `UPDATE anon_sessions SET expires_at = now() - interval '1 minute'`)
	if n, _ := runner.Apply(ctx, nil); n[retention.AnonymousSessions].Deleted != 2 {
		t.Fatalf("session retention = %v", n)
	}
	if code, _, e := v.ask(pub.Id, "Hello again"); code != 401 || e != "session_expired" {
		t.Fatalf("after expiry = %d %s", code, e)
	}
}

// The widget: publishable keys, the embed page's headers, origin checks,
// guardrails (fail closed without Valkey), the key and kill switches.
func TestWidgetEmbedAndGuardrails(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	other := env.publicAgent(t, "Other help")
	keys := env.base + "/agents/" + pub.Id.String() + "/publishable-keys"

	body := map[string]any{"name": "Main site", "allowedOrigins": []string{"https://www.example.edu", "*.example.org", "http://127.0.0.1:8095"}}
	code, e := env.editor.call("POST", keys, body, nil, nil)
	mustCode(t, "editor creates a key", code, e, 403, "forbidden")
	code, e = env.tadmin.call("POST", keys, map[string]any{"name": "Bad", "allowedOrigins": []string{"https://example.edu/page"}}, nil, nil)
	mustCode(t, "bad origin", code, e, 400, "invalid_origin")
	code, e = env.tadmin.call("POST", keys, map[string]any{"name": "Too fast", "rateLimits": map[string]any{"perIpPerMinute": -1}}, nil, nil)
	mustCode(t, "bad override", code, e, 400, "invalid_limit")
	var created apitypes.PublishableKeyCreated
	code, e = env.tadmin.call("POST", keys, body, &created, nil)
	mustCode(t, "create key", code, e, 201, "")
	if _, ok := public.ParseKey(created.Key); !ok || !strings.HasPrefix(created.KeyPreview, created.Key[:16]) ||
		strings.Join(created.AllowedOrigins, " ") != "https://www.example.edu https://*.example.org http://127.0.0.1:8095" {
		t.Fatalf("created = %+v", created)
	}
	var list []apitypes.PublishableKey
	if env.tadmin.get(keys, &list); len(list) != 1 || list[0].Id != created.Id {
		t.Fatalf("keys = %+v", list)
	}
	if n := env.scalar(t, `SELECT count(*) FROM publishable_keys WHERE secret_hash = convert_to($1, 'UTF8')`, created.Key); n != 0 {
		t.Fatal("key stored in clear")
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent.publishable_key_create'`); n != 1 {
		t.Errorf("key audits = %d", n)
	}

	// The embed page: frame-ancestors from the key, no X-Frame-Options.
	anon := newVisitor(t, env.app.URL)
	embed := "/embed/" + pub.Id.String() + "?key=" + created.Key
	res, raw := anon.do("GET", embed, nil, map[string]string{"Referer": "https://news.example.org/story"})
	if csp := res.Header.Get("Content-Security-Policy"); res.StatusCode != 200 ||
		!strings.Contains(csp, "frame-ancestors 'self' https://www.example.edu https://*.example.org http://127.0.0.1:8095;") ||
		res.Header.Get("X-Frame-Options") != "" || strings.Contains(string(raw), "grounded-embed-error") {
		t.Fatalf("embed = %d %q xfo %q", res.StatusCode, csp, res.Header.Get("X-Frame-Options"))
	}
	if res, _ := anon.do("GET", "/v1/public/agents/"+pub.Id.String(), nil, nil); res.Header.Get("X-Frame-Options") != "DENY" {
		t.Error("X-Frame-Options must stay DENY elsewhere")
	}
	res, raw = anon.do("GET", embed, nil, map[string]string{"Referer": "https://evil.example/"})
	if res.StatusCode != 403 || !strings.Contains(string(raw), `content="origin_not_allowed"`) {
		t.Fatalf("embed from another site = %d", res.StatusCode)
	}
	res, raw = anon.do("GET", "/embed/"+other.Id.String()+"?key="+created.Key, nil, nil)
	if res.StatusCode != 403 || !strings.Contains(string(raw), `content="invalid_publishable_key"`) ||
		!strings.Contains(res.Header.Get("Content-Security-Policy"), "frame-ancestors *;") {
		t.Fatalf("embed with another agent's key = %d", res.StatusCode)
	}
	res, raw = anon.do("GET", "/widget.js", nil, nil)
	var sh apitypes.AgentSharing
	env.tadmin.get(env.base+"/agents/"+pub.Id.String()+"/sharing", &sh)
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/javascript") ||
		res.Header.Get("Access-Control-Allow-Origin") != "*" || !strings.HasPrefix(sh.Widget.Integrity, "sha384-") ||
		sh.Widget.ScriptUrl != env.app.URL+"/widget.js" || sh.Links.Id != env.app.URL+"/a/id/"+pub.Id.String() || len(raw) == 0 {
		t.Fatalf("widget.js = %d %+v", res.StatusCode, sh)
	}

	// Sessions with a key: the embedding origin must be allowed.
	anon.channel = agents.ChannelWidget
	if code, e := anon.start(pub.Id, created.Key, "https://evil.example"); code != 403 || e != "origin_not_allowed" {
		t.Fatalf("disallowed embed origin = %d %s", code, e)
	}
	if code, e := anon.start(pub.Id, created.Key, ""); code != 403 || e != "origin_not_allowed" {
		t.Fatalf("no embed origin = %d %s", code, e)
	}
	if code, e := anon.start(other.Id, created.Key, "https://www.example.edu"); code != 403 || e != "invalid_publishable_key" {
		t.Fatalf("key of another agent = %d %s", code, e)
	}
	if code, e := anon.start(pub.Id, created.Key, "https://a.example.org"); code != 201 {
		t.Fatalf("widget session = %d %s", code, e)
	}
	avoidMinuteBoundary()
	if code, _, e := anon.ask(pub.Id, "Where do students buy a parking permit?"); code != 200 {
		t.Fatalf("widget chat = %d %s", code, e)
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND channel = 'widget'`, pub.Id); n != 1 {
		t.Fatalf("widget events = %d", n)
	}

	// Guardrails. Per session (a key override), per address, daily, concurrency.
	var upd apitypes.PublishableKey
	code, e = env.tadmin.call("PATCH", keys+"/"+created.Id.String(), map[string]any{"rateLimits": map[string]any{"perSessionPerMinute": 1}}, &upd, ifMatch(created.Revision))
	mustCode(t, "key override", code, e, 200, "")
	if upd.RateLimits.PerSessionPerMinute == nil || *upd.RateLimits.PerSessionPerMinute != 1 || upd.Revision != created.Revision+1 {
		t.Fatalf("updated key = %+v", upd)
	}
	code, _, e, hdr := anon.chat(pub.Id, map[string]any{"message": "And housing?"})
	if code != 429 || e != "rate_limited" || hdr.Get("Retry-After") == "" {
		t.Fatalf("per session = %d %s", code, e)
	}
	setTeamLimits(t, env.admin, env.team, map[string]any{"public_queries_per_ip_per_minute": 1})
	fresh := newVisitor(t, env.app.URL)
	fresh.start(pub.Id, "", "")
	if code, _, e := fresh.ask(pub.Id, "Hello"); code != 429 || e != "rate_limited" {
		t.Fatalf("per address = %d %s", code, e)
	}
	setTeamLimits(t, env.admin, env.team, map[string]any{"public_queries_per_ip_per_minute": nil, "public_queries_per_agent_per_day": 1})
	if code, _, e := fresh.ask(pub.Id, "Hello"); code != 429 || e != "quota_exceeded" {
		t.Fatalf("daily cap = %d %s", code, e)
	}
	setTeamLimits(t, env.admin, env.team, map[string]any{"public_queries_per_agent_per_day": nil, "public_tokens_per_agent_per_day": 1})
	if code, _, e := fresh.ask(pub.Id, "Hello"); code != 429 || e != "quota_exceeded" {
		t.Fatalf("daily token cap = %d %s", code, e)
	}
	setTeamLimits(t, env.admin, env.team, map[string]any{"public_tokens_per_agent_per_day": nil, "public_concurrent_chats_per_agent": 0})
	if code, _, e := fresh.ask(pub.Id, "Hello"); code != 429 || e != "rate_limited" {
		t.Fatalf("concurrency = %d %s", code, e)
	}
	setTeamLimits(t, env.admin, env.team, map[string]any{"public_concurrent_chats_per_agent": nil, "public_message_max_chars": 5})
	if code, _, e := fresh.ask(pub.Id, "A long question"); code != 400 || e != "message_too_long" {
		t.Fatalf("length = %d %s", code, e)
	}
	setTeamLimits(t, env.admin, env.team, map[string]any{"public_message_max_chars": nil})

	// Valkey down: anonymous traffic fails closed, signed-in traffic doesn't.
	dead := &kv.Store{Client: redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, DialTimeout: 100 * time.Millisecond}), Prefix: "x:"}
	defer dead.Close()
	guard := env.app.Svc.Public.Guard
	live := guard.Counters
	guard.Counters = public.ValkeyCounters{KV: dead}
	if code, _, e := fresh.ask(pub.Id, "Hello"); code != 503 || e != "limits_unavailable" {
		t.Fatalf("valkey down = %d %s", code, e)
	}
	if code, _, e := env.member.stream(env.chatPath(pub.Slug), map[string]any{"message": "Where do students buy a parking permit?"}); code != 200 {
		t.Fatalf("member chat with valkey down = %d %s", code, e)
	}
	guard.Counters = live

	// Disabling the key stops its widget; the kill switch and the public
	// switch stop embeds.
	code, e = env.tadmin.call("PATCH", keys+"/"+created.Id.String(), map[string]any{"enabled": false}, &upd, ifMatch(upd.Revision))
	mustCode(t, "disable key", code, e, 200, "")
	if code, _, e := anon.ask(pub.Id, "Hello"); code != 403 || e != "invalid_publishable_key" {
		t.Fatalf("chat with a disabled key = %d %s", code, e)
	}
	if res, _ := anon.do("GET", embed, nil, nil); res.StatusCode != 403 {
		t.Fatalf("embed with a disabled key = %d", res.StatusCode)
	}
	env.tadmin.call("PATCH", keys+"/"+created.Id.String(), map[string]any{"enabled": true}, nil, ifMatch(upd.Revision))
	code, e = env.admin.call("POST", "/v1/admin/agents/"+pub.Id.String()+"/status", map[string]string{"status": "disabled_by_platform", "reason": "Abuse report"}, nil, nil)
	mustCode(t, "kill switch", code, e, 200, "")
	if res, raw := anon.do("GET", embed, nil, nil); res.StatusCode != 403 || !strings.Contains(string(raw), `content="agent_disabled"`) {
		t.Fatalf("embed of a killed agent = %d", res.StatusCode)
	}
	if code, e := anon.start(pub.Id, created.Key, "https://www.example.edu"); code != 403 || e != "agent_disabled" {
		t.Fatalf("session with a killed agent = %d %s", code, e)
	}
	env.admin.call("POST", "/v1/admin/agents/"+pub.Id.String()+"/status", map[string]string{"status": "active"}, nil, nil)
	env.setPublic(t, false)
	if res, raw := anon.do("GET", embed, nil, nil); res.StatusCode != 503 || !strings.Contains(string(raw), `content="public_disabled"`) {
		t.Fatalf("embed with public off = %d", res.StatusCode)
	}
	if code, e := anon.start(pub.Id, created.Key, "https://www.example.edu"); code != 503 || e != "public_disabled" {
		t.Fatalf("session with public off = %d %s", code, e)
	}
	code, e = env.tadmin.call("DELETE", keys+"/"+created.Id.String(), nil, nil, nil)
	mustCode(t, "revoke", code, e, 200, "")
	if env.tadmin.get(keys, &list); len(list) != 0 {
		t.Fatalf("keys after revoke = %+v", list)
	}
}

// F-07: a public agent's team address serves its public profile to
// anonymous visitors; agents for signed-in people are not found there.
func TestPublicAgentByTeamAddress(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	teamOnly := env.draftAgent(t, "Team help", env.kb.Id.String(), "team")
	if code, raw := env.publish(env.tadmin, teamOnly); code != 201 {
		t.Fatalf("publish team = %d %s", code, raw)
	}
	anon := newVisitor(t, env.app.URL)
	var got apitypes.PublicAgent
	if code, e := anon.call("GET", "/v1/public/teams/"+env.team+"/agents/"+pub.Slug, nil, &got); code != 200 || got.Id != pub.Id {
		t.Fatalf("team address = %d %s %+v", code, e, got)
	}
	if code, e := anon.call("GET", "/v1/public/teams/"+env.team+"/agents/"+teamOnly.Slug, nil, nil); code != 404 || e != "agent_not_found" {
		t.Errorf("team-only agent = %d %s", code, e)
	}
	if code, _ := anon.call("GET", "/v1/public/teams/no-such-team/agents/"+pub.Slug, nil, nil); code != 404 {
		t.Errorf("unknown team = %d", code)
	}
	env.setPublic(t, false)
	if code, e := anon.call("GET", "/v1/public/teams/"+env.team+"/agents/"+pub.Slug, nil, nil); code != 503 || e != "public_disabled" {
		t.Errorf("switch off = %d %s", code, e)
	}
}

// F-09: widget.js asks before showing its launcher; the answer names the
// problem for the site owner and never lists the key's origins.
func TestWidgetCheck(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	var key apitypes.PublishableKeyCreated
	code, e := env.tadmin.call("POST", env.base+"/agents/"+pub.Id.String()+"/publishable-keys",
		map[string]any{"name": "Main site", "allowedOrigins": []string{"https://www.example.edu", "localhost:8095"}}, &key, nil)
	mustCode(t, "create key", code, e, 201, "")
	if strings.Join(key.AllowedOrigins, " ") != "https://www.example.edu http://localhost:8095" {
		t.Errorf("origins = %v", key.AllowedOrigins)
	}
	anon := newVisitor(t, env.app.URL)
	check := func(origin, k string) apitypes.WidgetCheck {
		t.Helper()
		res, raw := anon.do("GET", "/v1/public/agents/"+pub.Id.String()+"/widget-check?key="+url.QueryEscape(k), nil, map[string]string{"Origin": origin})
		var out struct{ Data apitypes.WidgetCheck }
		if res.StatusCode != 200 || res.Header.Get("Access-Control-Allow-Origin") != "*" || json.Unmarshal(raw, &out) != nil {
			t.Fatalf("widget-check = %d %s", res.StatusCode, raw)
		}
		if strings.Contains(string(raw), "www.example.edu") {
			t.Errorf("the check leaked allowed origins: %s", raw)
		}
		return out.Data
	}
	if c := check("http://localhost:8095", key.Key); !c.Allowed || c.Name == nil || *c.Name != "Open help" {
		t.Errorf("allowed = %+v", c)
	}
	if c := check("http://127.0.0.1:8095", key.Key); c.Allowed || c.Code == nil || *c.Code != "origin_not_allowed" {
		t.Errorf("other site = %+v", c)
	}
	if c := check("https://www.example.edu", "pk_wrong"); c.Allowed || c.Code == nil || *c.Code != "invalid_publishable_key" {
		t.Errorf("bad key = %+v", c)
	}
	// P-14: the editor's widget preview gets the real public message limit.
	setTeamLimits(t, env.admin, env.team, map[string]any{"public_message_max_chars": 500})
	var sh apitypes.AgentSharing
	if env.tadmin.get(env.base+"/agents/"+pub.Id.String()+"/sharing", &sh); sh.Widget.MaxMessageChars != 500 {
		t.Errorf("preview limit = %d", sh.Widget.MaxMessageChars)
	}
	env.setPublic(t, false)
	if c := check("https://www.example.edu", key.Key); c.Allowed || c.Code == nil || *c.Code != "public_disabled" {
		t.Errorf("switch off = %+v", c)
	}

	// The key dialog's origin check (F-08).
	var checked []apitypes.WidgetOriginCheck
	code, e = env.tadmin.call("POST", "/v1/widget-origins/check", map[string]any{"origins": []string{"localhost:8095", "https://example.edu/page"}}, &checked, nil)
	mustCode(t, "check origins", code, e, 200, "")
	if len(checked) != 2 || checked[0].Origin == nil || *checked[0].Origin != "http://localhost:8095" ||
		checked[1].Problem == nil || !strings.Contains(*checked[1].Problem, "no path") {
		t.Errorf("checked = %+v", checked)
	}
	code, e = env.tadmin.call("POST", env.base+"/agents/"+pub.Id.String()+"/publishable-keys",
		map[string]any{"name": "Bad", "allowedOrigins": []string{"https://example.edu/page"}}, nil, nil)
	if code != 400 || !strings.Contains(e, "invalid_origin") {
		t.Errorf("bad origin = %d %s", code, e)
	}
}

// The widget's session is its own (walkthrough mem-6): it never continues
// the public page's session in the same browser (which has no key, so the
// key's limits and switch wouldn't apply), nor another key's, and the
// public page keeps its own.
func TestWidgetSessionIsItsOwn(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	keys := env.base + "/agents/" + pub.Id.String() + "/publishable-keys"
	var key, other apitypes.PublishableKeyCreated
	code, e := env.tadmin.call("POST", keys, map[string]any{"name": "Main site", "allowedOrigins": []string{"https://www.example.edu"}}, &key, nil)
	mustCode(t, "key", code, e, 201, "")
	code, e = env.tadmin.call("POST", keys, map[string]any{"name": "Other site", "allowedOrigins": []string{"https://www.example.edu"}}, &other, nil)
	mustCode(t, "other key", code, e, 201, "")
	current := "/v1/public/sessions/current?agentId=" + pub.Id.String()

	// The public page's session and conversation.
	v := newVisitor(t, env.app.URL)
	v.start(pub.Id, "", "")
	avoidMinuteBoundary()
	if code, _, e := v.ask(pub.Id, "Where do students buy a parking permit?"); code != 200 {
		t.Fatalf("public chat = %d %s", code, e)
	}
	// The widget doesn't see or use it.
	v.channel = agents.ChannelWidget
	for _, path := range []string{current, current + "&key=" + url.QueryEscape(key.Key)} {
		if code, e := v.call("GET", path, nil, nil); code != 401 || e != "session_required" {
			t.Fatalf("widget current with only a public session = %d %s", code, e)
		}
	}
	if code, _, e := v.ask(pub.Id, "Hello"); code != 401 || e != "session_required" {
		t.Fatalf("widget chat with only a public session = %d %s", code, e)
	}
	// It starts its own, in its own cookie, with the key's limits.
	res, raw := v.do("POST", "/v1/public/sessions", map[string]any{"agentId": pub.Id, "key": key.Key, "embedOrigin": "https://www.example.edu"}, nil)
	if res.StatusCode != 201 || !strings.HasPrefix(res.Header.Get("Set-Cookie"), "grounded_widget_"+strings.ReplaceAll(pub.Id.String(), "-", "")+"=") {
		t.Fatalf("widget session = %d %s %s", res.StatusCode, raw, res.Header.Get("Set-Cookie"))
	}
	var st apitypes.PublicSessionState
	if code, e := v.call("GET", current+"&key="+url.QueryEscape(key.Key), nil, &st); code != 200 || st.Session.Channel != "widget" || st.Conversation != nil {
		t.Fatalf("widget current = %d %s %+v", code, e, st)
	}
	if code, e := v.call("GET", current+"&key="+url.QueryEscape(other.Key), nil, nil); code != 401 || e != "session_required" {
		t.Fatalf("current with another key = %d %s", code, e)
	}
	var upd apitypes.PublishableKey
	code, e = env.tadmin.call("PATCH", keys+"/"+key.Id.String(), map[string]any{"rateLimits": map[string]any{"perSessionPerMinute": 1}}, &upd, ifMatch(key.Revision))
	mustCode(t, "key limits", code, e, 200, "")
	if code, _, e := v.ask(pub.Id, "Where do students buy a parking permit?"); code != 200 {
		t.Fatalf("widget chat = %d %s", code, e)
	}
	if code, _, e := v.ask(pub.Id, "And housing?"); code != 429 || e != "rate_limited" {
		t.Fatalf("widget chat past the key's limit = %d %s", code, e)
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND channel = 'widget'`, pub.Id); n != 1 {
		t.Fatalf("widget events = %d", n)
	}
	// The public page still has its own session and conversation.
	v.channel = ""
	if code, e := v.call("GET", current, nil, &st); code != 200 || st.Session.Channel != "public" || st.Conversation == nil || len(st.Conversation.Messages) != 2 {
		t.Fatalf("public current = %d %s %+v", code, e, st)
	}
	// The key's switch stops the widget, not the public page.
	code, e = env.tadmin.call("PATCH", keys+"/"+key.Id.String(), map[string]any{"enabled": false}, nil, ifMatch(upd.Revision))
	mustCode(t, "disable key", code, e, 200, "")
	v.channel = agents.ChannelWidget
	if code, _, e := v.ask(pub.Id, "Hello"); code != 403 || e != "invalid_publishable_key" {
		t.Fatalf("widget chat with a disabled key = %d %s", code, e)
	}
}
