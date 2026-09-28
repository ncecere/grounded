package ssogroups

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Service administers the rules (platform admins change them; auditors read).
type Service struct {
	pool *pgxpool.Pool
	q    *dbgen.Queries
	// GroupsClaim is the OIDC claim read at sign-in (OIDC_GROUPS_CLAIM).
	GroupsClaim string
	// OIDCEnabled reports whether single sign-on is configured at all.
	OIDCEnabled bool
}

func New(pool *pgxpool.Pool, groupsClaim string, oidcEnabled bool) *Service {
	return &Service{pool: pool, q: dbgen.New(pool), GroupsClaim: groupsClaim, OIDCEnabled: oidcEnabled}
}

var (
	errAdminOnly    = apperr.Forbidden("Only platform admins can change group mapping rules")
	errReadOnly     = apperr.Forbidden("Only platform admins and auditors can see group mapping")
	errRuleNotFound = apperr.NotFound("rule_not_found", "Group mapping rule not found")
	errTeamNotFound = apperr.NotFound("team_not_found", "Team not found")
)

// RuleView is a rule with its team and the number of memberships it grants.
type RuleView = dbgen.ListSSORuleViewsRow

// RuleInput is a new rule, or a proposed one for the dry run.
type RuleInput struct {
	Group, Team, Role string
}

// RuleUpdate holds optional changes; a rule's team never changes.
type RuleUpdate struct {
	Group, Role *string
}

func validate(group, role string) (string, error) {
	group = strings.TrimSpace(group)
	if group == "" || len(group) > MaxGroupLength {
		return "", apperr.Invalid("invalid_group", "Group must be 1-256 characters")
	}
	if !teamRole(role) {
		return "", apperr.Invalid("invalid_role", "Role must be owner, admin, editor or member")
	}
	return group, nil
}

// resolveTeam finds a team by UUID or slug.
func resolveTeam(ctx context.Context, q *dbgen.Queries, ref string) (dbgen.Team, error) {
	var (
		t   dbgen.Team
		err error
	)
	if id, perr := uuid.Parse(ref); perr == nil {
		t, err = q.GetTeamByID(ctx, id)
	} else {
		t, err = q.GetTeamBySlug(ctx, strings.ToLower(strings.TrimSpace(ref)))
	}
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return t, errTeamNotFound
	}
	return t, err
}

// List returns the rules, optionally only one team's (slug or ID).
func (s *Service) List(ctx context.Context, a authz.Actor, team string) ([]RuleView, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	var teamID uuid.NullUUID
	if team != "" {
		t, err := resolveTeam(ctx, s.q, team)
		if err != nil {
			return nil, err
		}
		teamID = uuid.NullUUID{UUID: t.ID, Valid: true}
	}
	return s.q.ListSSORuleViews(ctx, teamID)
}

// Get returns one rule.
func (s *Service) Get(ctx context.Context, a authz.Actor, id uuid.UUID) (RuleView, error) {
	if !a.CanReadPlatform() {
		return RuleView{}, errReadOnly
	}
	return getView(ctx, s.q, id)
}

func getView(ctx context.Context, q *dbgen.Queries, id uuid.UUID) (RuleView, error) {
	v, err := q.GetSSORuleView(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return RuleView{}, errRuleNotFound
	}
	return RuleView(v), err
}

func ruleSnapshot(r dbgen.SsoGroupRule, team dbgen.Team) map[string]any {
	return map[string]any{"group": r.GroupName, "team": team.Slug, "role": r.Role}
}

// ruleName is the rule's name in the audit log (kept for deleted rules).
func ruleName(r dbgen.SsoGroupRule, team dbgen.Team) map[string]any {
	return map[string]any{"name": "Group " + r.GroupName + " → " + team.Name}
}

// Create adds a rule and applies it at once to the people whose last-seen
// groups include its group.
func (s *Service) Create(ctx context.Context, a authz.Actor, in RuleInput) (RuleView, error) {
	if !a.IsPlatformAdmin() {
		return RuleView{}, errAdminOnly
	}
	group, err := validate(in.Group, in.Role)
	if err != nil {
		return RuleView{}, err
	}
	var out RuleView
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		t, err := lockActiveTeam(ctx, q, in.Team)
		if err != nil {
			return err
		}
		r, err := q.InsertSSORule(ctx, dbgen.InsertSSORuleParams{
			GroupName: group, TeamID: t.ID, Role: in.Role, CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true},
		})
		if apperr.IsUniqueViolation(err, "sso_group_rules_team_group_key") {
			return apperr.Conflict("rule_exists", "This team already has a rule for that group. Change that rule instead.")
		} else if err != nil {
			return err
		}
		e := a.Audit("platform.sso_rule_create", "sso_group_rule", r.ID.String())
		e.TeamID, e.After, e.Metadata = t.ID, ruleSnapshot(r, t), ruleName(r, t)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		if err := reconcileTeam(ctx, q, t, []string{group}, nil, originOf(a)); err != nil {
			return err
		}
		out, err = getView(ctx, q, r.ID)
		return err
	})
	return out, err
}

// lockActiveTeam resolves and locks a team; rules are only added to
// active teams (archived teams are read-only).
func lockActiveTeam(ctx context.Context, q *dbgen.Queries, ref string) (dbgen.Team, error) {
	t, err := resolveTeam(ctx, q, ref)
	if err != nil {
		return t, err
	}
	if t, err = q.LockTeam(ctx, t.ID); err != nil {
		return t, err
	}
	if t.Status != "active" {
		return t, apperr.Conflict("team_archived", "This team is archived and read-only")
	}
	return t, nil
}

// lockRule locks a rule and its team (team first, as membership changes do).
func lockRule(ctx context.Context, q *dbgen.Queries, id uuid.UUID) (dbgen.SsoGroupRule, dbgen.Team, error) {
	v, err := getView(ctx, q, id)
	if err != nil {
		return dbgen.SsoGroupRule{}, dbgen.Team{}, err
	}
	t, err := q.LockTeam(ctx, v.SsoGroupRule.TeamID)
	if err != nil {
		return dbgen.SsoGroupRule{}, t, err
	}
	r, err := q.GetSSORuleForUpdate(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return r, t, errRuleNotFound
	}
	return r, t, err
}

// Update changes a rule's group or role and applies the change at once.
func (s *Service) Update(ctx context.Context, a authz.Actor, id uuid.UUID, in RuleUpdate, expectedRevision int64) (RuleView, error) {
	if !a.IsPlatformAdmin() {
		return RuleView{}, errAdminOnly
	}
	var out RuleView
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		r, t, err := lockRule(ctx, q, id)
		if err != nil {
			return err
		}
		if r.Revision != expectedRevision {
			return apperr.Stale()
		}
		group, role := r.GroupName, r.Role
		if in.Group != nil {
			group = *in.Group
		}
		if in.Role != nil {
			role = *in.Role
		}
		if group, err = validate(group, role); err != nil {
			return err
		}
		updated, err := q.UpdateSSORule(ctx, dbgen.UpdateSSORuleParams{ID: id, GroupName: group, Role: role})
		if apperr.IsUniqueViolation(err, "sso_group_rules_team_group_key") {
			return apperr.Conflict("rule_exists", "This team already has a rule for that group")
		} else if err != nil {
			return err
		}
		e := a.Audit("platform.sso_rule_update", "sso_group_rule", id.String())
		e.TeamID, e.Before, e.After, e.Metadata = t.ID, ruleSnapshot(r, t), ruleSnapshot(updated, t), ruleName(updated, t)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		users, err := q.ListSSORuleUserIDs(ctx, uuid.NullUUID{UUID: id, Valid: true})
		if err != nil {
			return err
		}
		if err := reconcileTeam(ctx, q, t, []string{r.GroupName, group}, users, originOf(a)); err != nil {
			return err
		}
		out, err = getView(ctx, q, id)
		return err
	})
	return out, err
}

// Delete removes a rule. The memberships it created are recomputed at once:
// removed, or kept with another matching rule's role.
func (s *Service) Delete(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if !a.IsPlatformAdmin() {
		return errAdminOnly
	}
	return store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		r, t, err := lockRule(ctx, q, id)
		if err != nil {
			return err
		}
		users, err := q.ListSSORuleUserIDs(ctx, uuid.NullUUID{UUID: id, Valid: true})
		if err != nil {
			return err
		}
		if err := q.DeleteSSORule(ctx, id); err != nil {
			return err
		}
		e := a.Audit("platform.sso_rule_delete", "sso_group_rule", id.String())
		e.TeamID, e.Before, e.Metadata = t.ID, ruleSnapshot(r, t), ruleName(r, t)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		return reconcileTeam(ctx, q, t, []string{r.GroupName}, users, originOf(a))
	})
}

func originOf(a authz.Actor) Origin {
	return Origin{Trigger: TriggerRuleChange, RequestID: a.RequestID, ClientIP: a.ClientIP}
}

// Status is what the admin page shows above the rules.
type Status struct {
	GroupsClaim string
	OIDCEnabled bool
	Stats       dbgen.SSOGroupStatsRow
	LastClaimAt *time.Time
	// Groups are the groups seen at sign-in (lower-cased), most people first.
	Groups []dbgen.ListSeenGroupsRow
}

// MaxSeenGroups bounds the groups listed in Status.
const MaxSeenGroups = 500

// Status reports the configured claim and what sign-ins have carried.
func (s *Service) Status(ctx context.Context, a authz.Actor) (Status, error) {
	if !a.CanReadPlatform() {
		return Status{}, errReadOnly
	}
	out := Status{GroupsClaim: s.GroupsClaim, OIDCEnabled: s.OIDCEnabled}
	var err error
	if out.Stats, err = s.q.SSOGroupStats(ctx); err != nil {
		return out, err
	}
	last, err := s.q.LastGroupsClaimAt(ctx)
	if err == nil {
		out.LastClaimAt = &last
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	out.Groups, err = s.q.ListSeenGroups(ctx, MaxSeenGroups)
	return out, err
}
