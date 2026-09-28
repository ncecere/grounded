package ssogroups

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// reconcileTeam applies a team's rules (as they are after a rule change) to
// the people whose last-seen groups include one of groups, and to users
// (the people the changed rule had given a membership). The team must be
// locked. People who have never signed in with groups are only affected
// through users: with no groups seen, they match no rule.
func reconcileTeam(ctx context.Context, q *dbgen.Queries, t dbgen.Team, groups []string, users []uuid.UUID, o Origin) error {
	rows, err := q.ListSSORulesForTeam(ctx, t.ID)
	if err != nil {
		return err
	}
	rules := rulesOf(rows)
	cands, err := candidates(ctx, q, groups, users)
	if err != nil {
		return err
	}
	for _, c := range cands {
		owners, err := q.CountOwners(ctx, t.ID)
		if err != nil {
			return err
		}
		changes, err := planFor(ctx, q, t, rules, c.User.ID, c.Groups, owners)
		if err != nil {
			return err
		}
		for _, ch := range changes {
			if err := Apply(ctx, q, c.User.ID, ch, o); err != nil {
				return err
			}
		}
	}
	return nil
}

func rulesOf(rows []dbgen.SsoGroupRule) []Rule {
	out := make([]Rule, len(rows))
	for i, r := range rows {
		out[i] = ruleOf(r)
	}
	return out
}

func candidates(ctx context.Context, q *dbgen.Queries, groups []string, users []uuid.UUID) ([]dbgen.ListSSOCandidatesRow, error) {
	if users == nil {
		users = []uuid.UUID{}
	}
	return q.ListSSOCandidates(ctx, dbgen.ListSSOCandidatesParams{Groups: NormalizeGroups(groups), UserIds: users})
}

// planFor plans one person's membership of one team.
func planFor(ctx context.Context, q *dbgen.Queries, t dbgen.Team, rules []Rule, userID uuid.UUID, groups []string, owners int64) ([]Change, error) {
	mems, err := q.ListMembershipsForSSO(ctx, userID)
	if err != nil {
		return nil, err
	}
	in := Input{
		Rules: rules, Groups: groups, Members: map[uuid.UUID]Membership{},
		Teams: map[uuid.UUID]Team{t.ID: {Archived: t.Status != "active", Owners: owners}},
		Only:  uuid.NullUUID{UUID: t.ID, Valid: true},
	}
	for _, m := range mems {
		if m.TeamID == t.ID {
			in.Members[m.TeamID] = Membership{Role: m.Role, SSO: m.Sso, RuleID: m.RuleID}
		}
	}
	return Plan(in), nil
}

// PreviewInput is a proposed rule change for the dry run: a new rule
// (Group, Team, Role), an existing rule's new group and role (RuleID, Group,
// Role), or deleting a rule (RuleID, Delete).
type PreviewInput struct {
	RuleID            uuid.NullUUID
	Group, Team, Role string
	Delete            bool
}

// PreviewItem is what the change would do to one person.
type PreviewItem struct {
	User         dbgen.User
	GroupsSeenAt *time.Time
	Change       Change
}

// Preview is the dry run's result.
type Preview struct {
	Team  dbgen.Team
	Items []PreviewItem
}

// Preview reports who a rule change would add, raise, lower or remove,
// from the groups each person had at their last sign-in. It changes nothing.
func (s *Service) Preview(ctx context.Context, a authz.Actor, in PreviewInput) (Preview, error) {
	if !a.CanReadPlatform() {
		return Preview{}, errReadOnly
	}
	rules, team, groups, users, err := s.proposed(ctx, in)
	if err != nil {
		return Preview{}, err
	}
	cands, err := candidates(ctx, s.q, groups, users)
	if err != nil {
		return Preview{}, err
	}
	owners, err := s.q.CountOwners(ctx, team.ID)
	if err != nil {
		return Preview{}, err
	}
	out := Preview{Team: team, Items: []PreviewItem{}}
	for _, c := range cands {
		changes, err := planFor(ctx, s.q, team, rules, c.User.ID, c.Groups, owners)
		if err != nil {
			return Preview{}, err
		}
		for _, ch := range changes {
			if ch.Kind == KindRule {
				continue
			}
			owners += ownerDelta(ch)
			out.Items = append(out.Items, PreviewItem{User: c.User, GroupsSeenAt: c.GroupsSeenAt, Change: ch})
		}
	}
	return out, nil
}

// ownerDelta is how a change moves the team's owner count (the dry run
// applies the changes one person at a time, as saving does).
func ownerDelta(c Change) int64 {
	switch {
	case c.Kind == KindLastOwner:
		return 0
	case c.From == authz.RoleOwner && c.To != authz.RoleOwner:
		return -1
	case c.To == authz.RoleOwner && c.From != authz.RoleOwner:
		return 1
	}
	return 0
}

// proposed is the team's rule set after the proposed change, the groups
// whose people it may affect, and the people the existing rule manages.
func (s *Service) proposed(ctx context.Context, in PreviewInput) ([]Rule, dbgen.Team, []string, []uuid.UUID, error) {
	var (
		team     dbgen.Team
		existing *RuleView
		groups   []string
		users    []uuid.UUID
		err      error
	)
	if in.RuleID.Valid {
		v, err := getView(ctx, s.q, in.RuleID.UUID)
		if err != nil {
			return nil, team, nil, nil, err
		}
		existing, groups = &v, []string{v.SsoGroupRule.GroupName}
		if users, err = s.q.ListSSORuleUserIDs(ctx, in.RuleID); err != nil {
			return nil, team, nil, nil, err
		}
		team, err = s.q.GetTeamByID(ctx, v.SsoGroupRule.TeamID)
		if err != nil {
			return nil, team, nil, nil, err
		}
	} else if team, err = resolveTeam(ctx, s.q, in.Team); err != nil {
		return nil, team, nil, nil, err
	}
	group := in.Group
	if !in.Delete {
		if group, err = validate(in.Group, in.Role); err != nil {
			return nil, team, nil, nil, err
		}
		groups = append(groups, group)
	}
	rows, err := s.q.ListSSORulesForTeam(ctx, team.ID)
	if err != nil {
		return nil, team, nil, nil, err
	}
	var rules []Rule
	for _, r := range rulesOf(rows) {
		if existing != nil && r.ID == existing.SsoGroupRule.ID {
			if !in.Delete {
				r.Group, r.Role = group, in.Role
				rules = append(rules, r)
			}
			continue
		}
		rules = append(rules, r)
	}
	if existing == nil {
		rules = append(rules, Rule{Group: group, TeamID: team.ID, Role: in.Role})
	}
	return rules, team, groups, users, uniqueGroups(rules)
}

// uniqueGroups refuses a rule set with two rules for one group (as saving
// would, through the unique index).
func uniqueGroups(rules []Rule) error {
	seen := map[string]bool{}
	for _, r := range rules {
		k := strings.ToLower(r.Group)
		if seen[k] {
			return apperr.Conflict("rule_exists", "This team already has a rule for that group")
		}
		seen[k] = true
	}
	return nil
}
