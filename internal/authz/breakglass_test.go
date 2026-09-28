package authz

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
)

var (
	bgAdmin  = Actor{UserID: uuid.MustParse("00000000-0000-0000-0000-00000000000a"), PlatformRole: PlatformAdmin}
	bgAdmin2 = Actor{UserID: uuid.MustParse("00000000-0000-0000-0000-00000000000b"), PlatformRole: PlatformAdmin}
	bgTeam   = uuid.MustParse("00000000-0000-0000-0000-000000000001")
	bgOther  = uuid.MustParse("00000000-0000-0000-0000-000000000002")
	bgStart  = time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
)

func activeSession(scopes ...string) BreakGlassSession {
	end := bgStart.Add(time.Hour)
	return BreakGlassSession{
		ID: uuid.New(), TeamID: bgTeam, RequestedBy: bgAdmin.UserID, Scopes: scopes, Status: BreakGlassActive,
		StartedAt: &bgStart, ExpiresAt: &end,
	}
}

func statusOf(err error) int {
	if e, ok := apperr.As(err); ok {
		return e.Status
	}
	return 0
}

// No session, no access: a zero grant and every non-active status deny.
func TestBreakGlassNoAccessWithoutSession(t *testing.T) {
	now := bgStart.Add(time.Minute)
	if (BreakGlassSession{}).Allows(bgAdmin, bgTeam, BreakGlassDocuments, now) {
		t.Fatal("empty session allowed a read")
	}
	for _, st := range []string{BreakGlassPending, BreakGlassEnded, BreakGlassExpired, BreakGlassDenied, BreakGlassCancelled, BreakGlassRequestExpired} {
		s := activeSession(BreakGlassDocuments, BreakGlassConversations)
		s.Status = st
		if s.Allows(bgAdmin, bgTeam, BreakGlassDocuments, now) {
			t.Errorf("status %s allowed a read", st)
		}
	}
}

// Access only within the session's team, scopes, admin and time.
func TestBreakGlassAllowsOnlyWithinScopeTeamAndTime(t *testing.T) {
	s := activeSession(BreakGlassDocuments)
	in := bgStart.Add(30 * time.Minute)
	if !s.Allows(bgAdmin, bgTeam, BreakGlassDocuments, in) {
		t.Fatal("granted read refused")
	}
	cases := []struct {
		name string
		a    Actor
		team uuid.UUID
		kind string
		at   time.Time
	}{
		{"other scope", bgAdmin, bgTeam, BreakGlassConversations, in},
		{"unknown scope", bgAdmin, bgTeam, "agents", in},
		{"other team", bgAdmin, bgOther, BreakGlassDocuments, in},
		{"no team", bgAdmin, uuid.Nil, BreakGlassDocuments, in},
		{"other admin", bgAdmin2, bgTeam, BreakGlassDocuments, in},
		{"demoted admin", Actor{UserID: bgAdmin.UserID, PlatformRole: PlatformNone}, bgTeam, BreakGlassDocuments, in},
		{"auditor", Actor{UserID: bgAdmin.UserID, PlatformRole: PlatformAuditor}, bgTeam, BreakGlassDocuments, in},
		{"api key", Actor{UserID: bgAdmin.UserID, PlatformRole: PlatformAdmin, Key: &KeyGrant{TeamID: bgTeam}}, bgTeam, BreakGlassDocuments, in},
		{"before start", bgAdmin, bgTeam, BreakGlassDocuments, bgStart.Add(-time.Second)},
		{"at expiry", bgAdmin, bgTeam, BreakGlassDocuments, bgStart.Add(time.Hour)},
		{"after expiry", bgAdmin, bgTeam, BreakGlassDocuments, bgStart.Add(2 * time.Hour)},
	}
	for _, c := range cases {
		if s.Allows(c.a, c.team, c.kind, c.at) {
			t.Errorf("%s: allowed", c.name)
		}
	}
	both := activeSession(BreakGlassConversations, BreakGlassDocuments)
	if !both.Allows(bgAdmin, bgTeam, BreakGlassConversations, in) || !both.Allows(bgAdmin, bgTeam, BreakGlassDocuments, in) {
		t.Error("both scopes should allow both kinds")
	}
}

func TestBreakGlassEffectiveStatusExpires(t *testing.T) {
	s := activeSession(BreakGlassDocuments)
	if got := s.EffectiveStatus(bgStart.Add(59 * time.Minute)); got != BreakGlassActive {
		t.Errorf("before end = %s", got)
	}
	if got := s.EffectiveStatus(bgStart.Add(time.Hour)); got != BreakGlassExpired {
		t.Errorf("at end = %s", got)
	}
	deadline := bgStart.Add(time.Hour)
	p := BreakGlassSession{ID: uuid.New(), Status: BreakGlassPending, RequestedBy: bgAdmin.UserID, ApprovalDeadline: &deadline}
	if got := p.EffectiveStatus(bgStart); got != BreakGlassPending {
		t.Errorf("pending = %s", got)
	}
	if got := p.EffectiveStatus(deadline); got != BreakGlassRequestExpired {
		t.Errorf("lapsed = %s", got)
	}
	// A lapsed request can't be approved any more.
	if err := CheckBreakGlassDecision(bgAdmin2, p, deadline.Add(time.Second)); statusOf(err) != http.StatusConflict {
		t.Errorf("approving a lapsed request = %v", err)
	}
}

// The second-admin rule: another platform admin decides; the requester
// can't approve their own request, and nobody but admins decides.
func TestBreakGlassSecondAdminApproval(t *testing.T) {
	deadline := bgStart.Add(time.Hour)
	p := BreakGlassSession{ID: uuid.New(), TeamID: bgTeam, Status: BreakGlassPending, RequestedBy: bgAdmin.UserID, ApprovalDeadline: &deadline}
	if err := CheckBreakGlassDecision(bgAdmin, p, bgStart); statusOf(err) != http.StatusForbidden {
		t.Errorf("self-approval = %v, want 403", err)
	}
	if err := CheckBreakGlassDecision(bgAdmin2, p, bgStart); err != nil {
		t.Errorf("second admin = %v", err)
	}
	for _, a := range []Actor{
		{UserID: bgAdmin2.UserID, PlatformRole: PlatformAuditor},
		{UserID: bgAdmin2.UserID, PlatformRole: PlatformNone},
		{UserID: bgAdmin2.UserID, PlatformRole: PlatformAdmin, Key: &KeyGrant{}},
	} {
		if err := CheckBreakGlassDecision(a, p, bgStart); statusOf(err) != http.StatusForbidden {
			t.Errorf("%+v deciding = %v, want 403", a, err)
		}
	}
	active := activeSession(BreakGlassDocuments)
	if err := CheckBreakGlassDecision(bgAdmin2, active, bgStart); statusOf(err) != http.StatusConflict {
		t.Errorf("approving an active session = %v", err)
	}
	if _, err := CheckBreakGlassDenyNote("  "); err == nil {
		t.Error("empty denial note accepted")
	}
	if note, err := CheckBreakGlassDenyNote(" Not needed "); err != nil || note != "Not needed" {
		t.Errorf("deny note = %q %v", note, err)
	}
}

func TestBreakGlassEndStatus(t *testing.T) {
	now := bgStart.Add(time.Minute)
	active := activeSession(BreakGlassDocuments)
	for _, a := range []Actor{bgAdmin, bgAdmin2} {
		if st, err := BreakGlassEndStatus(a, active, now); err != nil || st != BreakGlassEnded {
			t.Errorf("ending active by %v = %s %v", a.UserID, st, err)
		}
	}
	deadline := bgStart.Add(time.Hour)
	pending := BreakGlassSession{ID: uuid.New(), Status: BreakGlassPending, RequestedBy: bgAdmin.UserID, ApprovalDeadline: &deadline}
	if st, err := BreakGlassEndStatus(bgAdmin, pending, now); err != nil || st != BreakGlassCancelled {
		t.Errorf("withdrawing own request = %s %v", st, err)
	}
	if _, err := BreakGlassEndStatus(bgAdmin2, pending, now); statusOf(err) != http.StatusConflict {
		t.Errorf("withdrawing another's request = %v", err)
	}
	if _, err := BreakGlassEndStatus(bgAdmin, active, bgStart.Add(2*time.Hour)); statusOf(err) != http.StatusConflict {
		t.Errorf("ending an expired session = %v", err)
	}
	if _, err := BreakGlassEndStatus(Actor{UserID: bgAdmin.UserID, PlatformRole: PlatformAuditor}, active, now); statusOf(err) != http.StatusForbidden {
		t.Errorf("auditor ending = %v", err)
	}
}

func TestNormalizeBreakGlassRequest(t *testing.T) {
	p := DefaultBreakGlassPolicy
	reason := "Investigating a support request about wrong answers"
	r, err := NormalizeBreakGlassRequest(bgAdmin, BreakGlassRequest{TeamID: bgTeam, Reason: "  " + reason + " ", Scopes: []string{"documents", "conversations", "documents"}}, p)
	if err != nil {
		t.Fatal(err)
	}
	if r.Reason != reason || strings.Join(r.Scopes, ",") != "conversations,documents" || r.Duration != time.Hour {
		t.Errorf("normalized = %+v", r)
	}
	bad := []struct {
		name string
		a    Actor
		r    BreakGlassRequest
		code int
	}{
		{"auditor", Actor{UserID: bgAdmin.UserID, PlatformRole: PlatformAuditor}, BreakGlassRequest{TeamID: bgTeam, Reason: reason, Scopes: []string{"documents"}}, 403},
		{"api key", Actor{UserID: bgAdmin.UserID, PlatformRole: PlatformAdmin, Key: &KeyGrant{}}, BreakGlassRequest{TeamID: bgTeam, Reason: reason, Scopes: []string{"documents"}}, 403},
		{"short reason", bgAdmin, BreakGlassRequest{TeamID: bgTeam, Reason: "Because", Scopes: []string{"documents"}}, 400},
		{"no scope", bgAdmin, BreakGlassRequest{TeamID: bgTeam, Reason: reason}, 400},
		{"bad scope", bgAdmin, BreakGlassRequest{TeamID: bgTeam, Reason: reason, Scopes: []string{"agents"}}, 400},
		{"no team", bgAdmin, BreakGlassRequest{Reason: reason, Scopes: []string{"documents"}}, 400},
		{"too long", bgAdmin, BreakGlassRequest{TeamID: bgTeam, Reason: reason, Scopes: []string{"documents"}, Duration: 9 * time.Hour}, 400},
		{"too short", bgAdmin, BreakGlassRequest{TeamID: bgTeam, Reason: reason, Scopes: []string{"documents"}, Duration: time.Minute}, 400},
		{"seconds", bgAdmin, BreakGlassRequest{TeamID: bgTeam, Reason: reason, Scopes: []string{"documents"}, Duration: 10*time.Minute + time.Second}, 400},
	}
	for _, c := range bad {
		if _, err := NormalizeBreakGlassRequest(c.a, c.r, p); statusOf(err) != c.code {
			t.Errorf("%s: %v, want %d", c.name, err, c.code)
		}
	}
	// The default is capped by a shorter maximum.
	short := BreakGlassPolicy{MaxDuration: 30 * time.Minute, ApprovalTimeout: time.Hour}
	if r, err := NormalizeBreakGlassRequest(bgAdmin, BreakGlassRequest{TeamID: bgTeam, Reason: reason, Scopes: []string{"documents"}}, short); err != nil || r.Duration != 30*time.Minute {
		t.Errorf("capped default = %v %v", r.Duration, err)
	}
}

func TestBreakGlassPolicyValidate(t *testing.T) {
	if err := DefaultBreakGlassPolicy.Validate(); err != nil {
		t.Fatal(err)
	}
	if DefaultBreakGlassPolicy.ApprovalRequired {
		t.Error("approval must be off by default (phase5-deploy.md §9 decision 3)")
	}
	for _, p := range []BreakGlassPolicy{
		{MaxDuration: 10 * time.Minute, ApprovalTimeout: time.Hour},
		{MaxDuration: 25 * time.Hour, ApprovalTimeout: time.Hour},
		{MaxDuration: time.Hour, ApprovalTimeout: time.Minute},
		{MaxDuration: time.Hour, ApprovalTimeout: 8 * 24 * time.Hour},
		{MaxDuration: time.Hour + time.Second, ApprovalTimeout: time.Hour},
	} {
		if err := p.Validate(); err == nil {
			t.Errorf("%+v accepted", p)
		}
	}
}

func TestHumanDuration(t *testing.T) {
	for d, want := range map[time.Duration]string{
		time.Hour: "1 hour", 8 * time.Hour: "8 hours", 90 * time.Minute: "90 minutes", time.Minute: "1 minute", 48 * time.Hour: "2 days",
	} {
		if got := HumanDuration(d); got != want {
			t.Errorf("%v = %q, want %q", d, got, want)
		}
	}
}
