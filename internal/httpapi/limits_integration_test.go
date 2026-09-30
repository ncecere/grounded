package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// limitError is an error response with limit details.
type limitError struct {
	Error struct {
		Code    string
		Message string
		Details struct {
			Limit   string
			Max     int64
			Current int64
		}
	}
}

func decodeLimitError(t *testing.T, raw []byte) limitError {
	t.Helper()
	var e limitError
	if err := json.Unmarshal(raw, &e); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return e
}

// setTeamLimits sets overrides (nil value = inherit) with the current revision.
func setTeamLimits(t *testing.T, admin *session, team string, values map[string]any) apitypes.TeamLimitOverrides {
	t.Helper()
	var cur apitypes.TeamLimitOverrides
	if code := admin.get("/v1/admin/teams/"+team+"/limits", &cur); code != 200 {
		t.Fatalf("get team limits = %d", code)
	}
	items := []map[string]any{}
	for k, v := range values {
		items = append(items, map[string]any{"key": k, "value": v})
	}
	var out apitypes.TeamLimitOverrides
	code, e := admin.call("PUT", "/v1/admin/teams/"+team+"/limits", map[string]any{"items": items}, &out, ifMatch(cur.Revision))
	mustCode(t, "set team limits", code, e, 200, "")
	return out
}

func teamLimit(t *testing.T, s *session, team, key string) apitypes.TeamLimit {
	t.Helper()
	var view apitypes.TeamLimits
	if code := s.get("/v1/teams/"+team+"/limits", &view); code != 200 {
		t.Fatalf("team limits = %d", code)
	}
	for _, it := range view.Items {
		if string(it.Key) == key {
			return it
		}
	}
	t.Fatalf("no limit %s", key)
	return apitypes.TeamLimit{}
}

func TestLimitsAdministration(t *testing.T) {
	app := newTestApp(t, nil)
	admin, auditor, user := app.signIn("admin"), app.signIn("auditor"), app.signIn("user")
	createTeam(t, admin, "registrar", "user@localhost")
	user.refresh()

	// Defaults and ceilings: admins and auditors read, only admins write.
	var p apitypes.PlatformLimits
	if code := auditor.get("/v1/admin/limits", &p); code != 200 || len(p.Items) != 24 || p.Revision != 1 {
		t.Fatalf("auditor get = %d %+v", code, p)
	}
	byKey := map[string]apitypes.PlatformLimit{}
	for _, it := range p.Items {
		byKey[string(it.Key)] = it
	}
	if d := byKey["storage_bytes"]; d.Default == nil || *d.Default != 10<<30 || d.Custom || d.Unit != "bytes" {
		t.Errorf("storage default = %+v", d)
	}
	if d := byKey["concurrent_ingest_jobs"]; d.Default == nil || *d.Default != 8 { // INGEST_MAX_INFLIGHT_PER_TEAM
		t.Errorf("ingest default = %+v", d)
	}
	code, _ := user.call("GET", "/v1/admin/limits", nil, nil, nil)
	if code != 403 {
		t.Errorf("member get platform limits = %d", code)
	}
	body := map[string]any{"items": []map[string]any{{"key": "data_sources", "default": 20, "ceiling": 50}}}
	code, e := auditor.call("PUT", "/v1/admin/limits", body, nil, ifMatch(1))
	mustCode(t, "auditor put", code, e, 403, "forbidden")
	code, e = admin.call("PUT", "/v1/admin/limits", body, nil, nil)
	mustCode(t, "put without If-Match", code, e, 428, "revision_required")
	code, e = admin.call("PUT", "/v1/admin/limits", map[string]any{"items": []map[string]any{{"key": "data_sources", "default": 60, "ceiling": 50}}}, nil, ifMatch(1))
	mustCode(t, "default above ceiling", code, e, 400, "invalid_limit")
	code, e = admin.call("PUT", "/v1/admin/limits", map[string]any{"items": []map[string]any{{"key": "bogus", "default": 1, "ceiling": nil}}}, nil, ifMatch(1))
	mustCode(t, "unknown key", code, e, 400, "unknown_limit")
	code, e = admin.call("PUT", "/v1/admin/limits", body, &p, ifMatch(1))
	mustCode(t, "put", code, e, 200, "")
	if p.Revision != 2 {
		t.Errorf("revision = %d", p.Revision)
	}
	code, e = admin.call("PUT", "/v1/admin/limits", body, nil, ifMatch(1))
	mustCode(t, "stale put", code, e, 412, "revision_conflict")
	if n := auditCount(t, app, "limits.platform_update"); n != 1 {
		t.Errorf("platform audits = %d", n)
	}

	// Team overrides.
	var o apitypes.TeamLimitOverrides
	if code := auditor.get("/v1/admin/teams/registrar/limits", &o); code != 200 || o.Revision != 1 {
		t.Fatalf("team overrides = %d %+v", code, o)
	}
	put := func(items []map[string]any, rev int64) (int, string) {
		return admin.call("PUT", "/v1/admin/teams/registrar/limits", map[string]any{"items": items}, &o, ifMatch(rev))
	}
	code, e = put([]map[string]any{{"key": "data_sources", "value": 51}}, 1)
	mustCode(t, "override above ceiling", code, e, 400, "above_ceiling")
	code, e = put([]map[string]any{{"key": "data_sources", "value": 40}, {"key": "knowledge_bases", "value": 0}}, 1)
	mustCode(t, "override", code, e, 200, "")
	if o.Revision != 2 {
		t.Errorf("override revision = %d", o.Revision)
	}
	code, e = put([]map[string]any{{"key": "data_sources", "value": 30}}, 1)
	mustCode(t, "stale override", code, e, 412, "revision_conflict")
	code, e = auditor.call("PUT", "/v1/admin/teams/registrar/limits", map[string]any{"items": []map[string]any{}}, nil, ifMatch(2))
	mustCode(t, "auditor override", code, e, 403, "forbidden")
	for _, it := range o.Items {
		switch it.Key {
		case "data_sources":
			if it.Override == nil || *it.Override != 40 || *it.Effective != 40 || *it.Default != 20 || *it.Ceiling != 50 {
				t.Errorf("data_sources = %+v", it)
			}
		case "knowledge_bases":
			if it.Override == nil || *it.Override != 0 || *it.Effective != 0 {
				t.Errorf("knowledge_bases = %+v", it)
			}
		case "documents":
			if it.Override != nil || *it.Effective != 50_000 {
				t.Errorf("documents = %+v", it)
			}
		}
	}
	// Lowering the ceiling caps the override; null removes it.
	code, e = admin.call("PUT", "/v1/admin/limits", map[string]any{"items": []map[string]any{{"key": "data_sources", "default": 20, "ceiling": 25}}}, nil, ifMatch(2))
	mustCode(t, "lower ceiling", code, e, 200, "")
	if it := teamLimit(t, user, "registrar", "data_sources"); it.Max == nil || *it.Max != 25 || !it.Overridden {
		t.Errorf("capped by ceiling = %+v", it)
	}
	code, e = put([]map[string]any{{"key": "data_sources", "value": nil}}, 2)
	mustCode(t, "inherit", code, e, 200, "")
	if it := teamLimit(t, user, "registrar", "data_sources"); it.Max == nil || *it.Max != 20 || it.Overridden {
		t.Errorf("inherited = %+v", it)
	}
	if n := auditCount(t, app, "limits.team_update"); n != 2 {
		t.Errorf("team audits = %d", n)
	}

	// Members see effective limits and usage; others don't see the team.
	if it := teamLimit(t, user, "registrar", "knowledge_bases"); it.Max == nil || *it.Max != 0 || it.Used == nil || *it.Used != 0 {
		t.Errorf("kb limit = %+v", it)
	}
	if it := teamLimit(t, user, "registrar", "public_queries_per_ip_per_minute"); it.Used != nil {
		t.Errorf("per-address rate usage = %+v", it)
	}
	outsider := app.signIn("alex")
	if code, _ := outsider.call("GET", "/v1/teams/registrar/limits", nil, nil, nil); code != 404 {
		t.Errorf("outsider = %d", code)
	}
	if code := auditor.get("/v1/teams/registrar/limits", &apitypes.TeamLimits{}); code != 200 {
		t.Errorf("auditor team usage = %d", code)
	}
}

func TestResourceCaps(t *testing.T) {
	env := newRAGEnv(t)
	owner, admin := env.owner, env.admin
	base := "/v1/teams/" + env.team
	setTeamLimits(t, admin, env.team, map[string]any{"data_sources": 1, "knowledge_bases": 1, "documents": 2})

	// Data sources.
	var src apitypes.DataSource
	code, e := owner.call("POST", base+"/sources", map[string]any{"name": "One", "classification": "open"}, &src, nil)
	mustCode(t, "first source", code, e, 201, "")
	code, raw := owner.raw("POST", base+"/sources", map[string]any{"name": "Two", "classification": "open"}, nil)
	le := decodeLimitError(t, raw)
	if code != 409 || le.Error.Code != "limit_reached" || le.Error.Details.Limit != "data_sources" || le.Error.Details.Max != 1 || le.Error.Details.Current != 1 ||
		!strings.Contains(le.Error.Message, "limit of 1 data sources") {
		t.Fatalf("second source = %d %s", code, raw)
	}

	// Knowledge bases.
	code, e = owner.call("POST", base+"/kbs", map[string]any{"name": "KB1"}, nil, nil)
	mustCode(t, "first kb", code, e, 201, "")
	code, raw = owner.raw("POST", base+"/kbs", map[string]any{"name": "KB2"}, nil)
	if le := decodeLimitError(t, raw); code != 409 || le.Error.Details.Limit != "knowledge_bases" {
		t.Fatalf("second kb = %d %s", code, raw)
	}

	// Documents: files past the limit are rejected; a request with nothing
	// accepted is a 409.
	docs := base + "/sources/" + src.Id.String() + "/documents"
	code, results, e := owner.uploadFiles(docs, []upload{{"a.md", []byte("# A\n\nalpha")}, {"b.md", []byte("# B\n\nbravo")}, {"c.md", []byte("# C\n\ncharlie")}}, "")
	if code != 200 || len(results) != 3 || results[0].Status != "created" || results[1].Status != "created" ||
		results[2].Status != "rejected" || results[2].Error.Code != "limit_reached" || results[2].Error.Details == nil || results[2].Error.Details.Limit != "documents" {
		t.Fatalf("upload past documents limit = %d %s %+v", code, e, results)
	}
	code, _, e = owner.uploadFiles(docs, []upload{{"d.md", []byte("# D\n\ndelta")}}, "")
	mustCode(t, "upload at the limit", code, e, 409, "limit_reached")
	// Replacing an existing document adds no document.
	code, results, e = owner.uploadFiles(docs, []upload{{"a.md", []byte("# A\n\nalpha, revised")}}, "")
	if code != 200 || results[0].Status != "replaced" {
		t.Fatalf("replace at the limit = %d %s %+v", code, e, results)
	}
	if it := teamLimit(t, owner, env.team, "documents"); it.Used == nil || *it.Used != 2 {
		t.Errorf("documents usage = %+v", it)
	}

	// Storage.
	setTeamLimits(t, admin, env.team, map[string]any{"documents": nil, "storage_bytes": 60})
	code, _, e = owner.uploadFiles(docs, []upload{{"big.md", []byte("# Big\n\n" + strings.Repeat("storage ", 20))}}, "")
	mustCode(t, "upload past storage", code, e, 409, "limit_reached")
	it := teamLimit(t, owner, env.team, "storage_bytes")
	if it.Used == nil || *it.Used == 0 || *it.Used > 60 {
		t.Errorf("storage usage = %+v", it)
	}

	// Shared sources count against no team: a platform default of 0
	// documents blocks team uploads but not shared ones.
	var p apitypes.PlatformLimits
	admin.get("/v1/admin/limits", &p)
	code, e = admin.call("PUT", "/v1/admin/limits", map[string]any{"items": []map[string]any{{"key": "documents", "default": 0, "ceiling": nil}}}, nil, ifMatch(p.Revision))
	mustCode(t, "block documents by default", code, e, 200, "")
	setTeamLimits(t, admin, env.team, map[string]any{"storage_bytes": nil})
	code, raw = uploadRaw(t, owner, docs, "e.md", []byte("# E\n\necho"))
	if le := decodeLimitError(t, raw); code != 409 || le.Error.Details.Max != 0 || !strings.Contains(le.Error.Message, "blocked") {
		t.Fatalf("blocked upload = %d %s", code, raw)
	}
	var shared apitypes.DataSource
	code, e = admin.call("POST", "/v1/admin/shared-sources", map[string]any{"name": "Shared", "classification": "open"}, &shared, nil)
	mustCode(t, "shared source", code, e, 201, "")
	code, results, e = admin.uploadFiles("/v1/admin/shared-sources/"+shared.Id.String()+"/documents", []upload{{"s.md", []byte("# S\n\nshared")}}, "")
	if code != 200 || results[0].Status != "created" {
		t.Fatalf("shared upload = %d %s %+v", code, e, results)
	}

	// Uploads and deletes are audited (team and shared).
	if n := auditCount(t, env.app, "document.upload"); n != 3 { // a+b, a replaced, shared s
		t.Errorf("document.upload audits = %d", n)
	}
	var page apitypes.DocumentPage
	owner.get(docs, &page)
	code, e = owner.call("DELETE", docs+"/"+page.Items[0].Id.String(), nil, nil, nil)
	mustCode(t, "delete document", code, e, 200, "")
	code, e = admin.call("DELETE", "/v1/admin/shared-sources/"+shared.Id.String()+"/documents/"+results[0].Document.Id.String(), nil, nil, nil)
	mustCode(t, "delete shared document", code, e, 200, "")
	if n := auditCount(t, env.app, "document.delete"); n != 2 {
		t.Errorf("document.delete audits = %d", n)
	}
	var target, team string
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT target_type, coalesce(team_id::text, '') FROM audit_log WHERE action = 'document.upload' ORDER BY id LIMIT 1`).Scan(&target, &team)
	if target != "data_source" || team == "" {
		t.Errorf("bulk upload audit = %s %s", target, team)
	}
}

// uploadRaw uploads one file and returns the raw response.
func uploadRaw(t *testing.T, s *session, path, name string, data []byte) (int, []byte) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	w, _ := mw.CreateFormFile("files", name)
	_, _ = w.Write(data)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", s.app.URL+path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Origin", s.app.URL)
	req.Header.Set("X-CSRF-Token", s.csrf)
	res, err := s.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, raw
}

// avoidMinuteBoundary waits out the end of a fixed one-minute window, so a
// per-minute sequence is not split across two windows.
func avoidMinuteBoundary() {
	if s := time.Now().Second(); s >= 50 {
		time.Sleep(time.Duration(61-s) * time.Second)
	}
}

func TestQueryLimits(t *testing.T) {
	env := newRAGEnv(t)
	owner, admin := env.owner, env.admin
	base := "/v1/teams/" + env.team
	member := env.app.signIn("alex")
	code, e := owner.call("POST", base+"/members", map[string]any{"email": "alex@localhost", "role": "member"}, nil, nil)
	mustCode(t, "add member", code, e, 201, "")
	member.refresh()
	var kb apitypes.KnowledgeBase
	code, e = owner.call("POST", base+"/kbs", map[string]any{"name": "Empty"}, &kb, nil)
	mustCode(t, "kb", code, e, 201, "")
	retrieve := base + "/kbs/" + kb.Id.String() + "/retrieve"
	query := map[string]any{"query": "office hours"}

	// Team per minute (Valkey).
	setTeamLimits(t, admin, env.team, map[string]any{"queries_per_minute": 2})
	avoidMinuteBoundary()
	for i := 0; i < 2; i++ {
		code, e := owner.call("POST", retrieve, query, nil, nil)
		mustCode(t, "query "+strconv.Itoa(i), code, e, 200, "")
	}
	code, raw, hdr := rawWithHeaders(t, owner, "POST", retrieve, query)
	le := decodeLimitError(t, raw)
	if code != 429 || le.Error.Code != "rate_limited" || le.Error.Details.Limit != "queries_per_minute" || hdr.Get("Retry-After") == "" {
		t.Fatalf("third query = %d %s (Retry-After %q)", code, raw, hdr.Get("Retry-After"))
	}
	if secs, _ := strconv.Atoi(hdr.Get("Retry-After")); secs < 1 || secs > 60 {
		t.Errorf("Retry-After = %s", hdr.Get("Retry-After"))
	}
	var queries int64
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM usage_events WHERE kind = 'query' AND kb_id = $1`, kb.Id).Scan(&queries)
	if queries != 2 {
		t.Errorf("query usage events = %d, want 2 (one per retrieve, none for refused ones)", queries)
	}

	// Per API key and per person.
	setTeamLimits(t, admin, env.team, map[string]any{"queries_per_minute": nil, "api_key_queries_per_minute": 1, "user_queries_per_minute": 1})
	var key apitypes.APIKeyCreated
	code, e = owner.call("POST", base+"/api-keys", map[string]any{"name": "k", "scopes": []string{"query"}}, &key, nil)
	mustCode(t, "api key", code, e, 201, "")
	avoidMinuteBoundary()
	code, e = keyCall(t, env.app.URL, "POST", retrieve, key.Secret, query, nil)
	mustCode(t, "key query", code, e, 200, "")
	code, e = keyCall(t, env.app.URL, "POST", retrieve, key.Secret, query, nil)
	mustCode(t, "key query 2", code, e, 429, "rate_limited")
	code, e = member.call("POST", retrieve, query, nil, nil)
	mustCode(t, "person query", code, e, 200, "") // the key's limit is separate
	code, raw, _ = rawWithHeaders(t, member, "POST", retrieve, query)
	if le := decodeLimitError(t, raw); code != 429 || le.Error.Details.Limit != "user_queries_per_minute" {
		t.Fatalf("person query 2 = %d %s", code, raw)
	}
	// Usage & limits shows this minute's count of the busiest key and person
	// (each counted its refused query too).
	for _, k := range []string{"api_key_queries_per_minute", "user_queries_per_minute"} {
		if it := teamLimit(t, owner, env.team, k); it.Used == nil || *it.Used != 2 {
			t.Errorf("%s used = %+v", k, it.Used)
		}
	}

	// Per day, from the usage ledger (4 queries so far today).
	setTeamLimits(t, admin, env.team, map[string]any{"api_key_queries_per_minute": nil, "user_queries_per_minute": nil, "queries_per_day": 5})
	code, e = owner.call("POST", retrieve, query, nil, nil)
	mustCode(t, "fifth query today", code, e, 200, "")
	code, raw, hdr = rawWithHeaders(t, owner, "POST", retrieve, query)
	le = decodeLimitError(t, raw)
	if code != 429 || le.Error.Details.Limit != "queries_per_day" || le.Error.Details.Current != 5 || !strings.Contains(le.Error.Message, "midnight UTC") {
		t.Fatalf("sixth query = %d %s", code, raw)
	}
	if secs, _ := strconv.Atoi(hdr.Get("Retry-After")); secs < 1 || secs > 86400 {
		t.Errorf("daily Retry-After = %s", hdr.Get("Retry-After"))
	}
	if it := teamLimit(t, owner, env.team, "queries_per_day"); it.Used == nil || *it.Used != 5 {
		t.Errorf("queries today = %+v", it)
	}
	// Blocked.
	setTeamLimits(t, admin, env.team, map[string]any{"queries_per_day": nil, "queries_per_minute": 0})
	code, raw, _ = rawWithHeaders(t, owner, "POST", retrieve, query)
	if le := decodeLimitError(t, raw); code != 429 || !strings.Contains(le.Error.Message, "blocked") {
		t.Fatalf("blocked query = %d %s", code, raw)
	}
}

// rawWithHeaders performs a session request and returns the headers too.
func rawWithHeaders(t *testing.T, s *session, method, path string, body any) (int, []byte, http.Header) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, s.app.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", s.app.URL)
	req.Header.Set("X-CSRF-Token", s.csrf)
	res, err := s.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, raw, res.Header
}

func TestCrawlLimits(t *testing.T) {
	env := newWebEnv(t, true)
	owner, admin, site := env.owner, env.admin, env.site
	sources := env.base + "/sources"

	// Concurrent crawls: with one slot, a second source's first crawl waits
	// (queued) until the first finishes, then runs.
	setTeamLimits(t, admin, env.team, map[string]any{"concurrent_crawls": 1})
	site.setDelay(150 * time.Millisecond)
	a := env.createWeb(t, owner, sources, "A", map[string]any{"mode": "batch", "urls": []string{site.url("/"), site.url("/about"), site.url("/new")}})
	b := env.createWeb(t, owner, sources, "B", map[string]any{"mode": "scrape", "urls": []string{site.url("/admissions/")}})
	if a.ActiveCrawl.WaitingReason != nil {
		t.Errorf("first crawl waits: %+v", a.ActiveCrawl)
	}
	if w := b.ActiveCrawl; w.Status != "queued" || w.WaitingReason == nil || *w.WaitingReason != "concurrent_crawls" {
		t.Fatalf("second crawl = %+v", w)
	}
	if it := teamLimit(t, owner, env.team, "concurrent_crawls"); it.Used == nil || *it.Used != 1 {
		t.Errorf("crawl slots used = %+v", it)
	}
	// A third source waits too, behind the second.
	c := env.createWeb(t, owner, sources, "C", map[string]any{"mode": "scrape", "urls": []string{site.url("/deep/1")}})
	if c.ActiveCrawl.WaitingReason == nil || *c.ActiveCrawl.WaitingReason != "concurrent_crawls" {
		t.Errorf("third crawl did not wait: %+v", c.ActiveCrawl)
	}
	first := waitCrawl(t, owner, sources+"/"+a.Id.String(), a.ActiveCrawl.Id)
	second := waitCrawl(t, owner, sources+"/"+b.Id.String(), b.ActiveCrawl.Id)
	third := waitCrawl(t, owner, sources+"/"+c.Id.String(), c.ActiveCrawl.Id)
	if first.Status != "completed" || second.Status != "completed" || second.WaitingReason != nil || second.StartedAt.Before(*first.FinishedAt) ||
		third.Status != "completed" || third.StartedAt.Before(*second.FinishedAt) {
		t.Fatalf("runs = %+v\n%+v\n%+v", first, second, third)
	}
	site.setDelay(0)
	// Blocked crawling refuses syncs.
	setTeamLimits(t, admin, env.team, map[string]any{"concurrent_crawls": 0})
	code, raw := owner.raw("POST", sources+"/"+a.Id.String()+"/sync", nil, nil)
	if le := decodeLimitError(t, raw); code != 409 || le.Error.Details.Limit != "concurrent_crawls" {
		t.Fatalf("blocked sync = %d %s", code, raw)
	}

	// Documents limit: a crawl that would store a new page past it stops
	// (truncated) and deletes no stale pages. The batch is fetched in URL
	// order: "/" (unchanged), "/about" (now gone), "/brand-new" (new).
	site.remove("/about")
	site.set("/brand-new", htmlPage("New", "<h1>New</h1><p>A brand new page.</p>"))
	aPath := sources + "/" + a.Id.String()
	setTeamLimits(t, admin, env.team, map[string]any{"concurrent_crawls": nil, "documents": *teamLimit(t, owner, env.team, "documents").Used})
	var cur apitypes.DataSource
	owner.get(aPath, &cur)
	code, e := owner.call("PATCH", aPath, map[string]any{"web": map[string]any{
		"mode": "batch", "urls": []string{site.url("/"), site.url("/about"), site.url("/brand-new")},
	}}, &cur, ifMatch(cur.Revision))
	mustCode(t, "change urls", code, e, 200, "")
	var run apitypes.Crawl
	code, e = owner.call("POST", aPath+"/sync", nil, &run, nil)
	mustCode(t, "sync at the documents limit", code, e, 202, "")
	run = waitCrawl(t, owner, aPath, run.Id)
	if run.Status != "completed" || !run.Truncated || run.TruncatedReason == nil || *run.TruncatedReason != "documents_limit" || run.DocumentsDeleted != 0 {
		t.Fatalf("run at the documents limit = %+v", run)
	}
	var docs apitypes.DocumentPage
	owner.get(aPath+"/documents", &docs)
	found := map[string]bool{}
	for _, d := range docs.Items {
		found[d.Url] = true
	}
	if found[site.url("/brand-new")] || !found[site.url("/about")] || !found[site.url("/new")] {
		t.Errorf("documents after the truncated run: %v", found)
	}

	// Daily crawled pages: the run fetches today's remaining pages, then
	// waits for the next UTC day (not failed).
	var crawledToday int64
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT coalesce(sum(quantity), 0) FROM usage_events WHERE kind = 'page_crawled'`).Scan(&crawledToday)
	if it := teamLimit(t, owner, env.team, "crawl_pages_per_day"); it.Used == nil || *it.Used != crawledToday || crawledToday < 8 {
		t.Fatalf("pages today = %+v (ledger %d)", it, crawledToday)
	}
	setTeamLimits(t, admin, env.team, map[string]any{"documents": nil, "crawl_pages_per_day": crawledToday + 2})
	d := env.createWeb(t, owner, sources, "Daily", map[string]any{"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 2, "useSitemaps": false})
	dPath := sources + "/" + d.Id.String()
	waiting := waitDailyLimited(t, owner, dPath)
	tomorrow := time.Now().UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	if waiting.Status != "running" || waiting.WaitingUntil == nil || !waiting.WaitingUntil.Equal(tomorrow) || waiting.PagesFetched != 2 {
		t.Fatalf("daily limit run = %+v", waiting)
	}
	if it := teamLimit(t, owner, env.team, "crawl_pages_per_day"); *it.Used != crawledToday+2 {
		t.Errorf("pages today after the limit = %d", *it.Used)
	}
	var srcNow apitypes.DataSource
	owner.get(dPath, &srcNow)
	if srcNow.ActiveCrawl == nil || srcNow.ActiveCrawl.WaitingReason == nil {
		t.Errorf("source active crawl = %+v", srcNow.ActiveCrawl)
	}
	// Raising the team's limit resumes the run now, not tomorrow (G4).
	setTeamLimits(t, admin, env.team, map[string]any{"crawl_pages_per_day": crawledToday + 1000})
	if done := waitCrawl(t, owner, dPath, waiting.Id); done.Status != "completed" || done.WaitingReason != nil || done.PagesFetched <= 2 {
		t.Fatalf("run after the team limit was raised = %+v", done)
	}
	dailyLimitRaisedByPlatform(t, env, crawledToday+1000)
}

// dailyLimitRaisedByPlatform: a run waiting for the platform default of
// crawled pages per day resumes when the default is raised.
func dailyLimitRaisedByPlatform(t *testing.T, env *webEnv, maxPages int64) {
	t.Helper()
	owner, admin, site := env.owner, env.admin, env.site
	setTeamLimits(t, admin, env.team, map[string]any{"crawl_pages_per_day": nil})
	used := *teamLimit(t, owner, env.team, "crawl_pages_per_day").Used
	setPlatformLimit(t, admin, "crawl_pages_per_day", used+1, maxPages)
	e := env.createWeb(t, owner, env.base+"/sources", "Daily platform", map[string]any{
		"mode": "batch", "urls": []string{site.url("/"), site.url("/about"), site.url("/new")},
	})
	ePath := env.base + "/sources/" + e.Id.String()
	waiting := waitDailyLimited(t, owner, ePath)
	if waiting.PagesFetched != 1 {
		t.Fatalf("platform daily limit run = %+v", waiting)
	}
	setPlatformLimit(t, admin, "crawl_pages_per_day", maxPages, maxPages)
	if done := waitCrawl(t, owner, ePath, waiting.Id); done.Status != "completed" || done.WaitingReason != nil || done.PagesFetched != 3 {
		t.Fatalf("run after the platform default was raised = %+v", done)
	}
}

// waitDailyLimited waits for a source's latest run to wait for the next
// day's page quota.
func waitDailyLimited(t *testing.T, s *session, sourcePath string) apitypes.Crawl {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		var list []apitypes.Crawl
		s.get(sourcePath+"/crawls", &list)
		if len(list) > 0 {
			c := list[0]
			if c.WaitingReason != nil && *c.WaitingReason == "daily_page_limit" {
				return c
			}
			if c.Status != "running" && c.Status != "queued" {
				t.Fatalf("run ended instead of waiting for the daily limit: %+v", c)
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("no run waiting for the daily limit: %+v", list)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// setPlatformLimit sets one platform default and ceiling.
func setPlatformLimit(t *testing.T, admin *session, key string, def, ceiling int64) {
	t.Helper()
	var p apitypes.PlatformLimits
	if code := admin.get("/v1/admin/limits", &p); code != 200 {
		t.Fatalf("get platform limits = %d", code)
	}
	body := map[string]any{"items": []map[string]any{{"key": key, "default": def, "ceiling": ceiling}}}
	code, e := admin.call("PUT", "/v1/admin/limits", body, nil, ifMatch(p.Revision))
	mustCode(t, "set platform limit "+key, code, e, 200, "")
}
