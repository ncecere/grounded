package access

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestCallerAllows(t *testing.T) {
	p := Person([]string{"group:hr", "user:1"})
	cases := []struct {
		name   string
		caller Caller
		acl    []string
		want   bool
	}{
		{"unrestricted, anyone", Anyone(), nil, true},
		{"unrestricted, person", p, nil, true},
		{"restricted, anyone", Anyone(), []string{"group:hr"}, false},
		{"restricted to the person's group", p, []string{"group:finance", "group:hr"}, true},
		{"restricted to others", p, []string{"group:finance"}, false},
		{"restricted to nobody", p, []string{}, false},
		{"undecided caller, unrestricted", Caller{}, nil, false},
		{"undecided caller, restricted", Caller{}, []string{"group:hr"}, false},
	}
	for _, c := range cases {
		if got := c.caller.Allows(c.acl); got != c.want {
			t.Errorf("%s: Allows = %v, want %v", c.name, got, c.want)
		}
	}
	if Anyone().Principals() == nil || (Caller{}).Principals() == nil {
		t.Error("Principals must never be nil (an SQL array, never NULL)")
	}
	if (Caller{}).Set() || !Anyone().Set() || Anyone().IsPerson() || !p.IsPerson() {
		t.Error("Set and IsPerson")
	}
}

func TestPrincipalNormalisation(t *testing.T) {
	if got := Principal(KindGroup, "  HR Staff "); got != "group:hr staff" {
		t.Errorf("Principal = %q", got)
	}
	src := uuid.MustParse("11111111-2222-3333-4444-555555555555")
	if got := SourceGroup(src, "Team-A"); got != "source:11111111-2222-3333-4444-555555555555:team-a" {
		t.Errorf("SourceGroup = %q", got)
	}
}

func TestIdentityPrincipals(t *testing.T) {
	user := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	ext := "OID-123"
	cases := []struct {
		name       string
		id         dbgen.CallerIdentityRow
		matchClaim string
		want, not  []string
	}{
		{
			name: "verified email, groups, SCIM externalId and the match claim",
			id: dbgen.CallerIdentityRow{OIDCSubject: "sub-1", ScimExternalID: &ext, Email: "Ana@Example.edu",
				Claims: []byte(`{"email_verified": true, "oid": "OID-123", "tid": "t"}`), SsoGroups: []string{"staff"}, ScimGroups: []string{"HR", "grp-9"}},
			matchClaim: "oid",
			want: []string{"user:" + user.String(), "subject:sub-1", "subject:oid-123", "email:ana@example.edu", "group:staff", "group:hr",
				"group:grp-9"},
		},
		{
			name: "an unverified email is never a principal",
			id:   dbgen.CallerIdentityRow{OIDCSubject: "sub-2", Email: "b@example.edu", Claims: []byte(`{"email_verified": false}`)},
			want: []string{"user:" + user.String(), "subject:sub-2"}, not: []string{"email:b@example.edu"},
		},
		{
			name: "a string email_verified counts; a SCIM-pending subject does not",
			id:   dbgen.CallerIdentityRow{OIDCSubject: "scim-pending:7", Email: "c@example.edu", Claims: []byte(`{"email_verified": "true"}`)},
			want: []string{"email:c@example.edu"}, not: []string{"subject:scim-pending:7"},
		},
	}
	for _, c := range cases {
		got := identityPrincipals(user, c.id, c.matchClaim)
		for _, w := range c.want {
			if !slices.Contains(got, w) {
				t.Errorf("%s: %v lacks %s", c.name, got, w)
			}
		}
		for _, n := range c.not {
			if slices.Contains(got, n) {
				t.Errorf("%s: %v has %s", c.name, got, n)
			}
		}
	}
}
