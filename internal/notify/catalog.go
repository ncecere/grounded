// Package notify records notifications and delivers them in the app and by
// email (docs/phase4-publishing.md §8, DESIGN.md §12).
//
// A change that should notify people calls Service.Emit inside its own
// transaction. Emit records the event, resolves the recipients (explicit
// people, addresses of people who have never signed in, and team members by
// role), applies each person's settings, writes the in-app items and queues
// one River job per email. Nothing is visible or sent unless the change
// commits; emails go out after commit, with retries.
//
// Usage, for example when an agent is published (the audiences change):
//
//	err := store.InTx(ctx, pool, func(q *dbgen.Queries, tx pgx.Tx) error {
//		// ... publish the agent ...
//		return s.Notify.Emit(ctx, tx, notify.AgentPublishedEvent(
//			notify.TeamRef{ID: team.ID, Slug: team.Slug, Name: team.Name},
//			agent.ID, agent.Name, audience, version).By(actor.UserID))
//	})
//
// A nil *Service is valid and records nothing, so services and tests that
// don't need notifications can leave it unset.
package notify

import "github.com/ncecere/grounded/internal/authz"

// Type identifies an event and its row in the user's settings.
type Type string

// Events (the table in docs/phase4-publishing.md §8).
const (
	TeamInvited           Type = "team.invited"
	InviteExpiring        Type = "team.invite_expiring"
	MembershipChanged     Type = "team.membership"
	DomainRequestDecided  Type = "web.domain_request"
	DomainRequestNew      Type = "web.domain_request_new"
	SyncFailed            Type = "web.sync_failed"
	ClassificationLowered Type = "source.classification_lowered"
	// DocumentsAttention: a platform admin asked a team's owners to look at
	// a source's failed or needs-OCR documents (docs/v0.2.0.md §7).
	DocumentsAttention Type = "source.documents_attention"
	AgentDisabled      Type = "agent.disabled_by_platform"
	AgentPublished     Type = "agent.published"
	DailyLimitReached  Type = "team.daily_limit"
	// Monthly budgets (docs/costs.md §4): the threshold and the budget used
	// up, once per team and month each; they can't be turned off.
	BudgetWarning   Type = "team.budget_warning"
	BudgetExhausted Type = "team.budget_exhausted"
	// Break-glass (ADR-0024): owners are told when a session starts and
	// what it read when it ends (mandatory, like invites); platform admins
	// are asked to approve, and the admin who asked hears the decision.
	BreakGlassStarted   Type = "breakglass.started"
	BreakGlassEnded     Type = "breakglass.ended"
	BreakGlassRequested Type = "breakglass.requested"
	BreakGlassDecided   Type = "breakglass.decided"
	// Profile migrations (docs/phase5-deploy.md §5 P2).
	ProfileMigration Type = "platform.profile_migration"
	KBProfileChanged Type = "kb.profile_changed"
	// EvaluationRegression: an automatic evaluation run scored worse
	// (docs/evaluations.md §4).
	EvaluationRegression Type = "evaluation.regression"
)

// Def describes an event type.
type Def struct {
	Type        Type
	Label       string // settings table row
	Description string // who receives it and when
	// Mandatory events are always delivered on every channel and can't be
	// turned off. Team-wide mandatory events also reach the person who
	// caused them.
	Mandatory bool
	// TeamRole, when set, sends the event to every active member of the
	// event's team with at least this role (in addition to explicit
	// recipients). The person who caused the event is left out unless the
	// event is mandatory.
	TeamRole string
	// PlatformAdmins: the event is for platform admins (explicit
	// recipients); other people don't see it in their settings.
	PlatformAdmins bool
}

var catalog = []Def{
	{Type: TeamInvited, Label: "Invited to a team", Description: "Someone invited you to join a team.", Mandatory: true},
	{Type: InviteExpiring, Label: "Invite about to expire", Description: "A team invite you haven't accepted expires in 3 days."},
	{Type: MembershipChanged, Label: "Added to a team or role changed", Description: "You were added to a team, or your role in a team changed."},
	{Type: DomainRequestDecided, Label: "Domain request decided", Description: "A platform admin approved, denied or revoked your crawl domain request."},
	{Type: DomainRequestNew, Label: "New domain request", Description: "A team asked to crawl a domain that isn't on the allowlist (platform admins).", PlatformAdmins: true},
	{Type: SyncFailed, Label: "Web source sync failed", Description: "A web source sync failed in a team where you're an editor, admin or owner.", TeamRole: authz.RoleEditor},
	{Type: ClassificationLowered, Label: "Source classification lowered", Description: "A data source's classification was lowered in a team you own.", Mandatory: true, TeamRole: authz.RoleOwner},
	{Type: DocumentsAttention, Label: "Documents need attention", Description: "A platform admin asked you to look at documents that failed or need OCR in a data source of a team you own.", Mandatory: true, TeamRole: authz.RoleOwner},
	{Type: AgentDisabled, Label: "Agent disabled by platform", Description: "A platform admin disabled an agent in a team where you're an admin or owner.", Mandatory: true, TeamRole: authz.RoleAdmin},
	{Type: AgentPublished, Label: "Agent published beyond the team", Description: "An agent in a team you own was published to all signed-in users or the public.", TeamRole: authz.RoleOwner},
	{Type: DailyLimitReached, Label: "Team daily limit reached", Description: "A team where you're an admin or owner reached a daily limit.", TeamRole: authz.RoleAdmin},
	{Type: BudgetWarning, Label: "Team budget nearly used", Description: "A team where you're an admin or owner reached the warning threshold of its monthly budget.", Mandatory: true, TeamRole: authz.RoleAdmin},
	{Type: BudgetExhausted, Label: "Team budget used up", Description: "A team where you're an admin or owner used up its monthly budget, so its chats, searches and ingestion stop.", Mandatory: true, TeamRole: authz.RoleAdmin},
	{Type: BreakGlassStarted, Label: "Break-glass access started", Description: "A platform admin started reading the content of a team you own, with a reason.", Mandatory: true, TeamRole: authz.RoleOwner},
	{Type: BreakGlassEnded, Label: "Break-glass access ended", Description: "A platform admin's break-glass session on a team you own ended, with what it read.", Mandatory: true, TeamRole: authz.RoleOwner},
	{Type: BreakGlassRequested, Label: "Break-glass approval requested", Description: "Another platform admin asked to read a team's content and needs a second admin's approval (platform admins).", PlatformAdmins: true},
	{Type: BreakGlassDecided, Label: "Break-glass request decided", Description: "Another platform admin approved or denied your break-glass request, or it lapsed (platform admins).", PlatformAdmins: true},
	{Type: ProfileMigration, Label: "Profile migration switched or needs attention", Description: "A knowledge base switched to another embedding profile, or documents failed to move (platform admins).", PlatformAdmins: true},
	{Type: KBProfileChanged, Label: "Knowledge base changed embedding profile", Description: "A knowledge base in a team where you're an admin or owner moved to another embedding profile, or back.", TeamRole: authz.RoleAdmin},
	{Type: EvaluationRegression, Label: "Evaluation scores dropped", Description: "An automatic evaluation run in a team where you're an editor, admin or owner found questions that newly fail, or recall fell by more than 5 points.", TeamRole: authz.RoleEditor},
}

// Catalog returns every event type in display order.
func Catalog() []Def { return append([]Def(nil), catalog...) }

// Lookup returns an event type's definition.
func Lookup(t Type) (Def, bool) {
	for _, d := range catalog {
		if d.Type == t {
			return d, true
		}
	}
	return Def{}, false
}

// Channels are where one person receives an event.
type Channels struct {
	InApp bool
	Email bool
}

// Default is the setting of every event until a user changes it: on, in the
// app and by email.
var Default = Channels{InApp: true, Email: true}

// Resolve returns a recipient's channels for an event: mandatory events use
// every channel; otherwise the user's saved choice (nil: none saved) or the
// default. Whether email can actually be sent (SMTP configured, an
// address) is decided by the caller.
func Resolve(d Def, saved *Channels) Channels {
	if d.Mandatory {
		return Channels{InApp: true, Email: true}
	}
	if saved != nil {
		return *saved
	}
	return Default
}

// teamRoles are the roles that satisfy a minimum team role.
func teamRoles(min string) []string {
	var out []string
	for _, r := range []string{authz.RoleOwner, authz.RoleAdmin, authz.RoleEditor, authz.RoleMember} {
		if authz.RoleAtLeast(r, min) {
			out = append(out, r)
		}
	}
	return out
}
