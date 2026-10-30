package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// A request approved by a previous release's pod while this release's schema is in place (#195, #140). That pod does not know the column
// approved_classification, so the row keeps its default ”. Migration 00055 does not backfill, so the API must resolve the level the
// reviewer approved when it reads the request: from what the approval recorded in the audit log, with the changed level, not the one asked
// for. Approving with this release's code writes the column itself.
func TestTeamRequestApprovedLevelOfAnOldPodsApproval(t *testing.T) {
	e := newReqEnv(t)
	e.configure(t, true, 9, "")

	// The reviewer raises what was asked for (open) to sensitive.
	req := e.ask(t, e.user, "Old pod approval")
	r, rev := e.adminRequest(t, req.Id.String())
	var done apitypes.AdminTeamRequest
	code, c := e.admin.call("POST", "/v1/admin/team-requests/"+r.Id.String()+"/approve", map[string]any{"slug": "old-pod-approval", "maxClassification": "sensitive"}, &done, ifMatch(rev))
	mustCode(t, "approve with a changed level", code, c, 200, "")
	if n := e.app.count(t, `SELECT count(*) FROM team_requests WHERE id = $1::uuid AND approved_classification = 'sensitive'`, req.Id.String()); n != 1 {
		t.Fatalf("this release does not write the approved level itself (%d)", n)
	}

	// What a previous release's DecideTeamRequest leaves: the status and the team, but not the new column.
	if _, err := e.app.Pool.Exec(t.Context(), `UPDATE team_requests SET approved_classification = '' WHERE id = $1::uuid`, req.Id.String()); err != nil {
		t.Fatal(err)
	}
	// ... and the team's level has moved on since, which must not be what the requester is shown.
	if _, err := e.app.Pool.Exec(t.Context(), `UPDATE teams SET max_classification = 'restricted' WHERE slug = 'old-pod-approval'`); err != nil {
		t.Fatal(err)
	}

	got, _ := e.adminRequest(t, req.Id.String())
	if got.Status != "approved" || got.Classification != "open" || got.ApprovedClassification != "sensitive" {
		t.Errorf("the reviewer sees %+v, want asked open and approved sensitive", got)
	}
	var seen *apitypes.TeamRequest
	m := e.mine(t, e.user)
	for i := range m.Items {
		if m.Items[i].Id == req.Id {
			seen = &m.Items[i]
		}
	}
	if seen == nil || seen.Classification != "open" || seen.ApprovedClassification != "sensitive" {
		t.Errorf("the requester sees %+v, want asked open and approved sensitive", seen)
	}
	var queue []apitypes.AdminTeamRequest
	if code := e.admin.get("/v1/admin/team-requests?status=approved", &queue); code != 200 || len(queue) != 1 || queue[0].ApprovedClassification != "sensitive" {
		t.Errorf("the review queue = %d %+v", code, queue)
	}

	// A pending request shows no approved level, whatever the column holds.
	pending := e.ask(t, e.alex, "Still pending")
	if p, _ := e.adminRequest(t, pending.Id.String()); p.ApprovedClassification != "" {
		t.Errorf("a pending request shows approved level %q", p.ApprovedClassification)
	}
}
