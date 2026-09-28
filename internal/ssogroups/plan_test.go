package ssogroups

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
)

var (
	teamA = uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	teamB = uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	rule1 = Rule{ID: uuid.MustParse("00000000-0000-0000-0000-000000000001"), Group: "Registrar-Staff", TeamID: teamA, Role: "editor"}
	rule2 = Rule{ID: uuid.MustParse("00000000-0000-0000-0000-000000000002"), Group: "registrar-admins", TeamID: teamA, Role: "admin"}
	rule3 = Rule{ID: uuid.MustParse("00000000-0000-0000-0000-000000000003"), Group: "library", TeamID: teamB, Role: "member"}
	rule4 = Rule{ID: uuid.MustParse("00000000-0000-0000-0000-000000000004"), Group: "registrar-helpers", TeamID: teamA, Role: "editor"}
)

func sso(role string, r Rule) Membership {
	return Membership{Role: role, SSO: true, RuleID: uuid.NullUUID{UUID: r.ID, Valid: true}}
}

func teams(ownersA int64) map[uuid.UUID]Team {
	return map[uuid.UUID]Team{teamA: {Owners: ownersA}, teamB: {Owners: 1}}
}

// summary is each change as "kind from->to rule-group".
func summary(cs []Change) []string {
	out := []string{}
	for _, c := range cs {
		g := ""
		if c.Rule != nil {
			g = " " + c.Rule.Group
		}
		out = append(out, c.Kind+" "+c.From+"->"+c.To+g)
	}
	return out
}

func TestPlan(t *testing.T) {
	all := []Rule{rule1, rule2, rule3, rule4}
	cases := []struct {
		name    string
		groups  []string
		members map[uuid.UUID]Membership
		owners  int64
		want    []string
	}{
		{"adds with the rule's role; matching ignores case", []string{"registrar-staff"}, nil, 1,
			[]string{"add ->editor Registrar-Staff"}},
		{"the highest role wins across rules for one team", []string{"registrar-staff", "registrar-admins", "library"}, nil, 1,
			[]string{"add ->admin registrar-admins", "add ->member library"}},
		{"raises a mapping-created membership", []string{"registrar-admins"},
			map[uuid.UUID]Membership{teamA: sso("editor", rule1)}, 1, []string{"raise editor->admin registrar-admins"}},
		{"lowers a mapping-created membership when the higher rule no longer matches", []string{"registrar-staff"},
			map[uuid.UUID]Membership{teamA: sso("admin", rule2)}, 1, []string{"lower admin->editor Registrar-Staff"}},
		{"removes a mapping-created membership no rule grants", nil,
			map[uuid.UUID]Membership{teamA: sso("editor", rule1)}, 1, []string{"remove editor->"}},
		{"removes one whose rule was deleted", []string{"registrar-staff"},
			map[uuid.UUID]Membership{teamB: {Role: "member", SSO: true}}, 1, []string{"add ->editor Registrar-Staff", "remove member->"}},
		{"never touches a hand-added member, even to raise", []string{"registrar-admins"},
			map[uuid.UUID]Membership{teamA: {Role: "member"}}, 1, []string{"manual member->member registrar-admins"}},
		{"never touches a hand-added member, even to lower", []string{"library"},
			map[uuid.UUID]Membership{teamB: {Role: "owner"}}, 1, []string{"manual owner->owner library"}},
		{"never removes a hand-added member", nil,
			map[uuid.UUID]Membership{teamA: {Role: "editor"}}, 1, nil},
		{"keeps the team's last owner instead of removing", nil,
			map[uuid.UUID]Membership{teamA: {Role: "owner", SSO: true}}, 1, []string{"last_owner owner->owner"}},
		{"keeps the team's last owner instead of lowering", []string{"registrar-staff"},
			map[uuid.UUID]Membership{teamA: {Role: "owner", SSO: true}}, 1, []string{"last_owner owner->owner"}},
		{"removes an owner when another owner remains", nil,
			map[uuid.UUID]Membership{teamA: {Role: "owner", SSO: true}}, 2, []string{"remove owner->"}},
		{"nothing to do when the same rule grants the same role", []string{"registrar-staff"},
			map[uuid.UUID]Membership{teamA: sso("editor", rule1)}, 1, nil},
		{"the same role from another rule only changes the rule", []string{"registrar-helpers"},
			map[uuid.UUID]Membership{teamA: sso("editor", rule1)}, 1, []string{"rule editor->editor registrar-helpers"}},
		{"equal roles: the first rule wins", []string{"registrar-helpers", "registrar-staff"}, nil, 1,
			[]string{"add ->editor Registrar-Staff"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			members := tc.members
			if members == nil {
				members = map[uuid.UUID]Membership{}
			}
			got := summary(Plan(Input{Rules: all, Groups: NormalizeGroups(tc.groups), Members: members, Teams: teams(tc.owners)}))
			want := tc.want
			if want == nil {
				want = []string{}
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %q, want %q", got, want)
			}
		})
	}
}

func TestPlanSkipsArchivedTeamsAndHonoursOnly(t *testing.T) {
	in := Input{Rules: []Rule{rule1, rule3}, Groups: []string{"library", "registrar-staff"}, Members: map[uuid.UUID]Membership{},
		Teams: map[uuid.UUID]Team{teamA: {Archived: true}, teamB: {Owners: 1}}}
	if got := summary(Plan(in)); !reflect.DeepEqual(got, []string{"add ->member library"}) {
		t.Fatalf("archived: %q", got)
	}
	in.Teams[teamA] = Team{Owners: 1}
	in.Only = uuid.NullUUID{UUID: teamA, Valid: true}
	if got := summary(Plan(in)); !reflect.DeepEqual(got, []string{"add ->editor Registrar-Staff"}) {
		t.Fatalf("only: %q", got)
	}
}

func TestClaimGroups(t *testing.T) {
	cases := []struct {
		name    string
		claims  map[string]any
		want    []string
		present bool
	}{
		{"missing", map[string]any{}, nil, false},
		{"null", map[string]any{"groups": nil}, nil, false},
		{"list", map[string]any{"groups": []any{"B", " a ", "b", 7, ""}}, []string{"a", "b"}, true},
		{"strings", map[string]any{"groups": []string{"x"}}, []string{"x"}, true},
		{"single string", map[string]any{"groups": "Staff"}, []string{"staff"}, true},
		{"empty list", map[string]any{"groups": []any{}}, []string{}, true},
		{"other type", map[string]any{"groups": 3}, nil, true},
	}
	for _, tc := range cases {
		got, present := ClaimGroups(tc.claims, "groups")
		if present != tc.present || len(got) != len(tc.want) || (len(got) > 0 && !reflect.DeepEqual(got, tc.want)) {
			t.Errorf("%s: got %q %v, want %q %v", tc.name, got, present, tc.want, tc.present)
		}
	}
	long := make([]byte, MaxGroupLength+1)
	for i := range long {
		long[i] = 'g'
	}
	if got := NormalizeGroups([]string{string(long), "ok"}); !reflect.DeepEqual(got, []string{"ok"}) {
		t.Errorf("over-long group kept: %q", got)
	}
}

func TestChangedAndOwnerDelta(t *testing.T) {
	for kind, want := range map[string]bool{KindAdd: true, KindRaise: true, KindLower: true, KindRemove: true, KindManual: false, KindLastOwner: false, KindRule: false} {
		if Changed(kind) != want {
			t.Errorf("Changed(%s) = %v", kind, !want)
		}
	}
	if ownerDelta(Change{Kind: KindRemove, From: "owner"}) != -1 || ownerDelta(Change{Kind: KindAdd, To: "owner"}) != 1 ||
		ownerDelta(Change{Kind: KindLastOwner, From: "owner", To: "owner"}) != 0 || ownerDelta(Change{Kind: KindRaise, From: "member", To: "admin"}) != 0 {
		t.Error("ownerDelta")
	}
}
