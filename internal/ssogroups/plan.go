// Package ssogroups maps identity-provider groups to team roles (SSO group
// mapping, docs/v0.2.0.md §3.2 E1, docs/operations/sso-groups.md).
//
// A rule says "people in IdP group G are <role> of team T". At each OIDC
// sign-in the groups claim is read and the rules are applied to that person:
// a membership is added, or raised, for every rule they match; memberships
// the mapping created are lowered or removed when the person no longer
// matches. Memberships added by hand are never changed (owner decision 2).
// Saving or deleting a rule applies it at once to the people whose groups
// were last seen to match.
//
// Plan is the pure decision; Sync and the Service apply it, with an audit
// entry per change (the actor is the system; metadata names the rule).
package ssogroups

import (
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
)

// Kinds of change a plan contains.
const (
	KindAdd    = "add"    // a new membership with the rule's role
	KindRaise  = "raise"  // a mapping-created membership gets a higher role
	KindLower  = "lower"  // a mapping-created membership gets a lower role
	KindRemove = "remove" // a mapping-created membership no rule grants any more
	// KindRule: the same role, now granted by another rule (bookkeeping only).
	KindRule = "rule"
	// KindManual: a rule matches, but the person was added by hand, so the
	// membership is left as it is (even when the rule's role differs).
	KindManual = "manual"
	// KindLastOwner: the change would lower or remove the team's last
	// owner, so the membership is kept as it is.
	KindLastOwner = "last_owner"
)

// Changed reports whether a change of this kind alters a membership's role
// or existence (the others are reported by the dry run but change nothing
// a person can see).
func Changed(kind string) bool {
	return kind == KindAdd || kind == KindRaise || kind == KindLower || kind == KindRemove
}

// Rule is a mapping rule as the planner sees it.
type Rule struct {
	ID     uuid.UUID
	Group  string
	TeamID uuid.UUID
	Role   string
}

// Membership is a person's current membership of one team.
type Membership struct {
	Role string
	// SSO is true when the mapping created the membership.
	SSO    bool
	RuleID uuid.NullUUID
}

// Team is what the planner needs to know about a team.
type Team struct {
	Archived bool  // archived teams are read-only: no changes at all
	Owners   int64 // owners now, for the last-owner protection
}

// Change is one decision for one team.
type Change struct {
	Kind   string
	TeamID uuid.UUID
	From   string // the current role ("" when not a member)
	To     string // the new role ("" when removed; From when unchanged)
	// Rule grants To (add, raise, lower, rule, manual); nil for remove and last_owner.
	Rule *Rule
	// PrevRuleID is the rule that granted the membership before.
	PrevRuleID uuid.NullUUID
}

// Input is everything one person's plan depends on.
type Input struct {
	// Rules that may match, in precedence order for equal roles (oldest first).
	Rules []Rule
	// Groups are the person's groups, normalised with NormalizeGroups.
	Groups []string
	// Members are the person's memberships by team.
	Members map[uuid.UUID]Membership
	// Teams has an entry for every team in Rules and Members.
	Teams map[uuid.UUID]Team
	// Only, when valid, limits the plan to one team (a rule change).
	Only uuid.NullUUID
}

// NormalizeGroups lower-cases, trims and de-duplicates group names, dropping
// empty and over-long ones. Group matching ignores case.
func NormalizeGroups(groups []string) []string {
	out := make([]string, 0, len(groups))
	for _, g := range groups {
		g = strings.ToLower(strings.TrimSpace(g))
		if g == "" || len(g) > MaxGroupLength || slices.Contains(out, g) {
			continue
		}
		out = append(out, g)
		if len(out) == MaxGroups {
			break
		}
	}
	slices.Sort(out)
	return out
}

// Limits on what is kept from a groups claim.
const (
	MaxGroups      = 1000
	MaxGroupLength = 256
)

// ClaimGroups reads a groups claim: a list of strings, or a single string
// (one group). Other element types are ignored. present is false when the
// claim is missing.
func ClaimGroups(claims map[string]any, claim string) (groups []string, present bool) {
	v, ok := claims[claim]
	if !ok || v == nil {
		return nil, false
	}
	switch t := v.(type) {
	case string:
		return NormalizeGroups([]string{t}), true
	case []string:
		return NormalizeGroups(t), true
	case []any:
		var raw []string
		for _, e := range t {
			if s, ok := e.(string); ok {
				raw = append(raw, s)
			}
		}
		return NormalizeGroups(raw), true
	}
	return nil, true
}

// winners returns, per team, the matching rule with the highest role (the
// first in Rules among equals). Rules of archived teams are ignored.
func winners(in Input) map[uuid.UUID]*Rule {
	best := map[uuid.UUID]*Rule{}
	for i := range in.Rules {
		r := &in.Rules[i]
		if !slices.Contains(in.Groups, strings.ToLower(r.Group)) {
			continue
		}
		if cur, ok := best[r.TeamID]; !ok || !authz.RoleAtLeast(cur.Role, r.Role) {
			best[r.TeamID] = r
		}
	}
	return best
}

// Plan decides what the rules do to one person's memberships. Teams are
// visited in ID order, so plans are deterministic.
func Plan(in Input) []Change {
	best := winners(in)
	ids := make([]uuid.UUID, 0, len(best)+len(in.Members))
	for id := range best {
		ids = append(ids, id)
	}
	for id, m := range in.Members {
		if _, dup := best[id]; m.SSO && !dup {
			ids = append(ids, id)
		}
	}
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	var out []Change
	for _, id := range ids {
		if in.Only.Valid && id != in.Only.UUID {
			continue
		}
		if in.Teams[id].Archived {
			continue
		}
		m, member := in.Members[id]
		if c, ok := decide(id, m, member, best[id], in.Teams[id]); ok {
			out = append(out, c)
		}
	}
	return out
}

// decide is one team's decision; ok is false when there is nothing to report.
func decide(team uuid.UUID, m Membership, member bool, want *Rule, t Team) (Change, bool) {
	c := Change{TeamID: team, From: m.Role, To: m.Role, Rule: want, PrevRuleID: m.RuleID}
	lastOwner := m.Role == authz.RoleOwner && t.Owners <= 1
	switch {
	case !member && want != nil:
		c.Kind, c.To = KindAdd, want.Role
	case !member:
		return c, false
	case !m.SSO && want != nil:
		c.Kind = KindManual
	case !m.SSO:
		return c, false
	case want == nil && lastOwner:
		c.Kind, c.Rule = KindLastOwner, nil
	case want == nil:
		c.Kind, c.To = KindRemove, ""
	case want.Role == m.Role:
		if m.RuleID.Valid && m.RuleID.UUID == want.ID {
			return c, false
		}
		c.Kind = KindRule
	case authz.RoleAtLeast(want.Role, m.Role):
		c.Kind, c.To = KindRaise, want.Role
	case lastOwner:
		c.Kind, c.Rule = KindLastOwner, nil
	default:
		c.Kind, c.To = KindLower, want.Role
	}
	return c, true
}
