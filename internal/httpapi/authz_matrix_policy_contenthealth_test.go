package httpapi_test

import (
	"context"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/testutil"
)

// Classification of the content health report (docs/content-health.md, ADR-0027): a team's editors, admins and owners, in the
// app, make and read a team's reports; members, API keys, platform staff (also under break-glass) and other teams get 404 and
// never see a name, URL or ID of the team. Platform admins turn the feature on; staff can read the switch and nothing else.
//
// The platform switch is on in the matrix, and each team has a completed report with findings that carry the team's names, so a
// leak would show. Making one is refused for the pause or the report in progress (429 content_health_wait, 409
// content_health_active), cancelling a report that ended is refused (409 content_health_ended); both passed authorization.

func init() {
	const reports = "/content-health/reports"
	report := func(c *mctx, suffix string) string { return c.team(reports + "/" + c.tf.healthReport + suffix) }
	for id, p := range map[string]policy{
		"listContentHealthReports": {own: editors, build: func(c *mctx) request { return get(c.team(reports)) }},
		"createContentHealthReport": {own: editors, also: []string{"429 content_health_wait", "409 content_health_active"}, build: func(c *mctx) request {
			return post(c.team(reports), map[string]any{"staleDays": 30})
		}},
		"getContentHealthReport": {own: editors, build: func(c *mctx) request { return get(report(c, "")) }},
		"listContentHealthFindings": {own: editors, build: func(c *mctx) request {
			return get(report(c, "/findings?signal=stale&limit=5"))
		}},
		"cancelContentHealthReport": {own: editors, also: []string{"409 content_health_ended"}, build: func(c *mctx) request {
			return post(report(c, "/cancel"), nil)
		}},
		"deleteContentHealthReport": {own: editors, build: func(c *mctx) request {
			return del(c.team(reports + "/" + c.pick(c.tf.healthReport, c.e.freshHealthReport) + ""))
		}},
	} {
		p.scope = scopeTeam
		register(id, p)
	}
	register("adminGetContentHealthSettings", adminRead("/v1/admin/settings/content-health"))
	register("adminPutContentHealthSettings", policy{scope: scopeGlobal, own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/settings/content-health"
		return put(p, map[string]any{"enabled": true}).h(c.rev(p))
	}})
}

// seedContentHealth makes a team's documents old and has its owner make a report, which the matrix's worker collects: its
// findings name the team's documents, so a response that leaks them is caught.
func (e *matrixEnv) seedContentHealth(t *testing.T, f *teamFix) string {
	t.Helper()
	if _, err := e.app.Pool.Exec(context.Background(), `UPDATE documents SET processed_at = now() - interval '3 years' WHERE team_id = (SELECT id FROM teams WHERE slug = $1)`, f.slug); err != nil {
		t.Fatalf("age documents: %v", err)
	}
	base := "/v1/teams/" + f.slug + "/content-health/reports"
	id := field(must(t, f.owner, "POST", base, map[string]any{"staleDays": 30}, nil), "id")
	deadline := time.Now().Add(testutil.Scale(60 * time.Second))
	for {
		got := must(t, f.owner, "GET", base+"/"+id, nil, nil)
		if status := field(got, "report.status"); status == "completed" {
			if field(got, "report.signals.0.found") == "0" {
				t.Fatalf("the seeded report found no stale document: %v", got)
			}
			return id
		} else if status == "failed" || status == "cancelled" || time.Now().After(deadline) {
			t.Fatalf("the seeded content health report is %s: %v", status, got)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// freshHealthReport is a new ended report of the team, for a call that deletes one.
func (e *matrixEnv) freshHealthReport(t *testing.T, f *teamFix) string {
	t.Helper()
	var id string
	if err := e.app.Pool.QueryRow(context.Background(), `INSERT INTO content_health_reports (team_id, stale_days, citation_window_days, status, as_of, finished_at, expires_at)
		SELECT id, 365, 90, 'completed', now(), now(), now() + interval '30 days' FROM teams WHERE slug = $1 RETURNING id`, f.slug).Scan(&id); err != nil {
		t.Fatalf("fresh content health report: %v", err)
	}
	return id
}
