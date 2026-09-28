package ssogroups

import (
	"context"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Triggers, recorded in each change's audit metadata.
const (
	TriggerSignIn     = "sign_in"
	TriggerRuleChange = "rule_change"
)

// Seen is a person's groups from one sign-in.
type Seen struct {
	Groups []string // normalised (NormalizeGroups)
	// ClaimPresent is false when the sign-in carried no groups claim; the
	// person is then treated as being in no group.
	ClaimPresent bool
}

// Origin is where a change came from, for its audit entries.
type Origin struct {
	Trigger   string
	RequestID string
	ClientIP  string
}

// Sync records the person's groups and applies the rules to their
// memberships. It runs inside the sign-in transaction, after invites are
// accepted (so an invite, which is a hand-made membership, wins). With no
// rule and no mapping-created membership it only records the groups.
func Sync(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, seen Seen, o Origin) error {
	groups := seen.Groups
	if groups == nil {
		groups = []string{}
	}
	if err := q.UpsertUserGroups(ctx, dbgen.UpsertUserGroupsParams{UserID: userID, Groups: groups, ClaimPresent: seen.ClaimPresent}); err != nil {
		return err
	}
	rows, err := q.ListSSORulesForGroups(ctx, groups)
	if err != nil {
		return err
	}
	mems, err := q.ListMembershipsForSSO(ctx, userID)
	if err != nil {
		return err
	}
	teamIDs := map[uuid.UUID]bool{}
	for _, r := range rows {
		teamIDs[r.SsoGroupRule.TeamID] = true
	}
	for _, m := range mems {
		if m.Sso {
			teamIDs[m.TeamID] = true
		}
	}
	if len(teamIDs) == 0 {
		return nil
	}
	// Lock the teams in a fixed order (as hand changes do, one team at a
	// time), then read the memberships again: a concurrent sign-in of the
	// same person may have changed them.
	teams, err := lockTeams(ctx, q, teamIDs)
	if err != nil {
		return err
	}
	if mems, err = q.ListMembershipsForSSO(ctx, userID); err != nil {
		return err
	}
	in := Input{Groups: groups, Members: map[uuid.UUID]Membership{}, Teams: teams}
	for _, r := range rows {
		in.Rules = append(in.Rules, ruleOf(r.SsoGroupRule))
	}
	for _, m := range mems {
		in.Members[m.TeamID] = Membership{Role: m.Role, SSO: m.Sso, RuleID: m.RuleID}
	}
	for _, c := range Plan(in) {
		if err := Apply(ctx, q, userID, c, o); err != nil {
			return err
		}
	}
	return nil
}

func ruleOf(r dbgen.SsoGroupRule) Rule {
	return Rule{ID: r.ID, Group: r.GroupName, TeamID: r.TeamID, Role: r.Role}
}

// lockTeams locks the teams in ID order and returns their state.
func lockTeams(ctx context.Context, q *dbgen.Queries, ids map[uuid.UUID]bool) (map[uuid.UUID]Team, error) {
	sorted := make([]uuid.UUID, 0, len(ids))
	for id := range ids {
		sorted = append(sorted, id)
	}
	slices.SortFunc(sorted, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	out := make(map[uuid.UUID]Team, len(sorted))
	for _, id := range sorted {
		t, err := q.LockTeam(ctx, id)
		if err != nil {
			return nil, err
		}
		owners, err := q.CountOwners(ctx, id)
		if err != nil {
			return nil, err
		}
		out[id] = Team{Archived: t.Status != "active", Owners: owners}
	}
	return out, nil
}

// Apply makes one planned change and audits it. The team must be locked.
func Apply(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, c Change, o Origin) error {
	e := audit.Entry{
		ActorKind: audit.ActorSystem, TeamID: c.TeamID, TargetType: "user", TargetID: userID.String(),
		RequestID: o.RequestID, ClientIP: o.ClientIP,
		Metadata: map[string]any{"via": "sso_group_rule", "trigger": o.Trigger},
	}
	if c.Rule != nil {
		e.Metadata["ruleId"], e.Metadata["group"] = c.Rule.ID.String(), c.Rule.Group
	} else if c.PrevRuleID.Valid {
		e.Metadata["ruleId"] = c.PrevRuleID.UUID.String()
	}
	var err error
	switch c.Kind {
	case KindAdd:
		err = add(ctx, q, userID, c)
		e.Action, e.After = "team.member_add", map[string]any{"role": c.To}
	case KindRaise, KindLower:
		err = changeRole(ctx, q, userID, c)
		e.Action = "team.member_role_change"
		e.Before, e.After = map[string]any{"role": c.From}, map[string]any{"role": c.To}
	case KindRule:
		return q.UpsertSSOMembership(ctx, dbgen.UpsertSSOMembershipParams{TeamID: c.TeamID, UserID: userID, RuleID: ruleID(c.Rule)})
	case KindRemove:
		var revoked int64
		revoked, err = remove(ctx, q, userID, c)
		e.Action, e.Before = "team.member_remove", map[string]any{"role": c.From}
		e.Metadata["personalKeysRevoked"] = revoked
	case KindLastOwner:
		e.Action, e.Before = "team.sso_last_owner_kept", map[string]any{"role": c.From}
	default: // KindManual: the hand-made membership is left alone
		return nil
	}
	if err != nil {
		return err
	}
	return audit.Record(ctx, q, e)
}

func ruleID(r *Rule) uuid.NullUUID {
	if r == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: r.ID, Valid: true}
}

func add(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, c Change) error {
	if _, err := q.InsertMember(ctx, dbgen.InsertMemberParams{TeamID: c.TeamID, UserID: userID, Role: c.To}); err != nil {
		return err
	}
	return q.UpsertSSOMembership(ctx, dbgen.UpsertSSOMembershipParams{TeamID: c.TeamID, UserID: userID, RuleID: ruleID(c.Rule)})
}

func changeRole(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, c Change) error {
	if _, err := q.UpdateMemberRole(ctx, dbgen.UpdateMemberRoleParams{TeamID: c.TeamID, UserID: userID, Role: c.To}); err != nil {
		return err
	}
	return q.UpsertSSOMembership(ctx, dbgen.UpsertSSOMembershipParams{TeamID: c.TeamID, UserID: userID, RuleID: ruleID(c.Rule)})
}

// remove deletes the membership (its marker goes with it) and, as a hand
// removal does, revokes the person's personal keys for the team (ADR-0012).
func remove(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, c Change) (int64, error) {
	if err := q.DeleteMember(ctx, dbgen.DeleteMemberParams{TeamID: c.TeamID, UserID: userID}); err != nil {
		return 0, err
	}
	return q.RevokePersonalKeys(ctx, dbgen.RevokePersonalKeysParams{TeamID: c.TeamID, UserID: uuid.NullUUID{UUID: userID, Valid: true}})
}

// teamRole reports whether role is a team role (for input validation).
func teamRole(role string) bool { return authz.ValidTeamRole(role) }
