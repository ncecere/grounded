package retention

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
)

func wantCode(t *testing.T, what string, err error, code string) {
	t.Helper()
	if e, ok := apperr.As(err); !ok || e.Code != code {
		t.Fatalf("%s: err = %v, want %s", what, err, code)
	}
}

// A hold on a user, team, agent or conversation (optionally a date range)
// keeps everything it covers from every rule, including conversations their
// users deleted; releasing it lets the next run delete them.
func TestHoldsStopDeletion(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE classification_levels SET conversation_retention_days = 1`)
	f.setPeriods(`{"deleted_conversations": 0, "access_log": 1, "analytics_events": 1, "usage_events": 7, "audit_log": 30}`)
	byConv := f.conversation(f.agent, f.version, f.other, 3*day)
	byUser := f.conversation(f.agent, f.version, f.user, 3*day)
	byAgent := f.conversation(f.open, f.openVersion, f.other, 3*day)
	inRange := f.conversation(f.agent, f.version, f.other, 100*day)
	free := f.conversation(f.agent, f.version, f.other, 3*day)
	// A conversation its user deleted: hidden at once, kept by the hold.
	deletedHeld := f.conversation(f.agent, f.version, f.user, time.Hour)
	f.exec(`UPDATE conversations SET deleted_at = now() - interval '1 minute' WHERE id = $1`, deletedHeld)
	deletedFree := f.conversation(f.agent, f.version, f.other, time.Hour)
	f.exec(`UPDATE conversations SET deleted_at = now() - interval '1 minute' WHERE id = $1`, deletedFree)
	f.exec(`INSERT INTO access_log (user_id, agent_id, rank, channel, at) VALUES ($1, $2, 1, 'ui', now() - interval '3 days'), ($3, $2, 1, 'ui', now() - interval '3 days')`, f.user, f.agent, f.other)
	f.exec(`INSERT INTO usage_events (kind, quantity, team_id, user_id, occurred_at) VALUES ('query', 1, $1, $2, now() - interval '9 days'), ('query', 1, $1, $3, now() - interval '9 days')`, f.team, f.user, f.other)
	f.exec(`INSERT INTO audit_log (actor_kind, actor_user_id, action, target_type, occurred_at) VALUES
		('user', $1, 'test.a', 'team', now() - interval '40 days'), ('user', $2, 'test.b', 'team', now() - interval '40 days')`, f.user, f.other)

	f.hold("conversation", byConv, nil, nil)
	f.hold("user", f.user, nil, nil)
	f.hold("agent", f.open, nil, nil)
	from, to := time.Now().Add(-101*day), time.Now().Add(-99*day)
	f.hold("team", f.team, &from, &to)

	res := f.apply(f.runner())
	for id, want := range map[uuid.UUID]bool{byConv: true, byUser: true, byAgent: true, inRange: true, free: false, deletedHeld: true, deletedFree: false} {
		if f.exists("conversations", id) != want {
			t.Errorf("conversation %v exists = %v, want %v", id, !want, want)
		}
	}
	if res[Conversations].Deleted != 1 || res[Conversations].Held != 4 || res[DeletedConversations].Deleted != 1 || res[DeletedConversations].Held != 1 {
		t.Fatalf("conversations = %+v %+v", res[Conversations], res[DeletedConversations])
	}
	if res[AccessLog].Deleted != 1 || res[AccessLog].Held != 1 || res[UsageEvents].Deleted != 1 || res[AuditLog].Held != 1 {
		t.Fatalf("logs = %+v", res)
	}
	// The user still doesn't see the deleted conversation.
	if f.count(`SELECT count(*) FROM conversations WHERE user_id = $1 AND deleted_at IS NULL AND id = $2`, f.user, deletedHeld) != 0 {
		t.Fatal("held conversation visible again")
	}

	// Admins see what each hold keeps.
	s := f.service()
	holds, err := s.Holds(f.ctx, f.admin, "active")
	if err != nil || len(holds) != 4 {
		t.Fatalf("holds = %d %v", len(holds), err)
	}
	var userHold Hold
	for _, h := range holds {
		if h.ScopeType == ScopeUser {
			userHold = h
		}
	}
	if userHold.Conversations != 2 || userHold.Deleted != 1 || userHold.ScopeLabel != "sam@example.edu" {
		t.Fatalf("user hold = %+v", userHold)
	}

	// Released: the next run deletes what it kept.
	if _, err := s.ReleaseHold(f.ctx, f.admin, userHold.ID, "Matter closed"); err != nil {
		t.Fatal(err)
	}
	res = f.apply(f.runner())
	if f.exists("conversations", byUser) || f.exists("conversations", deletedHeld) || res[AccessLog].Deleted != 1 {
		t.Fatalf("after release = %+v", res)
	}
}

// Placing and releasing holds: platform admins only (auditors read), a
// reason is required, the scope must exist, each is audited without a team
// (team admins never see holds), and a hold is released once.
func TestHoldAdministration(t *testing.T) {
	f := newFixture(t)
	s := f.service()
	auditor := authz.Actor{UserID: f.other, PlatformRole: authz.PlatformAuditor}
	member := authz.Actor{UserID: f.user}
	in := NewHold{ScopeType: ScopeTeam, Scope: "registrar", Reason: "Litigation hold, matter 14"}

	if _, err := s.PlaceHold(f.ctx, auditor, in); !errors.Is(err, errAdminOnly) {
		t.Fatalf("auditor placed a hold: %v", err)
	}
	if _, err := s.Holds(f.ctx, member, ""); !errors.Is(err, errReadOnly) {
		t.Fatalf("member listed holds: %v", err)
	}
	_, err := s.PlaceHold(f.ctx, f.admin, NewHold{ScopeType: ScopeTeam, Scope: "registrar"})
	wantCode(t, "no reason", err, "invalid_reason")
	_, err = s.PlaceHold(f.ctx, f.admin, NewHold{ScopeType: ScopeTeam, Scope: "nope", Reason: "x"})
	wantCode(t, "unknown team", err, "scope_not_found")
	_, err = s.PlaceHold(f.ctx, f.admin, NewHold{ScopeType: "kb", Scope: "x", Reason: "x"})
	wantCode(t, "bad type", err, "invalid_scope_type")
	a, b := time.Now(), time.Now().Add(-day)
	_, err = s.PlaceHold(f.ctx, f.admin, NewHold{ScopeType: ScopeTeam, Scope: "registrar", Reason: "x", CoversFrom: &a, CoversTo: &b})
	wantCode(t, "range", err, "invalid_range")

	h, err := s.PlaceHold(f.ctx, f.admin, in)
	if err != nil || h.ScopeID != f.team || h.ScopeLabel != "Registrar" || !h.Active() || h.CreatedBy.ID != f.admin.UserID {
		t.Fatalf("placed = %+v %v", h, err)
	}
	for _, sc := range []struct{ typ, scope string }{
		{ScopeUser, "SAM@example.edu"}, {ScopeAgent, "registrar/advisor"}, {ScopeAgent, f.open.String()},
	} {
		if _, err := s.PlaceHold(f.ctx, f.admin, NewHold{ScopeType: sc.typ, Scope: sc.scope, Reason: "x"}); err != nil {
			t.Fatalf("%s %s: %v", sc.typ, sc.scope, err)
		}
	}
	if got, err := s.Hold(f.ctx, auditor, h.ID); err != nil || got.ID != h.ID {
		t.Fatalf("auditor read = %v", err)
	}
	if _, err := s.ReleaseHold(f.ctx, f.admin, h.ID, ""); err == nil {
		t.Fatal("released without a reason")
	}
	rel, err := s.ReleaseHold(f.ctx, f.admin, h.ID, "Matter closed")
	if err != nil || rel.Active() || rel.ReleaseReason != "Matter closed" || rel.ReleasedBy.ID != f.admin.UserID {
		t.Fatalf("released = %+v %v", rel, err)
	}
	_, err = s.ReleaseHold(f.ctx, f.admin, h.ID, "again")
	wantCode(t, "twice", err, "legal_hold_released")
	_, err = s.ReleaseHold(f.ctx, f.admin, uuid.New(), "x")
	wantCode(t, "unknown", err, "legal_hold_not_found")
	if list, _ := s.Holds(f.ctx, f.admin, "released"); len(list) != 1 {
		t.Fatalf("released list = %d", len(list))
	}

	var withTeam, entries int64
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FILTER (WHERE team_id IS NOT NULL), count(*) FROM audit_log WHERE action LIKE 'legal_hold.%'`).Scan(&withTeam, &entries); err != nil {
		t.Fatal(err)
	}
	if entries != 5 || withTeam != 0 {
		t.Fatalf("audit entries = %d (with a team: %d)", entries, withTeam)
	}
}
