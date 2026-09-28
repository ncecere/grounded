// Break-glass notifications (ADR-0024, docs/phase5-deploy.md §5 P4).

package notify

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// BreakGlassInfo describes a session for its notifications.
type BreakGlassInfo struct {
	SessionID uuid.UUID
	Admin     string // the reading admin's name or email
	Reason    string
	// Scopes in words, e.g. "conversations and documents".
	Scopes    string
	ExpiresAt time.Time
}

func (b BreakGlassInfo) data(t TeamRef) map[string]any {
	return map[string]any{"team": t.Slug, "sessionId": b.SessionID}
}

func (b BreakGlassInfo) adminLink() string {
	return "/admin/break-glass?record=" + b.SessionID.String()
}

// BreakGlassStartedEvent: a session on a team started (at once, or when a
// second admin approved it). It reaches the team's owners and can't be
// turned off.
func BreakGlassStartedEvent(t TeamRef, b BreakGlassInfo, approvedBy string) Event {
	body := fmt.Sprintf("%s, a platform admin, can read the %s of %s until %s (UTC). Every read is recorded in the team's audit log, and you'll get a summary when the session ends.\n\nReason given: %s",
		b.Admin, b.Scopes, t.Name, b.ExpiresAt.UTC().Format("2 January 2006, 15:04"), b.Reason)
	if approvedBy != "" {
		body += "\n\nApproved by: " + approvedBy
	}
	return Event{
		Type: BreakGlassStarted, TeamID: t.ID, Link: t.path(""),
		DedupeKey: "breakglass_started:" + b.SessionID.String(),
		Title:     fmt.Sprintf("A platform admin is reading %s's %s", t.Name, b.Scopes),
		Body:      body, Data: b.data(t),
	}
}

// BreakGlassEndedEvent: a session on a team ended, expired or was revoked,
// with a summary of what it read (kinds and counts, never content). It
// reaches the team's owners and can't be turned off. how is "ended",
// "expired" or "was revoked".
func BreakGlassEndedEvent(t TeamRef, b BreakGlassInfo, how string, summary []string) Event {
	read := "Nothing was read."
	if len(summary) > 0 {
		read = "What was read:\n" + strings.Join(summary, "\n")
	}
	return Event{
		Type: BreakGlassEnded, TeamID: t.ID, Link: t.path("/settings?tab=audit"),
		DedupeKey: "breakglass_ended:" + b.SessionID.String(),
		Title:     fmt.Sprintf("Break-glass access to %s %s", t.Name, how),
		Body: fmt.Sprintf("The break-glass session of %s on %s %s.\n\n%s\n\nEach read is listed in the team's audit log.\n\nReason given: %s",
			b.Admin, t.Name, how, read, b.Reason),
		Data: b.data(t),
	}
}

// BreakGlassRequestedEvent: an admin asked for a session that needs a
// second admin's approval; it reaches the other platform admins.
func BreakGlassRequestedEvent(t TeamRef, b BreakGlassInfo, admins []uuid.UUID, deadline time.Time) Event {
	return Event{
		Type: BreakGlassRequested, TeamID: t.ID, Users: admins, Link: b.adminLink(),
		DedupeKey: "breakglass_requested:" + b.SessionID.String(),
		Title:     fmt.Sprintf("Break-glass approval needed: %s", t.Name),
		Body: fmt.Sprintf("%s asked to read the %s of %s. The request lapses at %s (UTC) unless another platform admin approves it.\n\nReason given: %s\n\nApprove or deny it under Admin, Break-glass.",
			b.Admin, b.Scopes, t.Name, deadline.UTC().Format("2 January 2006, 15:04"), b.Reason),
		Data: b.data(t),
	}
}

// BreakGlassDecidedEvent: the admin's request was approved, denied or
// lapsed. decision is "approved", "denied" or "lapsed"; by names who
// decided (empty when it lapsed).
func BreakGlassDecidedEvent(t TeamRef, b BreakGlassInfo, requester uuid.UUID, decision, by, note string) Event {
	body := fmt.Sprintf("Your break-glass request for %s was %s", t.Name, decision)
	if by != "" {
		body += " by " + by
	}
	body += "."
	if decision == "approved" {
		body += fmt.Sprintf(" You can read its %s until %s (UTC).", b.Scopes, b.ExpiresAt.UTC().Format("2 January 2006, 15:04"))
	}
	if note = strings.TrimSpace(note); note != "" {
		body += "\n\nReason given: " + note
	}
	return Event{
		Type: BreakGlassDecided, TeamID: t.ID, Users: []uuid.UUID{requester}, Link: b.adminLink(),
		DedupeKey: "breakglass_decided:" + b.SessionID.String(),
		Title:     fmt.Sprintf("Break-glass request %s: %s", decision, t.Name),
		Body:      body, Data: b.data(t),
	}
}
