package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// The content health report over HTTP (docs/content-health.md): off until a platform admin turns it on; a request only queues;
// the worker collects; opening reads stored findings with the live names of their documents; only the team's editors, admins and
// owners, in the app, get any of it.

func setContentHealth(t *testing.T, admin *session, on bool) {
	t.Helper()
	var cur, out apitypes.ContentHealthSettings
	if code := admin.get("/v1/admin/settings/content-health", &cur); code != 200 {
		t.Fatalf("get content health settings = %d", code)
	}
	code, e := admin.call("PUT", "/v1/admin/settings/content-health", map[string]any{"enabled": on}, &out, ifMatch(cur.Revision))
	mustCode(t, "set content health", code, e, 200, "")
	if out.Enabled != on {
		t.Fatalf("content health settings = %+v", out)
	}
}

func waitReport(t *testing.T, s *session, path string) apitypes.ContentHealthReportDetail {
	t.Helper()
	deadline := time.Now().Add(testutil.Scale(60 * time.Second))
	for {
		var d apitypes.ContentHealthReportDetail
		if code := s.get(path, &d); code != 200 {
			t.Fatalf("get report = %d", code)
		}
		if st := d.Report.Status; st != "queued" && st != "running" {
			return d
		}
		if time.Now().After(deadline) {
			t.Fatalf("report did not finish: %+v", d.Report)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestContentHealthIsOffUntilTurnedOn(t *testing.T) {
	env := newAgentEnv(t)
	reports := env.base + "/content-health/reports"
	var st apitypes.ContentHealthSettings
	if code := env.auditor.get("/v1/admin/settings/content-health", &st); code != 200 || st.Enabled {
		t.Fatalf("a new install's switch = %d %+v, want off (an auditor can read it)", code, st)
	}
	if code, _ := env.auditor.call("PUT", "/v1/admin/settings/content-health", map[string]any{"enabled": true}, nil, ifMatch(st.Revision)); code != 403 {
		t.Errorf("an auditor turning it on = %d, want 403", code)
	}
	var list apitypes.ContentHealthReportList
	if code := env.editor.get(reports, &list); code != 200 || list.Enabled || len(list.Reports) != 0 {
		t.Fatalf("list while off = %d %+v, want 200, disabled and empty", code, list)
	}
	code, e := env.editor.call("POST", reports, map[string]any{}, nil, nil)
	mustCode(t, "make a report while off", code, e, 409, "content_health_off")
	// Nothing was queued.
	if n := env.scalar(t, `SELECT count(*) FROM content_health_reports`) + env.scalar(t, `SELECT count(*) FROM river_job WHERE kind LIKE 'content_health%' AND kind <> 'content_health.prune'`); n != 0 {
		t.Fatalf("%d reports or jobs after a refused request", n)
	}
}

func TestContentHealthReportEndToEnd(t *testing.T) {
	env := newAgentEnv(t)
	setContentHealth(t, env.admin, true)
	reports := env.base + "/content-health/reports"
	// The environment's three documents, aged so they are stale.
	if _, err := env.app.Pool.Exec(context.Background(), `UPDATE documents SET processed_at = now() - interval '3 years' WHERE source_id = $1`, env.upload.Id); err != nil {
		t.Fatal(err)
	}

	// Bad requests are refused before anything is queued.
	for name, body := range map[string]map[string]any{
		"stale days too low": {"staleDays": 5}, "window too long": {"citationWindowDays": 4000},
		"both scopes": {"sourceId": env.upload.Id, "knowledgeBaseId": env.kb.Id}, "unknown field": {"title": "x"},
	} {
		if code, _ := env.editor.call("POST", reports, body, nil, nil); code != 400 {
			t.Errorf("%s = %d, want 400", name, code)
		}
	}
	other := "00000000-0000-4000-8000-000000000000"
	code, e := env.editor.call("POST", reports, map[string]any{"sourceId": other}, nil, nil)
	mustCode(t, "a source that is not the team's", code, e, 404, "content_health_scope_not_found")

	var made apitypes.ContentHealthReport
	code, e = env.editor.call("POST", reports, map[string]any{"staleDays": 30, "sourceId": env.upload.Id}, &made, nil)
	mustCode(t, "make a report", code, e, 202, "")
	if made.Status != "queued" && made.Status != "running" && made.Status != "completed" || made.StaleDays != 30 || made.SourceId == nil {
		t.Fatalf("made = %+v", made)
	}
	code, e = env.owner.call("POST", reports, map[string]any{}, nil, nil)
	if code != 409 && code != 429 {
		t.Errorf("a second report right away = %d %s, want 409 or 429", code, e)
	}
	done := waitReport(t, env.editor, reports+"/"+made.Id.String())
	rep := done.Report
	if rep.Status != "completed" || rep.AsOf == nil || rep.ExpiresAt == nil || len(rep.Signals) != 5 || len(done.Sources) != 1 {
		t.Fatalf("report = %+v sources %+v", rep, done.Sources)
	}
	var stale apitypes.ContentHealthSignal
	for _, s := range rep.Signals {
		if s.Signal == "stale" {
			stale = s
		}
		if s.State == "measured" && s.Reason != "" {
			t.Errorf("a measured signal has a reason: %+v", s)
		}
	}
	if stale.State != "measured" || stale.Found != 3 || stale.Listed != 3 {
		t.Fatalf("stale = %+v, want the three aged documents", stale)
	}
	// Never-cited cannot be judged without answers: unavailable, not a list.
	for _, s := range rep.Signals {
		if s.Signal == "never_cited" && (s.State != "unavailable" || s.Found != 0) {
			t.Errorf("never cited with no answers = %+v, want unavailable", s)
		}
	}

	// Findings: paged, with live names, in the order the report found them.
	var page apitypes.ContentHealthFindingPage
	if code := env.editor.get(reports+"/"+made.Id.String()+"/findings?signal=stale&limit=1", &page); code != 200 || len(page.Items) != 1 || page.NextCursor == nil {
		t.Fatalf("first page = %d %+v", code, page)
	}
	first := page.Items[0]
	var next apitypes.ContentHealthFindingPage
	if code := env.editor.get(reports+"/"+made.Id.String()+"/findings?signal=stale&limit=1&cursor="+*page.NextCursor, &next); code != 200 || len(next.Items) != 1 || next.Items[0].Ord <= first.Ord {
		t.Fatalf("second page = %d %+v", code, next)
	}
	if first.DocumentId == nil || first.SourceName == "" || first.Value < 365*2 {
		t.Errorf("finding = %+v, want a document of the source, aged years", first)
	}
	for path, want := range map[string]int{
		"findings?signal=stale&limit=0": 400, "findings?signal=stale&limit=101": 400, "findings?signal=stale&cursor=zz": 400,
		"findings?signal=pii": 400, "findings": 400,
	} {
		if code := env.editor.get(reports+"/"+made.Id.String()+"/"+path, nil); code != want {
			t.Errorf("%s = %d, want %d", path, code, want)
		}
	}

	// The audit log has IDs and thresholds, never a title or a name.
	for _, action := range []string{"content_health.generate"} {
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = $1`, action); n != 1 {
			t.Errorf("%d audit entries for %s", n, action)
		}
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action LIKE 'content_health.%' AND (metadata::text ILIKE '%parking%' OR metadata::text ILIKE '%housing%')`); n != 0 {
		t.Error("an audit entry names a document")
	}

	// Cancelling an ended report is refused; deleting it works, and then it is gone.
	code, e = env.editor.call("POST", reports+"/"+made.Id.String()+"/cancel", nil, nil, nil)
	mustCode(t, "cancel an ended report", code, e, 409, "content_health_ended")
	if code, raw := env.editor.raw("DELETE", reports+"/"+made.Id.String(), nil, nil); code != http.StatusNoContent || len(raw) != 0 {
		t.Fatalf("delete = %d %s", code, raw)
	}
	if code := env.editor.get(reports+"/"+made.Id.String(), nil); code != 404 {
		t.Errorf("a deleted report = %d, want 404", code)
	}
	if n := env.scalar(t, `SELECT count(*) FROM content_health_findings`); n != 0 {
		t.Errorf("%d findings left after the report was deleted", n)
	}

	// Turning the feature off hides everything again.
	setContentHealth(t, env.admin, false)
	if code := env.editor.get(reports, &apitypes.ContentHealthReportList{}); code != 200 {
		t.Errorf("list while off = %d", code)
	}
}

// Everyone but the team's editors, admins and owners gets 404 on every report route, with a real report in the database: a
// member, every kind of API key, an auditor, a platform admin (with and without a break-glass session), and another team.
func TestContentHealthIsClosedToEveryoneElse(t *testing.T) {
	env := newAgentEnv(t)
	setContentHealth(t, env.admin, true)
	reports := env.base + "/content-health/reports"
	var made apitypes.ContentHealthReport
	code, e := env.owner.call("POST", reports, map[string]any{"staleDays": 30}, &made, nil)
	mustCode(t, "make a report", code, e, 202, "")
	waitReport(t, env.owner, reports+"/"+made.Id.String())
	one := reports + "/" + made.Id.String()
	routes := []struct{ method, path string }{
		{"GET", reports}, {"POST", reports}, {"GET", one}, {"GET", one + "/findings?signal=stale"}, {"POST", one + "/cancel"}, {"DELETE", one},
	}
	closed := func(who string, call func(method, path string) int) {
		for _, r := range routes {
			if code := call(r.method, r.path); code != 404 && code != 401 && code != 403 {
				t.Errorf("%s %s %s = %d, want it closed", who, r.method, r.path, code)
			}
		}
	}
	for who, s := range map[string]*session{"a member": env.member, "an auditor": env.auditor, "a platform admin": env.admin} {
		closed(who, func(method, path string) int {
			code, _ := s.raw(method, path, map[string]any{}, nil)
			return code
		})
	}
	bg := startBreakGlass(t, env.admin, env.team, "documents", "conversations")
	closed("a platform admin in a break-glass session", func(method, path string) int {
		code, _ := env.admin.raw(method, path, map[string]any{}, nil)
		return code
	})
	must(t, env.admin, "POST", "/v1/admin/break-glass/"+bg.Id.String()+"/end", nil, nil)
	for _, scopes := range [][]string{{"query"}, {"query", "ingest", "manage"}} {
		for _, kind := range []string{"personal", "service"} {
			key := createKey(t, env.owner, env.base, map[string]any{"name": kind + " " + strings.Join(scopes, "+"), "kind": kind, "scopes": scopes})
			closed(kind+" key "+strings.Join(scopes, "+"), func(method, path string) int {
				code, _ := keyCall(t, env.app.URL, method, path, key.Secret, map[string]any{}, nil)
				return code
			})
		}
	}
	// The report is still there for its team.
	if code := env.owner.get(one, nil); code != 200 {
		t.Errorf("the team's report after refused calls = %d", code)
	}
	var st apitypes.ContentHealthSettings
	if code := env.owner.get("/v1/admin/settings/content-health", &st); code != 403 && code != 404 {
		t.Errorf("a team owner reading the platform switch = %d", code)
	}
}
