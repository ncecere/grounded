package httpapi_test

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/internal/webhooks"
)

// Webhooks (v0.6.0, F3; docs/specs/v0.6.0/DESIGN.md §5): signed, retried events for other systems.

// receiver is a TLS server standing in for another system: its certificate covers *.example.com, and the app's webhook client reaches it for
// any host (the address guard is unit-tested; here it is off so the pipeline can run on loopback).
type receiver struct {
	srv *httptest.Server
	mu  sync.Mutex
	got []hookCall
	// answer is the HTTP status for the nth request (1-based); nil: 200.
	answer func(n int) int
}

type hookCall struct {
	header http.Header
	body   []byte
}

func (r *receiver) calls() []hookCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]hookCall(nil), r.got...)
}

// waitCalls waits until n requests arrived.
func (r *receiver) waitCalls(t *testing.T, n int) []hookCall {
	t.Helper()
	deadline := time.Now().Add(testutil.Scale(20 * time.Second))
	for {
		if c := r.calls(); len(c) >= n {
			return c
		}
		if time.Now().After(deadline) {
			t.Fatalf("the receiver got %d requests, want %d", len(r.calls()), n)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

type hookEnv struct {
	*agentEnv
	rx *receiver
}

func newHookEnv(t *testing.T) *hookEnv {
	t.Helper()
	env := &hookEnv{agentEnv: newAgentEnv(t), rx: &receiver{}}
	rx := env.rx
	rx.srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		rx.mu.Lock()
		rx.got = append(rx.got, hookCall{header: r.Header.Clone(), body: b})
		n := len(rx.got)
		answer := rx.answer
		rx.mu.Unlock()
		if answer != nil {
			w.WriteHeader(answer(n))
		}
	}))
	t.Cleanup(rx.srv.Close)
	pool := x509.NewCertPool()
	pool.AddCert(rx.srv.Certificate())
	svc := env.app.Svc.Webhooks
	svc.Client = webhooks.NewClient(webhooks.ClientConfig{
		AllowPrivate: true, TLS: &tls.Config{RootCAs: pool}, Timeout: 5 * time.Second,
		Lookup: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, rx.srv.Listener.Addr().String())
		},
	})
	svc.RetryBackoff = func(int) time.Duration { return 20 * time.Millisecond }
	env.setWebhooks(t, true)
	code, e := env.admin.call("POST", "/v1/admin/webhook-destinations", map[string]any{"pattern": "*.example.com", "note": "test receiver"}, nil, nil)
	mustCode(t, "approve a destination", code, e, 201, "")
	return env
}

func (env *hookEnv) setWebhooks(t *testing.T, on bool) {
	t.Helper()
	var cur apitypes.WebhookSettings
	if code := env.admin.get("/v1/admin/settings/webhooks", &cur); code != 200 {
		t.Fatalf("get webhook settings = %d", code)
	}
	code, e := env.admin.call("PUT", "/v1/admin/settings/webhooks", map[string]any{"enabled": on}, nil, ifMatch(cur.Revision))
	mustCode(t, "set webhooks", code, e, 200, "")
}

// make creates a webhook as s on base ("/v1/teams/<team>" or "/v1/admin") for the events, to a path on the approved host.
func (env *hookEnv) make(t *testing.T, s *session, base, path string, events ...string) apitypes.WebhookCreated {
	t.Helper()
	var c apitypes.WebhookCreated
	code, e := s.call("POST", base+"/webhooks", map[string]any{"url": "https://hooks.example.com/" + path, "events": events, "enabled": true}, &c, nil)
	mustCode(t, "create webhook", code, e, 201, "")
	return c
}

func (env *hookEnv) deliveries(t *testing.T, s *session, path string) []apitypes.WebhookDelivery {
	t.Helper()
	var out []apitypes.WebhookDelivery
	if code := s.get(path+"/deliveries", &out); code != 200 {
		t.Fatalf("list deliveries = %d", code)
	}
	return out
}

// waitStatus waits for the newest delivery to reach status.
func (env *hookEnv) waitStatus(t *testing.T, s *session, hookPath, status string) apitypes.WebhookDelivery {
	t.Helper()
	deadline := time.Now().Add(testutil.Scale(30 * time.Second))
	for {
		if d := env.deliveries(t, s, hookPath); len(d) > 0 && string(d[0].Status) == status {
			return d[0]
		}
		if time.Now().After(deadline) {
			t.Fatalf("no delivery reached %s: %+v", status, env.deliveries(t, s, hookPath))
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func (env *hookEnv) get(t *testing.T, s *session, path string) apitypes.Webhook {
	t.Helper()
	var w apitypes.Webhook
	if code := s.get(path, &w); code != 200 {
		t.Fatalf("get %s = %d", path, code)
	}
	return w
}

// envelope decodes a received body.
func envelope(t *testing.T, c hookCall) webhooks.Envelope {
	t.Helper()
	var e webhooks.Envelope
	if err := json.Unmarshal(c.body, &e); err != nil {
		t.Fatalf("body = %s: %v", c.body, err)
	}
	return e
}

func keysOf(m map[string]any) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func webhookEventIsSignedAndReachesTheTeamsWebhook(t *testing.T, env *hookEnv) {
	c := env.make(t, env.tadmin, env.base, "published", "agent.published")
	if !strings.HasPrefix(c.Secret, "whsec_") || len(c.Secret) < 40 || c.Webhook.SecretHint != c.Secret[len(c.Secret)-4:] {
		t.Fatalf("secret = %q, hint %q", c.Secret, c.Webhook.SecretHint)
	}
	path := env.base + "/webhooks/" + c.Webhook.Id.String()

	ag := env.publishAgent(t, "Parking help", env.agentConfig(env.kb.Id.String()))
	got := env.rx.waitCalls(t, 1)[0]
	if err := webhooks.Verify(c.Secret, got.header.Get("Grounded-Signature"), got.body, time.Now(), webhooks.SignatureTolerance); err != nil {
		t.Fatalf("the signature does not verify: %v", err)
	}
	if err := webhooks.Verify("whsec_"+strings.Repeat("x", 43), got.header.Get("Grounded-Signature"), got.body, time.Now(), webhooks.SignatureTolerance); err == nil {
		t.Error("another secret verified the signature")
	}
	ev := envelope(t, got)
	if ev.Type != "agent.published" || ev.Team == nil || ev.Team.Slug != env.team || ev.Data["agentId"] != ag.Id.String() || ev.Data["agentName"] != "Parking help" ||
		ev.Data["version"] != float64(1) || ev.Data["audience"] != "team" {
		t.Fatalf("event = %+v", ev)
	}
	if got.header.Get("Grounded-Event") != "agent.published" || got.header.Get("Grounded-Webhook") != c.Webhook.Id.String() ||
		got.header.Get("Content-Type") != "application/json" || !strings.HasPrefix(got.header.Get("User-Agent"), "Grounded-Webhooks/") {
		t.Errorf("headers = %v", got.header)
	}
	d := env.waitStatus(t, env.tadmin, path, "delivered")
	if got.header.Get("Grounded-Delivery") != d.Id.String() || d.EventId != ev.ID || d.Attempts != 1 || d.LastStatus == nil || *d.LastStatus != 200 || d.DeliveredAt == nil {
		t.Errorf("delivery = %+v, event %s", d, ev.ID)
	}
	// The secret is stored sealed, and the audit log never holds it.
	var sealed []byte
	if err := env.app.Pool.QueryRow(t.Context(), `SELECT secret_cipher FROM webhooks WHERE id = $1`, c.Webhook.Id).Scan(&sealed); err != nil || strings.Contains(string(sealed), c.Secret) {
		t.Errorf("secret_cipher = %q, %v", sealed, err)
	}
	plain, err := env.app.Svc.Webhooks.Box.Open(sealed, webhooks.SecretAAD(c.Webhook.Id))
	if err != nil || string(plain) != c.Secret {
		t.Errorf("the sealed secret opens to %q, %v", plain, err)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action LIKE 'webhook.%' AND (before_state::text LIKE '%whsec_%' OR after_state::text LIKE '%whsec_%' OR metadata::text LIKE '%whsec_%')`); n != 0 {
		t.Errorf("%d audit entries hold a secret", n)
	}
}

// What a webhook is told never includes content: a rating carries the agent, the message, the rating and the reason, and the body holds
// nothing of the question or the answer.
func webhookFeedbackCarriesNoContent(t *testing.T, env *hookEnv) {
	env.make(t, env.tadmin, env.base, "feedback", "feedback.submitted")
	ag := env.publishAgent(t, "Feedback agent", env.agentConfig(env.kb.Id.String()))
	question := "Where do students buy a parking permit?"
	code, evs, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": question})
	mustCode(t, "chat", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	code, e = env.member.call("POST", "/v1/messages/"+end.MessageId.String()+"/feedback", map[string]any{"rating": "down", "reason": "outdated"}, nil, nil)
	if code != 200 {
		t.Fatalf("feedback = %d %s", code, e)
	}
	got := env.rx.waitCalls(t, 1)[0]
	ev := envelope(t, got)
	if ev.Type != "feedback.submitted" || ev.Data["agentId"] != ag.Id.String() || ev.Data["messageId"] != end.MessageId.String() || ev.Data["rating"] != "down" || ev.Data["reason"] != "outdated" {
		t.Fatalf("event = %+v", ev)
	}
	if k := keysOf(ev.Data); len(k) != 4 {
		t.Errorf("data keys = %v, want agentId, messageId, rating, reason", k)
	}
	for _, secret := range []string{question, "parking permit", "blair", "alex"} {
		if strings.Contains(string(got.body), secret) {
			t.Errorf("the body holds %q: %s", secret, got.body)
		}
	}
	// Taking a rating back says nothing.
	code, e = env.member.call("POST", "/v1/messages/"+end.MessageId.String()+"/feedback", map[string]any{"rating": "none"}, nil, nil)
	mustCode(t, "take it back", code, e, 200, "")
	time.Sleep(300 * time.Millisecond)
	if n := len(env.rx.calls()); n != 1 {
		t.Errorf("the receiver got %d requests, want 1", n)
	}
}

func webhookRetriesThenGivesUpAndPauses(t *testing.T, env *hookEnv) {
	env.rx.answer = func(int) int { return 500 }
	c := env.make(t, env.tadmin, env.base, "down", "agent.published")
	path := env.base + "/webhooks/" + c.Webhook.Id.String()
	test := func() {
		mustCode(t, "test event", firstOf(env.tadmin.call("POST", path+"/test", nil, nil, nil)), "", 202, "")
	}

	test()
	d := env.waitStatus(t, env.tadmin, path, "failed")
	if d.Attempts != webhooks.MaxAttempts || d.LastStatus == nil || *d.LastStatus != 500 || d.LastError != "the receiver answered 500" {
		t.Fatalf("delivery = %+v, want %d attempts ending in a 500", d, webhooks.MaxAttempts)
	}
	if w := env.get(t, env.tadmin, path); w.ConsecutiveFailures != 1 || !w.Enabled {
		t.Fatalf("after one: %+v", w)
	}
	// Four more that give up pause it, and the team's admins and owners are told.
	for range 4 {
		test()
		env.waitFailed(t, env.tadmin, path)
	}
	w := env.get(t, env.tadmin, path)
	if w.Enabled || w.PausedReason != "failing" || w.ConsecutiveFailures != 5 {
		t.Fatalf("after five: %+v", w)
	}
	if n := env.scalar(t, `SELECT count(*) FROM notification_events WHERE type = 'webhook.paused' AND team_id = (SELECT id FROM teams WHERE slug = $1)`, env.team); n != 1 {
		t.Errorf("paused notifications = %d, want 1", n)
	}
	// Turning it back on is a deliberate edit, and clears the count.
	var cur apitypes.Webhook
	env.tadmin.get(path, &cur)
	code, e := env.tadmin.call("PATCH", path, map[string]any{"url": cur.Url, "events": cur.Events, "enabled": true}, &cur, ifMatch(cur.Revision))
	mustCode(t, "turn it back on", code, e, 200, "")
	if cur.PausedReason != "" || !cur.Enabled || cur.ConsecutiveFailures != 0 {
		t.Errorf("after turning it on: %+v", cur)
	}
}

func firstOf(code int, _ string) int { return code }

// waitFailed waits until the webhook has no delivery pending and the newest is failed.
func (env *hookEnv) waitFailed(t *testing.T, s *session, hookPath string) {
	t.Helper()
	deadline := time.Now().Add(testutil.Scale(30 * time.Second))
	for {
		d := env.deliveries(t, s, hookPath)
		pending := false
		for _, x := range d {
			pending = pending || x.Status == "pending"
		}
		if !pending && len(d) > 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("deliveries did not settle: %+v", d)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func webhookASuccessResetsTheCountAndAGoneReceiverPausesAtOnce(t *testing.T, env *hookEnv) {
	c := env.make(t, env.tadmin, env.base, "flaky", "agent.published")
	path := env.base + "/webhooks/" + c.Webhook.Id.String()
	fail := true
	env.rx.answer = func(int) int {
		if fail {
			return 503
		}
		return 204
	}
	post := func() {
		mustCode(t, "test event", firstOf(env.tadmin.call("POST", path+"/test", nil, nil, nil)), "", 202, "")
	}
	post()
	env.waitFailed(t, env.tadmin, path)
	post()
	env.waitFailed(t, env.tadmin, path)
	if w := env.get(t, env.tadmin, path); w.ConsecutiveFailures != 2 || !w.Enabled {
		t.Fatalf("after two: %+v", w)
	}
	fail = false
	post()
	env.waitStatus(t, env.tadmin, path, "delivered")
	if w := env.get(t, env.tadmin, path); w.ConsecutiveFailures != 0 {
		t.Errorf("a success did not reset the count: %+v", w)
	}

	// 410 Gone: no retries, paused at once, and the admins are told.
	env.rx.answer = func(int) int { return http.StatusGone }
	before := len(env.rx.calls())
	post()
	d := env.waitStatus(t, env.tadmin, path, "failed")
	if d.Attempts != 1 || len(env.rx.calls()) != before+1 {
		t.Errorf("a 410 was retried: %+v, %d requests", d, len(env.rx.calls())-before)
	}
	if w := env.get(t, env.tadmin, path); w.Enabled || w.PausedReason != "gone" {
		t.Errorf("after a 410: %+v", w)
	}
	if n := env.scalar(t, `SELECT count(*) FROM notification_events WHERE type = 'webhook.paused'`); n != 1 {
		t.Errorf("paused notifications = %d, want 1", n)
	}
}

func webhookEventsStayInTheirScope(t *testing.T, env *hookEnv) {
	team := env.make(t, env.tadmin, env.base, "team", "agent.published", "source.synced")
	plat := env.make(t, env.admin, "/v1/admin", "platform", "team.created")
	teamPath, platPath := env.base+"/webhooks/"+team.Webhook.Id.String(), "/v1/admin/webhooks/"+plat.Webhook.Id.String()

	// A platform event reaches the platform webhook only; a team event the team's only.
	code, e := env.admin.call("POST", "/v1/admin/teams", map[string]any{"slug": "other-team", "name": "Other", "maxClassification": "open", "ownerEmail": "alex@localhost"}, nil, nil)
	mustCode(t, "create a team", code, e, 201, "")
	got := env.rx.waitCalls(t, 1)
	ev := envelope(t, got[0])
	if ev.Type != "team.created" || ev.Team != nil || ev.Data["slug"] != "other-team" || ev.Data["name"] != "Other" || ev.Data["maxClassification"] != "open" {
		t.Fatalf("platform event = %+v", ev)
	}
	if err := webhooks.Verify(plat.Secret, got[0].header.Get("Grounded-Signature"), got[0].body, time.Now(), time.Minute); err != nil {
		t.Errorf("signed with the wrong secret: %v", err)
	}
	env.publishAgent(t, "Scope agent", env.agentConfig(env.kb.Id.String()))
	env.rx.waitCalls(t, 2)
	time.Sleep(300 * time.Millisecond)
	if n := len(env.deliveries(t, env.tadmin, teamPath)); n != 1 {
		t.Errorf("the team webhook has %d deliveries, want its agent.published only", n)
	}
	if d := env.deliveries(t, env.admin, platPath); len(d) != 1 || d[0].EventType != "team.created" {
		t.Errorf("the platform webhook has %+v", d)
	}
	// Another team's agent is not this team's event: a webhook of "other-team" sees nothing of "registrar".
	if n := env.scalar(t, `SELECT count(*) FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE w.team_id IS NULL AND d.event_type <> 'team.created'`); n != 0 {
		t.Errorf("the platform webhook has %d team events", n)
	}
}

func webhookTeamRequestEventHasNoPurpose(t *testing.T, env *hookEnv) {
	env.make(t, env.admin, "/v1/admin", "requests", "team_request.created")
	var cur apitypes.TeamRequestSettings
	env.admin.get("/v1/admin/settings/team-requests", &cur)
	code, e := env.admin.call("PUT", "/v1/admin/settings/team-requests", map[string]any{"enabled": true, "maxOpen": 2, "allowedGroup": ""}, nil, ifMatch(cur.Revision))
	mustCode(t, "turn team requests on", code, e, 200, "")
	code, e = env.member.call("POST", "/v1/team-requests", map[string]any{"name": "Robotics Club", "purpose": "SECRET-PURPOSE for robots", "classification": "open"}, nil, nil)
	mustCode(t, "ask for a team", code, e, 201, "")
	got := env.rx.waitCalls(t, 1)[0]
	ev := envelope(t, got)
	if ev.Type != "team_request.created" || ev.Data["name"] != "Robotics Club" || ev.Data["classification"] != "open" || ev.Data["requestId"] == nil {
		t.Fatalf("event = %+v", ev)
	}
	if k := keysOf(ev.Data); len(k) != 3 || strings.Contains(string(got.body), "SECRET-PURPOSE") || strings.Contains(string(got.body), "blair") {
		t.Errorf("data keys %v, body %s", k, got.body)
	}
}

func webhookSourceSyncEvents(t *testing.T, env *hookEnv) {
	env.make(t, env.tadmin, env.base, "sync", "source.synced", "source.sync_failed")
	sources := env.base + "/sources"
	src := env.createWeb(t, env.owner, sources, "Registrar site", map[string]any{"mode": "scrape", "urls": []string{env.site.url("/about")}})
	run := waitCrawl(t, env.owner, sources+"/"+src.Id.String(), src.ActiveCrawl.Id)
	if run.Status != "completed" {
		t.Fatalf("crawl = %+v", run)
	}
	ev := envelope(t, env.rx.waitCalls(t, 1)[0])
	if ev.Type != "source.synced" || ev.Data["sourceId"] != src.Id.String() || ev.Data["sourceName"] != "Registrar site" || ev.Data["crawlId"] != src.ActiveCrawl.Id.String() ||
		ev.Data["pagesChanged"] != float64(1) || ev.Data["documentsDeleted"] != float64(0) || ev.Data["truncated"] != false {
		t.Fatalf("synced = %+v", ev)
	}

	// A sync that fails: the source, the run and a short reason. With one crawl slot B waits behind A; crawling is then blocked (0 pages a day),
	// so B fails when A frees the slot.
	setTeamLimits(t, env.admin, env.team, map[string]any{"concurrent_crawls": 1})
	env.site.setDelay(200 * time.Millisecond)
	a := env.createWeb(t, env.owner, sources, "A", map[string]any{"mode": "scrape", "urls": []string{env.site.url("/")}})
	b := env.createWeb(t, env.owner, sources, "B", map[string]any{"mode": "scrape", "urls": []string{env.site.url("/about")}})
	setTeamLimits(t, env.admin, env.team, map[string]any{"crawl_pages_per_day": 0})
	waitCrawl(t, env.owner, sources+"/"+a.Id.String(), a.ActiveCrawl.Id)
	if r := waitCrawl(t, env.owner, sources+"/"+b.Id.String(), b.ActiveCrawl.Id); r.Status != "failed" {
		t.Fatalf("B = %+v", r)
	}
	var failed *webhooks.Envelope
	deadline := time.Now().Add(testutil.Scale(20 * time.Second))
	for failed == nil && time.Now().Before(deadline) {
		for _, c := range env.rx.calls() {
			if e := envelope(t, c); e.Type == "source.sync_failed" {
				failed = &e
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	if failed == nil {
		t.Fatalf("no source.sync_failed arrived: %d events", len(env.rx.calls()))
	}
	msg, _ := failed.Data["error"].(string)
	if failed.Data["sourceId"] != b.Id.String() || failed.Data["sourceName"] != "B" || failed.Data["crawlId"] != b.ActiveCrawl.Id.String() || !strings.Contains(msg, "blocked") {
		t.Fatalf("failed = %+v", failed)
	}
	for _, c := range env.rx.calls() {
		if e := envelope(t, c); e.Type == "source.synced" && e.Data["sourceId"] == b.Id.String() {
			t.Errorf("a failed sync was also reported as synced: %+v", e)
		}
	}
}

func webhookDestinationsAndURLs(t *testing.T, env *hookEnv) {
	post := func(url string, events ...string) (int, string) {
		return env.tadmin.call("POST", env.base+"/webhooks", map[string]any{"url": url, "events": events, "enabled": true}, nil, nil)
	}
	for _, c := range []struct{ url, code string }{
		{"http://hooks.example.com/x", "invalid_url"},
		{"https://hooks.example.com:8443/x", "invalid_port"},
		{"https://user:pw@hooks.example.com/x", "invalid_url"},
		{"https://hooks.example.com/x#frag", "invalid_url"},
		{"https://127.0.0.1/x", "invalid_host"},
		{"https://[::1]/x", "invalid_host"},
		{"https://0x7f.0.0.1/x", "invalid_host"},
		{"https://hooks.evil.org/x", "destination_not_approved"},
		{"https://hooks.example.com.evil.org/x", "destination_not_approved"}, // a suffix match is not a subdomain match
		{"not a url", "invalid_url"},
		{"https://hooks.example.com/" + strings.Repeat("a", 2100), "invalid_url"},
	} {
		if code, e := post(c.url, "agent.published"); code != 400 || e != c.code {
			t.Errorf("%.50s: %d %s, want %s", c.url, code, e, c.code)
		}
	}
	if code, e := post("https://hooks.example.com/x"); code != 400 || e != "no_events" {
		t.Errorf("no events: %d %s", code, e)
	}
	for _, bad := range []string{"nonsense", "team.created", "webhook.test"} {
		if code, e := post("https://hooks.example.com/x", bad); code != 400 || e != "invalid_event" {
			t.Errorf("event %s: %d %s", bad, code, e)
		}
	}
	if code, e := env.admin.call("POST", "/v1/admin/webhooks", map[string]any{"url": "https://hooks.example.com/x", "events": []string{"agent.published"}, "enabled": true}, nil, nil); code != 400 || e != "invalid_event" {
		t.Errorf("a team event on a platform webhook: %d %s", code, e)
	}
	if code, e := env.tadmin.call("POST", env.base+"/webhooks", map[string]any{"url": "https://hooks.example.com/x", "description": "two\nlines", "events": []string{"agent.published"}, "enabled": true}, nil, nil); code != 400 || e != "invalid_description" {
		t.Errorf("a description with a line break: %d %s", code, e)
	}

	// Destinations: bad patterns are refused, and withdrawing one stops what is sent there at once.
	for _, p := range []string{"*", "127.0.0.1", "10.0.0.5", "0x7f.0.0.1", "", "has space.example.com"} {
		if code, e := env.admin.call("POST", "/v1/admin/webhook-destinations", map[string]any{"pattern": p}, nil, nil); code != 400 {
			t.Errorf("pattern %q: %d %s", p, code, e)
		}
	}
	// The switch is changed with the revision that was read.
	if code, e := env.admin.call("PUT", "/v1/admin/settings/webhooks", map[string]any{"enabled": false}, nil, ifMatch(999)); code != 412 {
		t.Errorf("a stale switch change: %d %s, want 412", code, e)
	}
	if code, e := env.tadmin.call("PUT", "/v1/admin/settings/webhooks", map[string]any{"enabled": false}, nil, ifMatch(1)); code != 403 {
		t.Errorf("a team admin turning webhooks off: %d %s, want 403", code, e)
	}
	if code, e := env.admin.call("POST", "/v1/admin/webhook-destinations", map[string]any{"pattern": "*.EXAMPLE.com"}, nil, nil); code != 409 || e != "destination_exists" {
		t.Errorf("a repeated pattern: %d %s", code, e)
	}
	c := env.make(t, env.tadmin, env.base, "gone", "agent.published")
	path := env.base + "/webhooks/" + c.Webhook.Id.String()
	var dests []apitypes.WebhookDestination
	env.tadmin.get("/v1/webhook-destinations", &dests)
	if len(dests) != 1 || dests[0].Pattern != "*.example.com" {
		t.Fatalf("destinations = %+v", dests)
	}
	if code, _ := env.tadmin.call("DELETE", "/v1/admin/webhook-destinations/"+dests[0].Id.String(), nil, nil, nil); code != 403 {
		t.Errorf("a team admin withdrawing a destination = %d, want 403", code)
	}
	code, e := env.admin.call("DELETE", "/v1/admin/webhook-destinations/"+dests[0].Id.String(), nil, nil, nil)
	mustCode(t, "withdraw", code, e, 200, "")
	before := len(env.rx.calls())
	mustCode(t, "test event", firstOf(env.tadmin.call("POST", path+"/test", nil, nil, nil)), "", 202, "")
	d := env.waitStatus(t, env.tadmin, path, "failed")
	if d.Attempts != 1 || d.LastError != "the host is no longer an approved destination" || len(env.rx.calls()) != before {
		t.Errorf("after withdrawing: %+v, %d requests", d, len(env.rx.calls())-before)
	}
}

func webhookSwitchOffRecordsNothingAndKeepsWhatExists(t *testing.T, env *hookEnv) {
	c := env.make(t, env.tadmin, env.base, "keep", "agent.published")
	path := env.base + "/webhooks/" + c.Webhook.Id.String()
	env.setWebhooks(t, false)

	env.publishAgent(t, "Parking help", env.agentConfig(env.kb.Id.String()))
	time.Sleep(300 * time.Millisecond)
	if n := env.scalar(t, `SELECT count(*) FROM webhook_deliveries`); n != 0 || len(env.rx.calls()) != 0 {
		t.Errorf("with webhooks off: %d deliveries, %d requests", n, len(env.rx.calls()))
	}
	for name, call := range map[string]func() (int, string){
		"create": func() (int, string) {
			return env.tadmin.call("POST", env.base+"/webhooks", map[string]any{"url": "https://hooks.example.com/y", "events": []string{"agent.published"}, "enabled": true}, nil, nil)
		},
		"test": func() (int, string) { return env.tadmin.call("POST", path+"/test", nil, nil, nil) },
	} {
		if code, e := call(); code != 409 || e != "webhooks_off" {
			t.Errorf("%s with webhooks off: %d %s", name, code, e)
		}
	}
	// What exists is kept, readable and deletable; on again, it works.
	if w := env.get(t, env.tadmin, path); !w.Enabled {
		t.Errorf("the webhook = %+v", w)
	}
	env.setWebhooks(t, true)
	env.publishAgent(t, "Housing help", env.agentConfig(env.kb.Id.String()))
	env.rx.waitCalls(t, 1)
}

// The event and its deliveries are recorded in the transaction that made the change: one that rolls back sends nothing.
func webhookOutboxFollowsTheTransaction(t *testing.T, env *hookEnv) {
	env.make(t, env.tadmin, env.base, "outbox", "agent.published")
	svc := env.app.Svc.Webhooks
	var teamID string
	if err := env.app.Pool.QueryRow(t.Context(), `SELECT id FROM teams WHERE slug = $1`, env.team).Scan(&teamID); err != nil {
		t.Fatal(err)
	}
	emit := func(commit bool) {
		tx, err := env.app.Pool.Begin(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		ev := webhooks.Event{Type: webhooks.EventAgentPublished, Data: map[string]any{"agentId": "a"}}
		if err := env.app.Pool.QueryRow(t.Context(), `SELECT id FROM teams WHERE slug = $1`, env.team).Scan(&ev.TeamID); err != nil {
			t.Fatal(err)
		}
		if err := svc.Emit(t.Context(), tx, ev); err != nil {
			t.Fatal(err)
		}
		if commit {
			err = tx.Commit(t.Context())
		} else {
			err = tx.Rollback(t.Context())
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	emit(false)
	time.Sleep(300 * time.Millisecond)
	if n := env.scalar(t, `SELECT count(*) FROM webhook_deliveries`); n != 0 || len(env.rx.calls()) != 0 {
		t.Fatalf("a rolled-back change left %d deliveries and %d requests", n, len(env.rx.calls()))
	}
	emit(true)
	env.rx.waitCalls(t, 1)
	// A platform event on a team (or the reverse) is a bug in the caller, refused.
	tx, _ := env.app.Pool.Begin(t.Context())
	defer tx.Rollback(t.Context())
	if err := svc.Emit(t.Context(), tx, webhooks.Event{Type: webhooks.EventTeamCreated}); err != nil {
		t.Errorf("a platform event: %v", err)
	}
	if err := svc.Emit(t.Context(), tx, webhooks.Event{Type: webhooks.EventAgentPublished}); err == nil {
		t.Error("a team event without a team was accepted")
	}
	if err := svc.Emit(t.Context(), tx, webhooks.Event{Type: "nonsense"}); err == nil {
		t.Error("an unknown event type was accepted")
	}
}

func webhookWhoManagesWhat(t *testing.T, env *hookEnv) {
	c := env.make(t, env.tadmin, env.base, "mine", "agent.published")
	path := env.base + "/webhooks/" + c.Webhook.Id.String()
	// Editors and members cannot see them; a platform admin who is not on the team gets a 404, an auditor too.
	for name, s := range map[string]*session{"editor": env.editor, "member": env.member} {
		if code := s.get(env.base+"/webhooks", nil); code != 403 {
			t.Errorf("%s lists webhooks = %d, want 403", name, code)
		}
	}
	for name, s := range map[string]*session{"platform admin": env.admin, "auditor": env.auditor} {
		if code := s.get(env.base+"/webhooks", nil); code != 404 {
			t.Errorf("%s lists a team's webhooks = %d, want 404", name, code)
		}
	}
	// The team's owner can; a webhook of another scope is not found through this one.
	if code := env.owner.get(path, nil); code != 200 {
		t.Errorf("the owner gets the webhook = %d", code)
	}
	plat := env.make(t, env.admin, "/v1/admin", "platform", "team.created")
	if code := env.tadmin.get(env.base+"/webhooks/"+plat.Webhook.Id.String(), nil); code != 404 {
		t.Errorf("a platform webhook through a team = %d, want 404", code)
	}
	if code := env.tadmin.get("/v1/admin/webhooks", nil); code != 403 {
		t.Errorf("a team admin lists platform webhooks = %d, want 403", code)
	}
	if code := env.auditor.get("/v1/admin/webhooks", nil); code != 200 {
		t.Errorf("an auditor reads platform webhooks = %d", code)
	}
	if code, _ := env.auditor.call("POST", "/v1/admin/webhooks", map[string]any{"url": "https://hooks.example.com/z", "events": []string{"team.created"}, "enabled": true}, nil, nil); code != 403 {
		t.Errorf("an auditor makes a platform webhook = %d, want 403", code)
	}
	// 10 a scope.
	for i := 1; i < 10; i++ {
		env.make(t, env.tadmin, env.base, fmt.Sprintf("n%d", i), "agent.published")
	}
	if code, e := env.tadmin.call("POST", env.base+"/webhooks", map[string]any{"url": "https://hooks.example.com/11", "events": []string{"agent.published"}, "enabled": true}, nil, nil); code != 409 || e != "too_many_webhooks" {
		t.Errorf("the eleventh: %d %s", code, e)
	}
}

func webhookRotateRedeliverAndAudit(t *testing.T, env *hookEnv) {
	c := env.make(t, env.tadmin, env.base, "rot", "agent.published")
	path := env.base + "/webhooks/" + c.Webhook.Id.String()
	mustCode(t, "test event", firstOf(env.tadmin.call("POST", path+"/test", nil, nil, nil)), "", 202, "")
	first := env.rx.waitCalls(t, 1)[0]
	if envelope(t, first).Type != "webhook.test" {
		t.Fatalf("the test event = %s", first.body)
	}
	d := env.waitStatus(t, env.tadmin, path, "delivered")

	// Rotating replaces the secret at once: the old one no longer verifies, the new one does.
	var rotated apitypes.WebhookCreated
	code, e := env.tadmin.call("POST", path+"/rotate-secret", nil, &rotated, nil)
	mustCode(t, "rotate", code, e, 200, "")
	if rotated.Secret == c.Secret || rotated.Webhook.SecretHint == c.Webhook.SecretHint && rotated.Secret[len(rotated.Secret)-4:] != rotated.Webhook.SecretHint {
		t.Fatalf("rotated = %+v", rotated)
	}
	// Redelivering sends the same event again: the same ID and body, a new delivery, signed with the new secret.
	var again apitypes.WebhookDelivery
	code, e = env.tadmin.call("POST", path+"/deliveries/"+d.Id.String()+"/redeliver", nil, &again, nil)
	mustCode(t, "redeliver", code, e, 202, "")
	second := env.rx.waitCalls(t, 2)[1]
	if string(second.body) != string(first.body) || again.EventId != d.EventId || again.Id == d.Id {
		t.Errorf("the redelivery is %s (delivery %s), the first %s (delivery %s)", second.body, again.Id, first.body, d.Id)
	}
	if webhooks.Verify(c.Secret, second.header.Get("Grounded-Signature"), second.body, time.Now(), time.Minute) == nil {
		t.Error("the old secret still verifies")
	}
	if err := webhooks.Verify(rotated.Secret, second.header.Get("Grounded-Signature"), second.body, time.Now(), time.Minute); err != nil {
		t.Errorf("the new secret does not verify: %v", err)
	}
	if code, e := env.tadmin.call("POST", path+"/deliveries/"+noWebhook+"/redeliver", nil, nil, nil); code != 404 || e != "delivery_not_found" {
		t.Errorf("redeliver a delivery that does not exist: %d %s", code, e)
	}

	// Update with If-Match, stale refused; delete removes the delivery log.
	var cur apitypes.Webhook
	env.tadmin.get(path, &cur)
	rev := cur.Revision
	code, e = env.tadmin.call("PATCH", path, map[string]any{"url": cur.Url, "description": "Parking alerts", "events": []string{"agent.published", "source.synced"}, "enabled": true}, &cur, ifMatch(rev))
	mustCode(t, "update", code, e, 200, "")
	if cur.Description != "Parking alerts" || len(cur.Events) != 2 {
		t.Errorf("updated = %+v", cur)
	}
	if code, e := env.tadmin.call("PATCH", path, map[string]any{"url": cur.Url, "events": cur.Events, "enabled": true}, nil, ifMatch(rev)); code != 412 {
		t.Errorf("a stale update = %d %s, want 412", code, e)
	}
	code, e = env.tadmin.call("DELETE", path, nil, nil, nil)
	mustCode(t, "delete", code, e, 200, "")
	if n := env.scalar(t, `SELECT count(*) FROM webhook_deliveries WHERE webhook_id = $1`, c.Webhook.Id); n != 0 {
		t.Errorf("%d deliveries survived the webhook", n)
	}
	// The team's audit log records it all, without the secret; the team's people read it as they read the rest.
	for _, action := range []string{"webhook.create", "webhook.test", "webhook.rotate_secret", "webhook.redeliver", "webhook.update", "webhook.delete"} {
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = $1 AND target_id = $2 AND team_id = (SELECT id FROM teams WHERE slug = $3)`, action, c.Webhook.Id.String(), env.team); n != 1 {
			t.Errorf("audit %s = %d entries in the team's log, want 1", action, n)
		}
	}
	for _, action := range []string{"platform.webhooks", "webhook_destination.create"} {
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = $1 AND team_id IS NULL`, action); n < 1 {
			t.Errorf("audit %s = %d entries in the platform's log, want at least 1", action, n)
		}
	}
}

// A webhook keeps its delivery log for 14 days.
func webhookPrunesOldDeliveries(t *testing.T, env *hookEnv) {
	c := env.make(t, env.tadmin, env.base, "prune", "agent.published")
	for _, age := range []string{"15 days", "13 days", "1 hour"} {
		if _, err := env.app.Pool.Exec(t.Context(), `INSERT INTO webhook_deliveries (webhook_id, event_id, event_type, payload, status, created_at)
			VALUES ($1, gen_random_uuid(), 'agent.published', '{}', 'delivered', now() - $2::interval)`, c.Webhook.Id, age); err != nil {
			t.Fatal(err)
		}
	}
	if err := (&webhooks.PruneWorker{S: env.app.Svc.Webhooks}).Work(t.Context(), nil); err != nil {
		t.Fatal(err)
	}
	if n := env.scalar(t, `SELECT count(*) FROM webhook_deliveries WHERE webhook_id = $1`, c.Webhook.Id); n != 2 {
		t.Errorf("%d deliveries are left, want the two from the last 14 days", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM webhook_deliveries WHERE webhook_id = $1 AND created_at < now() - interval '14 days'`, c.Webhook.Id); n != 0 {
		t.Errorf("%d old deliveries survived", n)
	}
}

// The tests share an environment by group (making one takes most of a test's time); each starts clean.
func TestWebhookEvents(t *testing.T) {
	env := newHookEnv(t)
	for name, fn := range map[string]func(*testing.T, *hookEnv){
		"signed and reaches the team's webhook": webhookEventIsSignedAndReachesTheTeamsWebhook,
		"feedback carries no content":           webhookFeedbackCarriesNoContent,
		"team request has no purpose":           webhookTeamRequestEventHasNoPurpose,
		"source sync events":                    webhookSourceSyncEvents,
		"events stay in their scope":            webhookEventsStayInTheirScope,
	} {
		t.Run(name, func(t *testing.T) { env.reset(t); fn(t, env) })
	}
}

func TestWebhookDelivery(t *testing.T) {
	env := newHookEnv(t)
	for name, fn := range map[string]func(*testing.T, *hookEnv){
		"retries, gives up and pauses":             webhookRetriesThenGivesUpAndPauses,
		"a success resets the count, a 410 pauses": webhookASuccessResetsTheCountAndAGoneReceiverPausesAtOnce,
		"the switch off records nothing":           webhookSwitchOffRecordsNothingAndKeepsWhatExists,
		"the outbox follows the transaction":       webhookOutboxFollowsTheTransaction,
		"old deliveries are pruned":                webhookPrunesOldDeliveries,
	} {
		t.Run(name, func(t *testing.T) { env.reset(t); fn(t, env) })
	}
}

func TestWebhookManagement(t *testing.T) {
	env := newHookEnv(t)
	for name, fn := range map[string]func(*testing.T, *hookEnv){
		"destinations and addresses":  webhookDestinationsAndURLs,
		"who manages what":            webhookWhoManagesWhat,
		"rotate, redeliver and audit": webhookRotateRedeliverAndAudit,
	} {
		t.Run(name, func(t *testing.T) { env.reset(t); fn(t, env) })
	}
}

// reset makes the environment as newHookEnv left it: webhooks on, the destination approved, no webhooks, nothing received.
func (env *hookEnv) reset(t *testing.T) {
	t.Helper()
	env.rx.mu.Lock()
	env.rx.got, env.rx.answer = nil, nil
	env.rx.mu.Unlock()
	for _, q := range []string{`DELETE FROM webhooks`, `DELETE FROM notification_events WHERE type LIKE '%webhook%paused'`, `DELETE FROM webhook_destinations`} {
		if _, err := env.app.Pool.Exec(t.Context(), q); err != nil {
			t.Fatal(err)
		}
	}
	var cur apitypes.WebhookSettings
	env.admin.get("/v1/admin/settings/webhooks", &cur)
	if !cur.Enabled {
		env.setWebhooks(t, true)
	}
	code, e := env.admin.call("POST", "/v1/admin/webhook-destinations", map[string]any{"pattern": "*.example.com", "note": "test receiver"}, nil, nil)
	mustCode(t, "approve a destination", code, e, 201, "")
}
