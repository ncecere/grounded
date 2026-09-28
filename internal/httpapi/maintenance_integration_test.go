package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/internal/web"
)

// setMaintenance switches maintenance mode as the platform admin.
func setMaintenance(t *testing.T, admin *session, on bool, reason string) apitypes.MaintenanceSettings {
	t.Helper()
	var cur, out apitypes.MaintenanceSettings
	if code := admin.get("/v1/admin/settings/maintenance", &cur); code != 200 {
		t.Fatalf("get maintenance = %d", code)
	}
	code, e := admin.call("PUT", "/v1/admin/settings/maintenance", map[string]any{"enabled": on, "reason": reason}, &out, ifMatch(cur.Revision))
	mustCode(t, "set maintenance", code, e, 200, "")
	return out
}

// mustMaintenance checks a 503 maintenance_mode answer with the reason.
func mustMaintenance(t *testing.T, what string, code int, raw []byte, reason string) {
	t.Helper()
	var body struct {
		Error struct {
			Code, Message string
			Details       struct {
				Reason       string
				PlannedEndAt *time.Time
			}
		}
	}
	_ = json.Unmarshal(raw, &body)
	if code != 503 || body.Error.Code != "maintenance_mode" || body.Error.Details.Reason != reason || !strings.Contains(body.Error.Message, reason) {
		t.Fatalf("%s = %d %s", what, code, raw)
	}
}

// TestMaintenanceModePausesIngestionNotChat (docs/phase5-deploy.md §5 P5):
// while maintenance mode is on, everything that starts ingestion answers 503
// maintenance_mode with the reason, for team members, API keys and platform
// admins alike; chat (team, OpenAI-compatible and public), retrieval, reads
// and writes that start no work keep working. Only platform admins switch
// it, and every change is audited.
func TestMaintenanceModePausesIngestionNotChat(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	ag := env.publishAgent(t, "Student help", env.agentConfig(env.kb.Id.String()))
	site := env.createWeb(t, env.owner, env.base+"/sources", "Registrar site", map[string]any{"mode": "scrape", "urls": []string{env.site.url("/about")}})
	sitePath := env.base + "/sources/" + site.Id.String()
	waitCrawl(t, env.owner, sitePath, site.ActiveCrawl.Id)
	page := env.owner.waitForDocuments(t, sitePath+"/documents")[0]
	docsPath := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	docs := env.owner.waitForDocuments(t, docsPath)
	var ingestKey, queryKey apitypes.APIKeyCreated
	code, e := env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": "loader", "kind": "service", "scopes": []string{"ingest"}}, &ingestKey, nil)
	mustCode(t, "ingest key", code, e, 201, "")
	code, e = env.member.call("POST", env.base+"/api-keys", map[string]any{"name": "sdk", "scopes": []string{"query"}}, &queryKey, nil)
	mustCode(t, "query key", code, e, 201, "")

	// Only platform admins switch it; auditors read the admin view.
	var st apitypes.MaintenanceStatus
	if code := env.member.get("/v1/maintenance", &st); code != 200 || st.Enabled {
		t.Fatalf("status before = %d %+v", code, st)
	}
	var adminView apitypes.MaintenanceSettings
	if code := env.auditor.get("/v1/admin/settings/maintenance", &adminView); code != 200 {
		t.Fatalf("auditor read = %d", code)
	}
	code, e = env.auditor.call("PUT", "/v1/admin/settings/maintenance", map[string]any{"enabled": true, "reason": "x"}, nil, ifMatch(adminView.Revision))
	mustCode(t, "auditor switch", code, e, 403, "forbidden")
	code, e = env.owner.call("PUT", "/v1/admin/settings/maintenance", map[string]any{"enabled": true, "reason": "x"}, nil, ifMatch(adminView.Revision))
	mustCode(t, "team owner switch", code, e, 403, "forbidden")
	code, e = env.admin.call("PUT", "/v1/admin/settings/maintenance", map[string]any{"enabled": true}, nil, ifMatch(adminView.Revision))
	mustCode(t, "without a reason", code, e, 400, "invalid_reason")
	code, e = env.admin.call("PUT", "/v1/admin/settings/maintenance", map[string]any{"enabled": true, "reason": "x"}, nil, nil)
	mustCode(t, "without If-Match", code, e, 428, "")

	const reason = "Moving to a new embedding model"
	on := setMaintenance(t, env.admin, true, reason)
	if !on.Enabled || on.StartedBy == nil || on.StartedBy.Email != "admin@localhost" || on.StartedAt == nil {
		t.Fatalf("on = %+v", on)
	}
	if code := env.member.get("/v1/maintenance", &st); code != 200 || !st.Enabled || st.Reason != reason {
		t.Fatalf("status = %d %+v", code, st)
	}
	if n := auditCount(t, env.app, "platform.maintenance_start"); n != 1 {
		t.Fatalf("maintenance_start audited %d times", n)
	}

	// Paused: uploads (sessions and keys), syncs, re-fetches, retries, new
	// web sources and site maps, for team and shared sources.
	upload := []upload{{"late.md", []byte("# Late\n\nA late addition.")}}
	code, _, e = env.owner.uploadFiles(docsPath, upload, "")
	mustCode(t, "upload", code, e, 503, "maintenance_mode")
	code, _, e = env.owner.uploadFiles(docsPath, upload, ingestKey.Secret)
	mustCode(t, "upload with a key", code, e, 503, "maintenance_mode")
	raw503 := func(method, path string, body any) (int, []byte) { return env.owner.raw(method, path, body, nil) }
	code, raw := raw503("POST", sitePath+"/sync", nil)
	mustMaintenance(t, "sync", code, raw, reason)
	code, raw = raw503("POST", sitePath+"/documents/"+page.Id.String()+"/refetch", nil)
	mustMaintenance(t, "refetch", code, raw, reason)
	code, raw = raw503("POST", docsPath+"/"+docs[0].Id.String()+"/retry", nil)
	mustMaintenance(t, "retry", code, raw, reason)
	code, raw = raw503("POST", env.base+"/web/map", map[string]any{"url": env.site.url("/")})
	mustMaintenance(t, "map", code, raw, reason)
	code, raw = raw503("POST", env.base+"/sources", map[string]any{"name": "New site", "type": "web", "classification": "open",
		"web": map[string]any{"mode": "scrape", "urls": []string{env.site.url("/")}}})
	mustMaintenance(t, "create a web source", code, raw, reason)
	var shared apitypes.DataSource
	code, e = env.admin.call("POST", "/v1/admin/shared-sources", map[string]any{"name": "Catalog", "classification": "open"}, &shared, nil)
	mustCode(t, "create a shared upload source", code, e, 201, "")
	code, _, e = env.admin.uploadFiles("/v1/admin/shared-sources/"+shared.Id.String()+"/documents", upload, "")
	mustCode(t, "admin upload to a shared source", code, e, 503, "maintenance_mode")
	req, _ := http.NewRequest("POST", env.app.URL+sitePath+"/sync", nil)
	req.Header.Set("Origin", env.app.URL)
	req.Header.Set("X-CSRF-Token", env.owner.csrf)
	res, err := env.owner.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if ra := res.Header.Get("Retry-After"); res.StatusCode != 503 || ra != "300" {
		t.Errorf("sync = %d, Retry-After %q", res.StatusCode, ra)
	}

	// Working: writes that start no ingestion, reads, retrieval and chat.
	var kb2 apitypes.KnowledgeBase
	code, e = env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Second"}, &kb2, nil)
	mustCode(t, "create a KB", code, e, 201, "")
	code, e = env.owner.call("PUT", env.base+"/kbs/"+kb2.Id.String()+"/sources/"+env.upload.Id.String(), nil, nil, nil)
	mustCode(t, "attach a source", code, e, 200, "")
	if hits := env.retrieve(t, env.member, env.base, env.kb.Id, "parking permit"); len(hits) == 0 {
		t.Fatal("retrieval found nothing")
	}
	if code, evs, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Where do students buy a parking permit?"}); code != 200 || !strings.Contains(evs.text("text_delta"), "Parking") {
		t.Fatalf("team chat = %d %s", code, e)
	}
	if code, raw, _ := openaiCall(t, env.app.URL, queryKey.Secret, map[string]any{"model": "agent:" + env.team + "/" + ag.Slug,
		"messages": []map[string]string{{"role": "user", "content": "When do residence halls open?"}}}); code != 200 {
		t.Fatalf("OpenAI-compatible chat = %d %s", code, raw)
	}
	v := newVisitor(t, env.app.URL)
	if code, e := v.start(pub.Id, "", ""); code != 201 {
		t.Fatalf("public session = %d %s", code, e)
	}
	if code, _, e := v.ask(pub.Id, "Where do students buy a parking permit?"); code != 200 {
		t.Fatalf("public chat = %d %s", code, e)
	}

	// Off: ingestion works again.
	if off := setMaintenance(t, env.admin, false, ""); off.Enabled || off.Reason != "" || off.StartedBy != nil {
		t.Fatalf("off = %+v", off)
	}
	if code, results, e := env.owner.uploadFiles(docsPath, upload, ""); code != 200 || results[0].Status != "created" {
		t.Fatalf("upload after = %d %s %+v", code, e, results)
	}
	if n := auditCount(t, env.app, "platform.maintenance_end"); n != 1 {
		t.Fatalf("maintenance_end audited %d times", n)
	}
}

// TestMaintenanceModeParksAndResumesWork: a running crawl finishes its page
// and waits; queued and pending documents wait; the scheduler starts no
// crawl. When maintenance mode ends, all of it continues by itself.
func TestMaintenanceModeParksAndResumesWork(t *testing.T) {
	env := newWebEnv(t, true)
	ctx := context.Background()
	owner := env.owner

	// Two indexed documents, and a scheduled web source that synced.
	var up apitypes.DataSource
	code, e := owner.call("POST", env.base+"/sources", map[string]any{"name": "Uploads", "classification": "open"}, &up, nil)
	mustCode(t, "upload source", code, e, 201, "")
	docsPath := env.base + "/sources/" + up.Id.String() + "/documents"
	owner.uploadFiles(docsPath, []upload{{"a.md", []byte("# Alpha\n\nAlpha facts.")}, {"b.md", []byte("# Bravo\n\nBravo facts.")}}, "")
	docs := byName(owner.waitForDocuments(t, docsPath))
	sched := env.createWeb(t, owner, env.base+"/sources", "Scheduled", map[string]any{"mode": "scrape", "urls": []string{env.site.url("/about")}, "schedule": "daily"})
	schedPath := env.base + "/sources/" + sched.Id.String()
	waitCrawl(t, owner, schedPath, sched.ActiveCrawl.Id)

	// A slow crawl is running when maintenance starts.
	env.site.setDelay(400 * time.Millisecond)
	crawlSrc := env.createWeb(t, owner, env.base+"/sources", "Registrar", map[string]any{"mode": "crawl", "urls": []string{env.site.url("/")}, "maxDepth": 2})
	crawlPath := env.base + "/sources/" + crawlSrc.Id.String()
	crawlOf := func() apitypes.Crawl {
		var list []apitypes.Crawl
		owner.get(crawlPath+"/crawls", &list)
		return list[0]
	}
	eventually(t, "the crawl fetches a page", func() bool { return crawlOf().PagesFetched >= 1 })
	setMaintenance(t, env.admin, true, "Database upgrade")

	var parked apitypes.Crawl
	eventuallyFor(t, 45*time.Second, "the crawl parks", func() bool {
		parked = crawlOf()
		return parked.WaitingReason != nil && *parked.WaitingReason == apitypes.CrawlWaitingReasonMaintenance
	})
	if parked.Status != "running" {
		t.Fatalf("parked crawl = %+v", parked)
	}

	// Documents: one pending, one queued with its job (as if dispatched just
	// before maintenance started).
	if _, err := env.app.Pool.Exec(ctx, `UPDATE documents SET status = 'pending' WHERE id = $1`, docs["a.md"].Id); err != nil {
		t.Fatal(err)
	}
	if _, err := env.app.Pool.Exec(ctx, `UPDATE documents SET status = 'queued' WHERE id = $1`, docs["b.md"].Id); err != nil {
		t.Fatal(err)
	}
	inserter, err := jobs.NewInsertOnly(env.app.Pool, testutil.Logger())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inserter.Insert(ctx, ingest.ProcessArgs{DocumentID: docs["b.md"].Id}, nil); err != nil {
		t.Fatal(err)
	}
	status := func(id uuid.UUID) string {
		var s string
		if err := env.app.Pool.QueryRow(ctx, `SELECT status FROM documents WHERE id = $1`, id).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	eventually(t, "the queued document parks", func() bool { return status(docs["b.md"].Id) == "pending" })

	// The scheduler starts nothing, even for a due source.
	if _, err := env.app.Pool.Exec(ctx, `UPDATE data_sources SET next_sync_at = now() - interval '1 minute' WHERE id = $1`, sched.Id); err != nil {
		t.Fatal(err)
	}
	scheduler := &web.ScheduleWorker{S: env.app.Svc.Web}
	if err := scheduler.Work(ctx, nil); err != nil {
		t.Fatal(err)
	}
	countRuns := func() int {
		var list []apitypes.Crawl
		owner.get(schedPath+"/crawls", &list)
		return len(list)
	}
	if n := countRuns(); n != 1 {
		t.Fatalf("the scheduler started a crawl during maintenance: %d runs", n)
	}

	// Nothing moves for a dispatch period.
	time.Sleep(6 * time.Second)
	if a, b, c := status(docs["a.md"].Id), status(docs["b.md"].Id), crawlOf(); a != "pending" || b != "pending" || c.PagesFetched != parked.PagesFetched || c.Status != "running" {
		t.Fatalf("during maintenance: a=%s b=%s crawl=%+v (parked at %d pages)", a, b, c, parked.PagesFetched)
	}

	// Off: everything resumes by itself.
	setMaintenance(t, env.admin, false, "")
	env.site.setDelay(0)
	if done := waitCrawl(t, owner, crawlPath, parked.Id); done.Status != "completed" || done.WaitingReason != nil || done.PagesFetched <= parked.PagesFetched {
		t.Fatalf("resumed crawl = %+v", done)
	}
	eventuallyFor(t, 30*time.Second, "the documents are indexed again", func() bool {
		return status(docs["a.md"].Id) == "ready" && status(docs["b.md"].Id) == "ready"
	})
	if err := scheduler.Work(ctx, nil); err != nil {
		t.Fatal(err)
	}
	var runs []apitypes.Crawl
	owner.get(schedPath+"/crawls", &runs)
	if len(runs) != 2 || runs[0].Trigger != "schedule" {
		t.Fatalf("scheduled runs after maintenance = %+v", runs)
	}
	waitCrawl(t, owner, schedPath, runs[0].Id)
}

func eventuallyFor(t *testing.T, d time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(d)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(100 * time.Millisecond)
	}
}
