// Break-glass rules (ADR-0011, ADR-0024, docs/phase5-deploy.md §5 P4).
//
// A platform admin has no access to team content. A break-glass session is
// an explicit, time-boxed grant for one admin, one team and one or two
// content kinds (conversations, documents). It is not a role: every content
// read checks the grant again (BreakGlassGrant.Allows), so a session that
// ends, expires or is revoked stops access on the next request, and an admin
// who loses the platform_admin role loses it too. Reads under a grant are
// read-only; no write path consults it.

package authz

import (
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
)

// Break-glass content kinds: the scopes a session can grant.
const (
	// BreakGlassConversations: the team's conversation list and transcripts.
	BreakGlassConversations = "conversations"
	// BreakGlassDocuments: the team's data sources, documents and passages.
	BreakGlassDocuments = "documents"
)

// Break-glass session statuses. pending and active are open; the rest are
// final.
const (
	BreakGlassPending        = "pending"         // waiting for a second admin
	BreakGlassActive         = "active"          // reads allowed until expires_at
	BreakGlassEnded          = "ended"           // ended early (by the admin or revoked by another)
	BreakGlassExpired        = "expired"         // its time ran out
	BreakGlassDenied         = "denied"          // a second admin refused it
	BreakGlassCancelled      = "cancelled"       // withdrawn by the admin before approval
	BreakGlassRequestExpired = "request_expired" // nobody approved it in time
)

// Break-glass limits.
const (
	// BreakGlassMinReason is the shortest reason accepted (runes, trimmed).
	BreakGlassMinReason = 20
	// BreakGlassMaxReason is the longest reason or denial note.
	BreakGlassMaxReason = 1000
	// BreakGlassMinDuration is the shortest session.
	BreakGlassMinDuration = 5 * time.Minute
	// BreakGlassDefaultDuration is a session's length unless the admin asks
	// for another (capped at the platform maximum).
	BreakGlassDefaultDuration = time.Hour
	// Bounds of the platform settings.
	BreakGlassMaxDurationLow   = 15 * time.Minute
	BreakGlassMaxDurationHigh  = 24 * time.Hour
	BreakGlassApprovalTimeLow  = 5 * time.Minute
	BreakGlassApprovalTimeHigh = 7 * 24 * time.Hour
)

// BreakGlassPolicy is the platform setting (phase5-deploy.md §9 decision 3).
type BreakGlassPolicy struct {
	// ApprovalRequired: a second platform admin must approve a session
	// before it starts. Off by default: one admin with a written reason.
	ApprovalRequired bool
	// MaxDuration caps a session's length.
	MaxDuration time.Duration
	// ApprovalTimeout: a pending request lapses after this long.
	ApprovalTimeout time.Duration
}

// DefaultBreakGlassPolicy is the policy of a new install.
var DefaultBreakGlassPolicy = BreakGlassPolicy{MaxDuration: 8 * time.Hour, ApprovalTimeout: time.Hour}

// Validate checks the setting's bounds.
func (p BreakGlassPolicy) Validate() error {
	if p.MaxDuration < BreakGlassMaxDurationLow || p.MaxDuration > BreakGlassMaxDurationHigh || p.MaxDuration%time.Minute != 0 {
		return apperr.Invalid("invalid_max_duration", "The maximum duration must be between 15 minutes and 24 hours, in whole minutes")
	}
	if p.ApprovalTimeout < BreakGlassApprovalTimeLow || p.ApprovalTimeout > BreakGlassApprovalTimeHigh || p.ApprovalTimeout%time.Minute != 0 {
		return apperr.Invalid("invalid_approval_timeout", "The approval timeout must be between 5 minutes and 7 days, in whole minutes")
	}
	return nil
}

// DefaultDuration is the session length offered by default: an hour, or
// the maximum when that is shorter.
func (p BreakGlassPolicy) DefaultDuration() time.Duration {
	return min(BreakGlassDefaultDuration, p.MaxDuration)
}

// BreakGlassRequest is what an admin asks for when starting a session.
type BreakGlassRequest struct {
	TeamID   uuid.UUID
	Reason   string
	Scopes   []string
	Duration time.Duration // 0: the default
}

// breakGlassActor: break-glass is for a platform admin in a browser session,
// never an API key (keys never carry a platform role, ADR-0012).
func breakGlassActor(a Actor) bool {
	return a.Key == nil && a.UserID != uuid.Nil && a.IsPlatformAdmin()
}

// NormalizeBreakGlassRequest checks a request against the policy and returns
// it with the reason trimmed, the scopes sorted and deduplicated and the
// duration filled in.
func NormalizeBreakGlassRequest(a Actor, r BreakGlassRequest, p BreakGlassPolicy) (BreakGlassRequest, error) {
	if !breakGlassActor(a) {
		return r, apperr.Forbidden("Only platform admins can start a break-glass session")
	}
	if r.TeamID == uuid.Nil {
		return r, apperr.Invalid("invalid_team", "Choose a team")
	}
	r.Reason = strings.TrimSpace(r.Reason)
	if n := utf8.RuneCountInString(r.Reason); n < BreakGlassMinReason || n > BreakGlassMaxReason {
		return r, apperr.Invalid("invalid_reason", fmt.Sprintf(
			"Give a reason of %d to %d characters: the team's owners see it", BreakGlassMinReason, BreakGlassMaxReason))
	}
	scopes, err := normalizeScopes(r.Scopes)
	if err != nil {
		return r, err
	}
	r.Scopes = scopes
	if r.Duration == 0 {
		r.Duration = p.DefaultDuration()
	}
	if r.Duration < BreakGlassMinDuration || r.Duration > p.MaxDuration || r.Duration%time.Minute != 0 {
		return r, apperr.Invalid("invalid_duration", fmt.Sprintf(
			"The duration must be between 5 minutes and %s, in whole minutes", HumanDuration(p.MaxDuration)))
	}
	return r, nil
}

func normalizeScopes(in []string) ([]string, error) {
	var out []string
	for _, s := range in {
		if s != BreakGlassConversations && s != BreakGlassDocuments {
			return nil, apperr.Invalid("invalid_scope", "Scope must be conversations, documents or both")
		}
		if !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil, apperr.Invalid("invalid_scope", "Choose what to read: conversations, documents or both")
	}
	slices.Sort(out)
	return out, nil
}

// BreakGlassSession is the state of a session that the rules below decide
// on.
type BreakGlassSession struct {
	ID          uuid.UUID
	TeamID      uuid.UUID
	RequestedBy uuid.UUID
	Scopes      []string
	Status      string
	// ApprovalDeadline is when a pending request lapses.
	ApprovalDeadline *time.Time
	StartedAt        *time.Time
	ExpiresAt        *time.Time
}

// EffectiveStatus is the status at now: an active session past its end is
// expired, a pending one past its deadline has lapsed, even before the sweep
// records it.
func (s BreakGlassSession) EffectiveStatus(now time.Time) string {
	switch {
	case s.Status == BreakGlassActive && (s.ExpiresAt == nil || !now.Before(*s.ExpiresAt)):
		return BreakGlassExpired
	case s.Status == BreakGlassPending && (s.ApprovalDeadline == nil || !now.Before(*s.ApprovalDeadline)):
		return BreakGlassRequestExpired
	}
	return s.Status
}

// Allows reports whether the session lets actor a read the content of kind
// in team at now. It is checked on every read: the actor must be the
// session's platform admin (with a browser session), the team and kind must
// be granted, and now must fall within the session's time.
func (s BreakGlassSession) Allows(a Actor, team uuid.UUID, kind string, now time.Time) bool {
	return breakGlassActor(a) && s.ID != uuid.Nil &&
		a.UserID == s.RequestedBy && team != uuid.Nil && team == s.TeamID &&
		slices.Contains(s.Scopes, kind) &&
		s.Status == BreakGlassActive && s.StartedAt != nil && !now.Before(*s.StartedAt) &&
		s.EffectiveStatus(now) == BreakGlassActive
}

var errNotPending = apperr.Conflict("break_glass_not_pending", "This request is no longer waiting for approval")

// CheckBreakGlassDecision decides whether a may approve or deny a pending
// request: another platform admin, never the one who asked (self-approval
// is refused), before the request lapses.
func CheckBreakGlassDecision(a Actor, s BreakGlassSession, now time.Time) error {
	if !breakGlassActor(a) {
		return apperr.Forbidden("Only platform admins can approve or deny break-glass requests")
	}
	if a.UserID == s.RequestedBy {
		return apperr.Forbidden("Another platform admin must approve or deny your request")
	}
	if s.EffectiveStatus(now) != BreakGlassPending {
		return errNotPending
	}
	return nil
}

// CheckBreakGlassDenyNote checks a denial's reason and returns it trimmed.
func CheckBreakGlassDenyNote(note string) (string, error) {
	note = strings.TrimSpace(note)
	if note == "" || utf8.RuneCountInString(note) > BreakGlassMaxReason {
		return note, apperr.Invalid("invalid_reason", fmt.Sprintf("Give a reason for the denial (up to %d characters): the admin who asked sees it", BreakGlassMaxReason))
	}
	return note, nil
}

// BreakGlassEndStatus decides what ending a session means for actor a and
// returns the final status: the admin who asked cancels a pending request
// or ends an active session; another platform admin may revoke an active
// session (it ends) but denies, rather than cancels, a pending one.
func BreakGlassEndStatus(a Actor, s BreakGlassSession, now time.Time) (string, error) {
	if !breakGlassActor(a) {
		return "", apperr.Forbidden("Only platform admins can end break-glass sessions")
	}
	switch s.EffectiveStatus(now) {
	case BreakGlassActive:
		return BreakGlassEnded, nil
	case BreakGlassPending:
		if a.UserID != s.RequestedBy {
			return "", apperr.Conflict("break_glass_not_yours", "Only the admin who asked can withdraw a request; deny it instead")
		}
		return BreakGlassCancelled, nil
	}
	return "", apperr.Conflict("break_glass_closed", "This break-glass session has already ended")
}

// HumanDuration renders a whole-minute duration: "1 hour", "90 minutes",
// "8 hours".
func HumanDuration(d time.Duration) string {
	m := int(d / time.Minute)
	switch {
	case m%(24*60) == 0 && m >= 24*60:
		return plural(m/(24*60), "day")
	case m%60 == 0 && m >= 60:
		return plural(m/60, "hour")
	}
	return plural(m, "minute")
}

func plural(n int, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	return fmt.Sprintf("%d %ss", n, unit)
}
