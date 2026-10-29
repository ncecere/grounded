package httpapi_test

import (
	"context"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// #146: an email or a date in the wrong format gets its own code through the
// real routes, not the generic invalid_json.
func TestFormatErrorsHaveTheirOwnCodes(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	createTeam(t, admin, "formats", "user@localhost")
	code, e := admin.call("POST", "/v1/admin/teams/formats/owners", map[string]any{"email": "not-an-email"}, nil, nil)
	mustCode(t, "malformed owner email", code, e, 400, "invalid_email")
	code, e = admin.call("POST", "/v1/admin/legal-holds", map[string]any{"scopeType": "team", "scope": "formats", "reason": "Litigation hold", "coversFrom": "notadate"}, nil, nil)
	mustCode(t, "malformed legal-hold date", code, e, 400, "invalid_date")
	code, e = admin.call("POST", "/v1/admin/teams/formats/owners", map[string]any{"email": 5}, nil, nil)
	mustCode(t, "wrong JSON kind stays invalid_json", code, e, 400, "invalid_json")
}

// #146: inviting an address that already has an open invite renews that
// invite (same id, new expiry and role) and says so in the audit log, instead
// of recording a second "Invited member". The invite email is sent again: it
// is the way to resend an invite.
func TestReinvitingRenewsTheOpenInvite(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	createTeam(t, admin, "renewals", "user@localhost")
	owner := app.signIn("user")
	ctx := context.Background()
	count := func(sql string) int64 {
		var n int64
		if err := app.Pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	for _, tc := range []struct {
		name, path string
		who        *session
		body       map[string]any
		email      string
		status     int
	}{
		{"member invite", "/v1/teams/renewals/members", owner, map[string]any{"email": "later@example.edu", "role": "member"}, "later@example.edu", 201},
		{"assign owner", "/v1/admin/teams/renewals/owners", admin, map[string]any{"email": "owner-later@example.edu"}, "owner-later@example.edu", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var first, second apitypes.MemberAddResult
			code, e := tc.who.call("POST", tc.path, tc.body, &first, nil)
			mustCode(t, "first invite", code, e, tc.status, "")
			if _, err := app.Pool.Exec(ctx, `UPDATE team_invites SET expires_at = now() + interval '1 day' WHERE id = $1`, first.Invite.Id); err != nil {
				t.Fatal(err)
			}
			creates, renews := count(`SELECT count(*) FROM audit_log WHERE action = 'team.invite_create'`), count(`SELECT count(*) FROM audit_log WHERE action = 'team.invite_renew'`)
			emails := count(`SELECT count(*) FROM notification_events WHERE type = 'team.invited'`)
			if tc.body["role"] != nil {
				tc.body["role"] = "editor"
			}
			code, e = tc.who.call("POST", tc.path, tc.body, &second, nil)
			mustCode(t, "second invite", code, e, tc.status, "")
			if second.Status != "invited" || second.Invite == nil || second.Invite.Id != first.Invite.Id || !second.Invite.ExpiresAt.After(time.Now().Add(29*24*time.Hour)) {
				t.Fatalf("renewed invite = %+v (first %+v)", second.Invite, first.Invite)
			}
			if got := count(`SELECT count(*) FROM audit_log WHERE action = 'team.invite_create'`); got != creates {
				t.Errorf("a renewal was audited as a new invite: %d -> %d", creates, got)
			}
			if got := count(`SELECT count(*) FROM audit_log WHERE action = 'team.invite_renew'`); got != renews+1 {
				t.Errorf("renewal audits = %d, want %d", got, renews+1)
			}
			var before, after map[string]any
			if err := app.Pool.QueryRow(ctx, `SELECT before_state, after_state FROM audit_log WHERE action = 'team.invite_renew' ORDER BY id DESC LIMIT 1`).Scan(&before, &after); err != nil {
				t.Fatal(err)
			}
			if before["email"] != tc.email || after["email"] != tc.email || before["expiresAt"] == after["expiresAt"] {
				t.Errorf("renewal audit before %v after %v", before, after)
			}
			if got := count(`SELECT count(*) FROM notification_events WHERE type = 'team.invited'`); got != emails+1 {
				t.Errorf("invite emails = %d, want %d (a renewal resends it)", got, emails+1)
			}
		})
	}
}
