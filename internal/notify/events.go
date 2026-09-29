// Event constructors: the text of each notification, in one place. Titles
// are one line and name the team; bodies add what happened and what to do.

package notify

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// TeamRef names the team an event concerns.
type TeamRef struct {
	ID   uuid.UUID
	Slug string
	Name string
}

func (t TeamRef) path(rest string) string { return "/teams/" + t.Slug + rest }

var roleNames = map[string]string{"owner": "Owner", "admin": "Admin", "editor": "Editor", "member": "Member"}

// RoleName is a team role as shown to people.
func RoleName(role string) string {
	if n, ok := roleNames[role]; ok {
		return n
	}
	return role
}

// InvitedEvent: an address was invited to a team. It reaches the address
// by email right away and in the app once they sign in.
func InvitedEvent(t TeamRef, email, role string, expires time.Time) Event {
	return Event{
		Type: TeamInvited, TeamID: t.ID, Emails: []string{email}, Link: "/",
		Title: fmt.Sprintf("You're invited to join %s", t.Name),
		Body: fmt.Sprintf("You've been invited to the team %s as %s. Sign in with %s to join; the invite expires on %s.",
			t.Name, strings.ToLower(RoleName(role)), email, day(expires)),
		Data: map[string]any{"team": t.Slug, "role": role, "email": email},
	}
}

// InviteExpiringEvent: an open invite expires soon (sent once per invite
// and expiry date).
func InviteExpiringEvent(t TeamRef, inviteID uuid.UUID, email, role string, expires time.Time) Event {
	return Event{
		Type: InviteExpiring, TeamID: t.ID, Emails: []string{email}, Link: "/",
		DedupeKey: "invite_expiring:" + inviteID.String() + ":" + day(expires),
		Title:     fmt.Sprintf("Your invite to %s expires on %s", t.Name, day(expires)),
		Body:      fmt.Sprintf("You were invited to the team %s as %s. Sign in with %s before %s to join.", t.Name, strings.ToLower(RoleName(role)), email, day(expires)),
		Data:      map[string]any{"team": t.Slug, "role": role, "inviteId": inviteID},
	}
}

// MemberAddedEvent: a user was added to a team.
func MemberAddedEvent(t TeamRef, user uuid.UUID, role string) Event {
	return Event{
		Type: MembershipChanged, TeamID: t.ID, Users: []uuid.UUID{user}, Link: t.path(""),
		Title: fmt.Sprintf("You were added to %s", t.Name),
		Body:  fmt.Sprintf("You're now a member of %s with the role %s.", t.Name, RoleName(role)),
		Data:  map[string]any{"team": t.Slug, "change": "added", "role": role},
	}
}

// RoleChangedEvent: a member's role changed.
func RoleChangedEvent(t TeamRef, user uuid.UUID, from, to string) Event {
	return Event{
		Type: MembershipChanged, TeamID: t.ID, Users: []uuid.UUID{user}, Link: t.path(""),
		Title: fmt.Sprintf("Your role in %s is now %s", t.Name, RoleName(to)),
		Body:  fmt.Sprintf("Your role in %s changed from %s to %s.", t.Name, RoleName(from), RoleName(to)),
		Data:  map[string]any{"team": t.Slug, "change": "role", "from": from, "to": to},
	}
}

var decisionWords = map[string]string{"approve": "approved", "deny": "denied", "revoke": "revoked"}

// DomainRequestDecidedEvent: a platform admin decided a team's crawl domain
// request; it reaches the person who asked.
func DomainRequestDecidedEvent(t TeamRef, requester, requestID uuid.UUID, pattern, decision, note string) Event {
	word := decisionWords[decision]
	if word == "" {
		word = decision
	}
	body := fmt.Sprintf("Your request to crawl %s for %s was %s.", pattern, t.Name, word)
	if note = strings.TrimSpace(note); note != "" {
		body += "\n\nNote from the reviewer: " + note
	}
	return Event{
		// The request's page in Data sources → Crawl domains (v0.2.1; older links redirect there).
		Type: DomainRequestDecided, TeamID: t.ID, Users: []uuid.UUID{requester}, Link: t.path("/sources?tab=crawl-domains&record=" + requestID.String()),
		Title: fmt.Sprintf("Domain request %s: %s", word, pattern), Body: body,
		Data: map[string]any{"team": t.Slug, "pattern": pattern, "decision": decision, "requestId": requestID},
	}
}

// DomainRequestNewEvent: a team asked to crawl a domain; it reaches the
// platform admins (docs/ui-review P-16).
func DomainRequestNewEvent(t TeamRef, admins []uuid.UUID, requestID uuid.UUID, pattern, requester, reason string) Event {
	who := strings.TrimSpace(requester)
	if who == "" {
		who = "A team member"
	}
	return Event{
		Type: DomainRequestNew, TeamID: t.ID, Users: admins, Link: "/admin/crawl-domains",
		Title: fmt.Sprintf("New domain request: %s (%s)", pattern, t.Name),
		Body:  fmt.Sprintf("%s asked to crawl %s for %s.\n\nReason: %s\n\nReview it under Admin, Crawl domains.", who, pattern, t.Name, reason),
		Data:  map[string]any{"team": t.Slug, "pattern": pattern, "requestId": requestID},
	}
}

// SyncFailedEvent: a web source's sync (crawl run) failed.
func SyncFailedEvent(t TeamRef, sourceID uuid.UUID, sourceName string, crawlID uuid.UUID, reason string) Event {
	return Event{
		Type: SyncFailed, TeamID: t.ID, Link: t.path("/sources/" + sourceID.String()),
		DedupeKey: "sync_failed:" + crawlID.String(),
		Title:     fmt.Sprintf("Sync failed: %s (%s)", sourceName, t.Name),
		Body:      fmt.Sprintf("The web source %s in %s failed to sync: %s", sourceName, t.Name, reason),
		Data:      map[string]any{"team": t.Slug, "sourceId": sourceID, "crawlId": crawlID},
	}
}

// ClassificationLoweredEvent: a team source's classification was lowered
// (mandatory; ADR-0006 rule 7).
func ClassificationLoweredEvent(t TeamRef, sourceID uuid.UUID, sourceName, fromName, toName, reason string) Event {
	return Event{
		Type: ClassificationLowered, TeamID: t.ID, Link: t.path("/sources/" + sourceID.String()),
		Title: fmt.Sprintf("Classification lowered: %s (%s)", sourceName, t.Name),
		Body: fmt.Sprintf("The data source %s in %s was lowered from %s to %s.\n\nReason given: %s",
			sourceName, t.Name, fromName, toName, reason),
		Data: map[string]any{"team": t.Slug, "sourceId": sourceID, "from": fromName, "to": toName},
	}
}

// AgentDisabledEvent: the platform kill switch disabled an agent
// (mandatory).
func AgentDisabledEvent(t TeamRef, agentID uuid.UUID, agentName, reason string) Event {
	return Event{
		Type: AgentDisabled, TeamID: t.ID, Link: t.path("/agents/" + agentID.String()),
		Title: fmt.Sprintf("Agent disabled by a platform admin: %s (%s)", agentName, t.Name),
		Body: fmt.Sprintf("A platform admin disabled the agent %s in %s. Nobody can chat with it until a platform admin enables it again.\n\nReason given: %s",
			agentName, t.Name, reason),
		Data: map[string]any{"team": t.Slug, "agentId": agentID},
	}
}

var audienceNames = map[string]string{"all_authenticated": "all signed-in users", "public": "the public"}

// AgentPublishedEvent: an agent was published to an audience beyond its
// team. For the audiences change to emit when a version with audience
// all_authenticated or public is published.
func AgentPublishedEvent(t TeamRef, agentID uuid.UUID, agentName, audience string, version int) Event {
	who := audienceNames[audience]
	if who == "" {
		who = audience
	}
	return Event{
		Type: AgentPublished, TeamID: t.ID, Link: t.path("/agents/" + agentID.String()),
		Title: fmt.Sprintf("%s is now available to %s", agentName, who),
		Body:  fmt.Sprintf("Version %d of the agent %s in %s was published to %s.", version, agentName, t.Name, who),
		Data:  map[string]any{"team": t.Slug, "agentId": agentID, "audience": audience, "version": version},
	}
}

// DailyLimitReachedEvent: a team used up a daily limit (once per team,
// limit and UTC day). noun names the limit, e.g. "queries per day".
func DailyLimitReachedEvent(t TeamRef, limitKey, noun string, max int64, now time.Time) Event {
	today := now.UTC().Format("2006-01-02")
	return Event{
		Type: DailyLimitReached, TeamID: t.ID, Link: t.path("?tab=usage"),
		DedupeKey: "daily_limit:" + t.ID.String() + ":" + limitKey + ":" + today,
		Title:     fmt.Sprintf("%s reached its daily limit of %s", t.Name, noun),
		Body: fmt.Sprintf("%s reached its limit of %d %s on %s (UTC), so further requests are refused until midnight UTC. A platform admin can raise the limit.",
			t.Name, max, noun, today),
		Data: map[string]any{"team": t.Slug, "limit": limitKey, "max": max, "day": today},
	}
}

// BudgetNotice is a team reaching the threshold of its monthly budget
// (Exhausted false) or using it up.
type BudgetNotice struct {
	Exhausted bool
	Month     time.Time // the month's first day
	// Spent and Limit are decimal amounts with their currency code.
	Spent, Limit, Currency string
	Percent                int
	ResetsAt               time.Time
	Location               *time.Location
}

// BudgetEvent: a team reached its budget threshold or used up its budget
// (once per team, month and level).
func BudgetEvent(t TeamRef, n BudgetNotice) Event {
	month := n.Month.Format("2006-01")
	loc := n.Location
	if loc == nil {
		loc = time.UTC
	}
	resets := n.ResetsAt.In(loc).Format("2 January 2006")
	ev := Event{
		Type: BudgetWarning, TeamID: t.ID, Link: t.path("/settings?tab=usage"),
		DedupeKey: "budget_warning:" + t.ID.String() + ":" + month,
		Title:     fmt.Sprintf("%s has used %d%% of its monthly budget", t.Name, n.Percent),
		Body: fmt.Sprintf("%s has spent %s %s of its %s %s budget for %s. At 100%% its chats, searches and ingestion stop until a platform admin raises the budget or grants an extension, or the month ends on %s.",
			t.Name, n.Currency, n.Spent, n.Currency, n.Limit, n.Month.Format("January 2006"), resets),
		Data: map[string]any{"team": t.Slug, "month": month, "spent": n.Spent, "budget": n.Limit, "currency": n.Currency},
	}
	if n.Exhausted {
		ev.Type, ev.DedupeKey = BudgetExhausted, "budget_exhausted:"+t.ID.String()+":"+month
		ev.Title = fmt.Sprintf("%s has used up its monthly budget", t.Name)
		ev.Body = fmt.Sprintf("%s has spent %s %s of its %s %s budget for %s. Its chats, searches and ingestion are paused until a platform admin raises the budget or grants an extension, or the month ends on %s. Nothing is deleted.",
			t.Name, n.Currency, n.Spent, n.Currency, n.Limit, n.Month.Format("January 2006"), resets)
	}
	return ev
}

func day(t time.Time) string { return t.UTC().Format("2 January 2006") }
