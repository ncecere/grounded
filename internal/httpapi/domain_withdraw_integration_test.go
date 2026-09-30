package httpapi_test

import (
	"context"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Roadmap J4: the person who asked for a domain, or a team admin or owner,
// withdraws it while it is pending. The request is removed (platform admins
// no longer see it, and the team can ask again) and the withdrawal audited.
func TestWithdrawDomainRequest(t *testing.T) {
	env := newWebEnv(t, false)
	owner, admin := env.owner, env.admin
	env.app.signIn("alex")
	env.app.signIn("casey")
	env.app.signIn("blair")
	for email, role := range map[string]string{"alex@localhost": "editor", "casey@localhost": "editor", "blair@localhost": "member"} {
		code, e := owner.call("POST", env.base+"/members", map[string]string{"email": email, "role": role}, nil, nil)
		mustCode(t, "add "+email, code, e, 201, "")
	}
	alex, casey, blair := env.app.signIn("alex"), env.app.signIn("casey"), env.app.signIn("blair")
	ask := func(s *session, pattern string) apitypes.DomainRequest {
		t.Helper()
		var dr apitypes.DomainRequest
		code, e := s.call("POST", env.base+"/domain-requests", map[string]any{"pattern": pattern, "reason": "Our course pages live on this site."}, &dr, nil)
		mustCode(t, "request "+pattern, code, e, 201, "")
		return dr
	}
	withdraw := func(s *session, team, id string) (int, string) {
		return s.call("DELETE", "/v1/teams/"+team+"/domain-requests/"+id, nil, nil, nil)
	}

	dr := ask(alex, "docs.example.org")
	id := dr.Id.String()
	code, e := withdraw(casey, env.team, id)
	mustCode(t, "another editor withdraws", code, e, 403, "forbidden")
	code, e = withdraw(blair, env.team, id)
	mustCode(t, "a member withdraws", code, e, 403, "forbidden")
	code, e = withdraw(admin, env.team, id)
	mustCode(t, "a platform admin outside the team withdraws", code, e, 404, "team_not_found")
	createTeam(t, admin, "other", "blair@localhost")
	code, e = withdraw(blair, "other", id)
	mustCode(t, "another team's owner withdraws", code, e, 404, "request_not_found")

	var attention apitypes.AdminAttention
	if admin.get("/v1/admin/attention", &attention); attention.PendingDomainRequests != 1 {
		t.Fatalf("attention before = %+v", attention)
	}
	code, e = withdraw(alex, env.team, id)
	mustCode(t, "the requester withdraws", code, e, 200, "")
	code, e = withdraw(alex, env.team, id)
	mustCode(t, "withdraw twice", code, e, 404, "request_not_found")

	// Gone for platform admins, their notification dealt with, and audited.
	var all []apitypes.DomainRequest
	if admin.get("/v1/admin/domain-requests", &all); len(all) != 0 {
		t.Fatalf("admin list after withdrawal = %+v", all)
	}
	if admin.get("/v1/admin/attention", &attention); attention.PendingDomainRequests != 0 {
		t.Fatalf("attention after = %+v", attention)
	}
	var inbox apitypes.NotificationPage
	admin.get("/v1/notifications?type=web.domain_request_new", &inbox)
	if len(inbox.Items) != 1 || !inbox.Items[0].Read {
		t.Fatalf("admin notification after withdrawal = %+v", inbox.Items)
	}
	var before, actor string
	err := env.app.Pool.QueryRow(context.Background(), `SELECT before_state->>'pattern', actor_user_id::text FROM audit_log
		WHERE action = 'crawl.domain_withdraw' AND target_type = 'crawl_domain_request' AND target_id = $1`, id).Scan(&before, &actor)
	if err != nil || before != "docs.example.org" || actor != alex.me.User.Id.String() {
		t.Fatalf("audit = %q %q %v", before, actor, err)
	}

	// The team can ask again; the owner withdraws someone else's request.
	again := ask(alex, "docs.example.org")
	code, e = withdraw(owner, env.team, again.Id.String())
	mustCode(t, "the owner withdraws", code, e, 200, "")

	// Once reviewed, a request can't be withdrawn.
	denied := ask(alex, "wiki.example.org")
	code, e = admin.call("POST", "/v1/admin/domain-requests/"+denied.Id.String()+"/review", map[string]any{"decision": "deny"}, nil, nil)
	mustCode(t, "deny", code, e, 200, "")
	code, e = withdraw(alex, env.team, denied.Id.String())
	mustCode(t, "withdraw a denied request", code, e, 409, "request_not_pending")
	if n := auditCount(t, env.app, "crawl.domain_withdraw"); n != 2 {
		t.Errorf("crawl.domain_withdraw audits = %d", n)
	}
}
