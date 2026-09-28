package httpapi_test

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// waitRun waits until the retention run id finished and returns it.
func waitRun(t *testing.T, admin *session, id int64) apitypes.RetentionRun {
	t.Helper()
	var run apitypes.RetentionRun
	eventually(t, "retention run", func() bool {
		var runs []apitypes.RetentionRun
		admin.get("/v1/admin/retention/runs", &runs)
		for _, r := range runs {
			if r.Id == id && (r.Status == "ok" || r.Status == "error") {
				run = r
				return true
			}
		}
		return false
	})
	return run
}

func runResult(run apitypes.RetentionRun, kind apitypes.RetentionKind) apitypes.RetentionRunResult {
	for _, r := range run.Results {
		if r.Kind == kind {
			return r
		}
	}
	return apitypes.RetentionRunResult{}
}

// TestRetentionAndLegalHolds (docs/phase5-deploy.md §5 P3): a conversation
// its user deletes disappears for them at once; a legal hold on the user
// keeps it through retention runs ("Run now" through the worker), and only
// platform admins and auditors see holds and retention; releasing the hold
// lets the next run delete it. Deleted documents' files wait for their
// own period. Everything is audited without a team.
func TestRetentionAndLegalHolds(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Student help", env.agentConfig(env.kb.Id.String()))
	code, evs, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Where do students buy a parking permit?"})
	mustCode(t, "chat", code, e, 200, "")
	var conv struct{ ConversationId *string }
	evs.one(t, "conversation", &conv)
	convPath := "/v1/conversations/" + *conv.ConversationId
	code, e = env.member.call("DELETE", convPath, nil, nil, nil)
	mustCode(t, "delete conversation", code, e, 200, "")
	if code := env.member.get(convPath, nil); code != 404 {
		t.Fatalf("deleted conversation = %d", code)
	}

	// Who sees retention and holds.
	var st apitypes.RetentionSettings
	if code := env.auditor.get("/v1/admin/retention", &st); code != 200 || len(st.Periods) != 7 || len(st.Levels) != 3 {
		t.Fatalf("auditor settings = %d %+v", code, st)
	}
	for _, s := range []*session{env.member, env.tadmin, env.owner} {
		if code := s.get("/v1/admin/legal-holds", nil); code != 403 {
			t.Fatalf("%s lists holds = %d", s.me.User.Email, code)
		}
	}
	code, e = env.auditor.call("POST", "/v1/admin/legal-holds", map[string]any{"scopeType": "user", "scope": "blair@localhost", "reason": "x"}, nil, nil)
	mustCode(t, "auditor places a hold", code, e, 403, "")
	code, e = env.auditor.call("PUT", "/v1/admin/retention", map[string]any{"periods": []any{}}, nil, ifMatch(st.Revision))
	mustCode(t, "auditor sets periods", code, e, 403, "")

	// A hold on the user, and a zero-day grace for deleted conversations.
	var hold apitypes.LegalHold
	code, e = env.admin.call("POST", "/v1/admin/legal-holds", map[string]any{
		"scopeType": "user", "scope": "blair@localhost", "reason": "Records request 2026-14", "coversFrom": "2026-01-01",
	}, &hold, nil)
	mustCode(t, "place hold", code, e, 201, "")
	if hold.Status != "active" || hold.Conversations != 1 || hold.DeletedConversations != 1 || hold.CoversFrom == nil || hold.CoversTo != nil {
		t.Fatalf("hold = %+v", hold)
	}
	code, e = env.admin.call("PUT", "/v1/admin/retention", map[string]any{"periods": []map[string]any{{"kind": "deleted_conversations", "mode": "days", "days": 0}}}, &st, ifMatch(st.Revision))
	mustCode(t, "set grace", code, e, 200, "")
	code, e = env.admin.call("PUT", "/v1/admin/retention", map[string]any{"periods": []map[string]any{{"kind": "usage_events", "mode": "days", "days": 1}}}, nil, ifMatch(st.Revision))
	mustCode(t, "too short", code, e, 400, "invalid_period")

	// A deleted document's files wait for the deleted-files period (keep).
	docsPath := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	doc := env.owner.waitForDocuments(t, docsPath)[0]
	code, e = env.owner.call("DELETE", docsPath+"/"+doc.Id.String(), nil, nil, nil)
	mustCode(t, "delete document", code, e, 200, "")

	var rep apitypes.RetentionReport
	if code := env.auditor.get("/v1/admin/retention/report", &rep); code != 200 {
		t.Fatalf("report = %d", code)
	}
	for _, k := range rep.Kinds {
		switch k.Kind {
		case "deleted_conversations":
			if k.Due != 0 || k.Held != 1 || len(k.Groups) != 1 || k.Groups[0].TeamName == "" || k.Groups[0].Level == nil {
				t.Fatalf("deleted conversations report = %+v", k)
			}
		case "deleted_files":
			if !k.Kept {
				t.Fatalf("deleted files report = %+v", k)
			}
		}
	}

	var run apitypes.RetentionRun
	code, e = env.admin.call("POST", "/v1/admin/retention/runs", map[string]any{}, &run, nil)
	mustCode(t, "run now", code, e, 202, "")
	run = waitRun(t, env.admin, run.Id)
	if r := runResult(run, "deleted_conversations"); run.Status != "ok" || r.Deleted != 0 || r.Held != 1 || run.RequestedBy == nil {
		t.Fatalf("held run = %+v", run)
	}
	if n := env.scalar(t, `SELECT count(*) FROM conversations WHERE id = $1`, *conv.ConversationId); n != 1 {
		t.Fatal("held conversation deleted")
	}
	if n := env.scalar(t, `SELECT count(*) FROM deleted_files WHERE document_id = $1`, doc.Id); n != 1 {
		t.Fatalf("deleted files records = %d", n)
	}

	// Released: the next run deletes it.
	code, e = env.admin.call("POST", "/v1/admin/legal-holds/"+hold.Id.String()+"/release", map[string]any{"reason": ""}, nil, nil)
	mustCode(t, "release without reason", code, e, 400, "invalid_reason")
	code, e = env.admin.call("POST", "/v1/admin/legal-holds/"+hold.Id.String()+"/release", map[string]any{"reason": "Request fulfilled"}, &hold, nil)
	mustCode(t, "release", code, e, 200, "")
	if hold.Status != "released" || hold.ReleasedBy == nil {
		t.Fatalf("released = %+v", hold)
	}
	code, e = env.admin.call("POST", "/v1/admin/retention/runs", map[string]any{"kinds": []string{"deleted_conversations"}}, &run, nil)
	mustCode(t, "run deleted conversations", code, e, 202, "")
	run = waitRun(t, env.admin, run.Id)
	if r := runResult(run, "deleted_conversations"); r.Deleted != 1 || len(run.Results) != 1 {
		t.Fatalf("after release = %+v", run)
	}
	var list []apitypes.LegalHold
	if code := env.auditor.get("/v1/admin/legal-holds?status=all", &list); code != 200 || len(list) != 1 {
		t.Fatalf("all holds = %d %d", code, len(list))
	}
	if code, e := env.auditor.call("GET", "/v1/admin/legal-holds?status=nope", nil, nil, nil); code != 400 {
		t.Fatalf("bad status = %d %s", code, e)
	}

	// Audited: holds and settings in the platform log only.
	var page apitypes.AuditPage
	if code := env.auditor.get("/v1/admin/audit?action=legal_hold.&limit=50", &page); code != 200 {
		t.Fatalf("audit = %d", code)
	}
	actions := []string{}
	for _, a := range page.Items {
		actions = append(actions, a.Action)
		if a.TeamId != nil || a.TargetLabel == nil || !strings.HasPrefix(*a.TargetLabel, "Legal hold on user") {
			t.Errorf("audit entry = %+v", a)
		}
	}
	if strings.Join(actions, ",") != "legal_hold.release,legal_hold.create" {
		t.Fatalf("hold actions = %v", actions)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action IN ('retention.settings_update', 'retention.run_request') AND team_id IS NULL`); n != 3 {
		t.Fatalf("retention audit = %d", n)
	}
}
