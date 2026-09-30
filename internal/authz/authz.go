// Package authz holds the authorization rules shared by every module: the
// acting principal, platform and team roles, and audience ordering.
//
// Rules live here as pure functions so they can be unit-tested exhaustively.
// Services call them inside the same transaction that performs the change,
// after locking the rows the decision depends on.
package authz

import (
	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
)

// Platform roles.
const (
	PlatformNone    = "none"
	PlatformAdmin   = "platform_admin"
	PlatformAuditor = "platform_auditor"
)

// Team roles, most to least privileged.
const (
	RoleOwner  = "owner"
	RoleAdmin  = "admin"
	RoleEditor = "editor"
	RoleMember = "member"
)

// Agent audiences, least to most permissive (ADR-0009).
const (
	AudienceTeam             = "team"
	AudienceAllAuthenticated = "all_authenticated"
	AudiencePublic           = "public"
)

// Actor is the principal performing an operation, plus request metadata for
// the audit log. For API-key requests Key is set: the key is bound to one
// team, its scopes stand in for a team role, and it never has a platform role.
type Actor struct {
	UserID       uuid.UUID // the session user, or the key's owner/contact (may be uuid.Nil)
	PlatformRole string
	RequestID    string
	ClientIP     string
	Key          *KeyGrant
}

// KeyGrant describes an authenticated API key.
type KeyGrant struct {
	ID     uuid.UUID
	TeamID uuid.UUID
	Scopes []string
	KBIDs  []uuid.UUID // empty = every KB of the team
	// AgentIDs restricts the key to these agents (DESIGN.md §3.3); empty =
	// every agent of the team.
	AgentIDs []uuid.UUID
	// Kind is "personal" (acts as its user) or "service" (belongs to the
	// team; stateless for chat).
	Kind string
}

// Personal reports whether the key is a personal key (acts as its user).
func (k *KeyGrant) Personal() bool { return k.Kind == "personal" }

// API key scopes (ADR-0012). ScopeMCP lets a key use the MCP server (POST
// /mcp, docs/mcp.md): searching and asking there, as the query scope does
// on the REST API; it grants nothing on the REST API itself.
const (
	ScopeQuery  = "query"
	ScopeIngest = "ingest"
	ScopeManage = "manage"
	ScopeMCP    = "mcp"
)

// HasScope reports whether the key has scope.
func (k *KeyGrant) HasScope(scope string) bool {
	for _, s := range k.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// AllowsKB reports whether the key may use a knowledge base.
func (k *KeyGrant) AllowsKB(id uuid.UUID) bool {
	if len(k.KBIDs) == 0 {
		return true
	}
	for _, kb := range k.KBIDs {
		if kb == id {
			return true
		}
	}
	return false
}

// AllowsAgent reports whether the key may use (or see) an agent.
func (k *KeyGrant) AllowsAgent(id uuid.UUID) bool {
	if len(k.AgentIDs) == 0 {
		return true
	}
	for _, a := range k.AgentIDs {
		if a == id {
			return true
		}
	}
	return false
}

// RoleForKey maps a key's scopes to the team role it acts with: manage acts
// as admin, ingest as editor, query as member.
func RoleForKey(k *KeyGrant) string {
	switch {
	case k.HasScope(ScopeManage):
		return RoleAdmin
	case k.HasScope(ScopeIngest):
		return RoleEditor
	default:
		return RoleMember
	}
}

// MaxScopesForRole caps the scopes a member may put on a personal key.
func MaxScopesForRole(role string) []string {
	switch {
	case RoleAtLeast(role, RoleAdmin):
		return []string{ScopeQuery, ScopeIngest, ScopeManage, ScopeMCP}
	case role == RoleEditor:
		return []string{ScopeQuery, ScopeIngest, ScopeMCP}
	case role == RoleMember:
		return []string{ScopeQuery, ScopeMCP}
	}
	return nil
}

func (a Actor) IsPlatformAdmin() bool { return a.PlatformRole == PlatformAdmin }

// CanReadPlatform reports whether the actor may read platform metadata
// (users, teams, audit). It never implies access to team content.
func (a Actor) CanReadPlatform() bool {
	return a.PlatformRole == PlatformAdmin || a.PlatformRole == PlatformAuditor
}

// Audit returns an audit entry pre-filled with the actor.
func (a Actor) Audit(action, targetType, targetID string) audit.Entry {
	e := audit.Entry{
		ActorKind: audit.ActorUser, ActorUserID: a.UserID,
		Action: action, TargetType: targetType, TargetID: targetID,
		RequestID: a.RequestID, ClientIP: a.ClientIP,
	}
	if a.Key != nil {
		e.ActorKind = audit.ActorAPIKey
		e.Metadata = map[string]any{"apiKeyId": a.Key.ID.String()}
	}
	return e
}

var roleRank = map[string]int{RoleMember: 1, RoleEditor: 2, RoleAdmin: 3, RoleOwner: 4}

// ValidTeamRole reports whether r is a team role.
func ValidTeamRole(r string) bool { return roleRank[r] > 0 }

// RoleAtLeast reports whether role grants at least min. "" (not a member)
// never does.
func RoleAtLeast(role, min string) bool { return roleRank[role] > 0 && roleRank[role] >= roleRank[min] }

// CheckMemberChange decides whether a team member with actorRole may change
// another member's role from `from` to `to`. Use from = "" to add a member and
// to = "" to remove one. Leaving a team yourself is handled separately.
//
//   - Owners and admins manage members.
//   - Admins cannot add, change or remove owners, or make anyone an owner.
func CheckMemberChange(actorRole, from, to string) error {
	if !RoleAtLeast(actorRole, RoleAdmin) {
		return apperr.Forbidden("Only team owners and admins can manage members")
	}
	if to != "" && !ValidTeamRole(to) {
		return apperr.Invalid("invalid_role", "Role must be owner, admin, editor or member")
	}
	if actorRole != RoleOwner && (from == RoleOwner || to == RoleOwner) {
		return apperr.Forbidden("Only team owners can add, change or remove owners")
	}
	return nil
}

var audienceRank = map[string]int{AudienceTeam: 0, AudienceAllAuthenticated: 1, AudiencePublic: 2}

// ValidAudience reports whether a is an agent audience.
func ValidAudience(a string) bool { _, ok := audienceRank[a]; return ok }

// AudienceAllowed reports whether audience a is no more permissive than max.
func AudienceAllowed(a, max string) bool {
	ra, okA := audienceRank[a]
	rm, okM := audienceRank[max]
	return okA && okM && ra <= rm
}

// Level is the subset of a classification level needed for ordering checks.
type Level struct {
	Key         string
	Rank        int32
	MaxAudience string
}

// CheckLevelOrdering verifies that a more sensitive level never allows a more
// permissive audience than a less sensitive one. levels must be sorted by rank.
func CheckLevelOrdering(levels []Level) error {
	for i := 1; i < len(levels); i++ {
		prev, cur := levels[i-1], levels[i]
		if !AudienceAllowed(cur.MaxAudience, prev.MaxAudience) {
			return apperr.Invalid("classification_order",
				"A more sensitive level ("+cur.Key+") cannot allow a wider audience than a less sensitive one ("+prev.Key+")")
		}
	}
	return nil
}
