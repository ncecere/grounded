package retention

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Legal holds (DESIGN.md §8, ADR-0010). A hold on a user, team, agent or
// conversation, optionally limited to a date range of the data, stops every
// retention deletion of what it covers: conversations (including those their
// users deleted, which stay hidden from them but stored), analytics and
// usage events, the access log, audit entries, deleted documents' files and
// expired invites. Holds never expire; a platform admin releases them.
// Placing and releasing are audited without a team, so only platform
// admins and auditors ever see them.

// Scope types.
const (
	ScopeUser         = "user"
	ScopeTeam         = "team"
	ScopeAgent        = "agent"
	ScopeConversation = "conversation"
)

// MaxHoldReason bounds a hold's reason and release reason.
const MaxHoldReason = 2000

// Hold is a legal hold.
type Hold struct {
	ID        uuid.UUID
	ScopeType string
	ScopeID   uuid.UUID
	// ScopeLabel is the covered object's current name, or the name recorded
	// when the hold was placed if it no longer exists (ScopeExists false).
	ScopeLabel  string
	ScopeExists bool
	// ScopeContext is the team of an agent, or the agent of a conversation.
	ScopeContext           string
	Reason                 string
	CoversFrom, CoversTo   *time.Time
	CreatedAt              time.Time
	CreatedBy              Person
	ReleasedAt             *time.Time
	ReleasedBy             Person
	ReleaseReason          string
	Conversations, Deleted int64
}

// Active reports whether the hold is in force.
func (h Hold) Active() bool { return h.ReleasedAt == nil }

func toHold(r dbgen.ListLegalHoldsRow) Hold {
	h := Hold{
		ID: r.ID, ScopeType: r.ScopeType, ScopeID: r.ScopeID, ScopeLabel: r.LiveLabel, ScopeExists: r.LiveLabel != "",
		ScopeContext: r.ScopeContext, Reason: r.Reason, CoversFrom: r.CoversFrom, CoversTo: r.CoversTo,
		CreatedAt: r.CreatedAt, CreatedBy: person(uuid.NullUUID{UUID: r.CreatedBy, Valid: true}, r.CreatedByName, r.CreatedByEmail),
		ReleasedAt: r.ReleasedAt, ReleasedBy: person(r.ReleasedBy, r.ReleasedByName, r.ReleasedByEmail),
		ReleaseReason: r.ReleaseReason, Conversations: r.Conversations, Deleted: r.DeletedConversations,
	}
	if !h.ScopeExists {
		h.ScopeLabel = r.ScopeLabel
	}
	return h
}

// Holds lists holds, newest first. status is active (default), released or all.
func (s *Service) Holds(ctx context.Context, a authz.Actor, status string) ([]Hold, error) {
	if err := canRead(a); err != nil {
		return nil, err
	}
	switch status {
	case "":
		status = "active"
	case "active", "released", "all":
	default:
		return nil, apperr.Invalid("invalid_status", "The status must be active, released or all")
	}
	return s.listHolds(ctx, dbgen.New(s.Pool), uuid.NullUUID{}, status)
}

func (s *Service) listHolds(ctx context.Context, q *dbgen.Queries, id uuid.NullUUID, status string) ([]Hold, error) {
	rows, err := q.ListLegalHolds(ctx, dbgen.ListLegalHoldsParams{ID: id, Status: status, PageSize: 1000})
	if err != nil {
		return nil, err
	}
	out := make([]Hold, 0, len(rows))
	for _, r := range rows {
		out = append(out, toHold(r))
	}
	return out, nil
}

// Hold returns one hold.
func (s *Service) Hold(ctx context.Context, a authz.Actor, id uuid.UUID) (Hold, error) {
	if err := canRead(a); err != nil {
		return Hold{}, err
	}
	return s.hold(ctx, dbgen.New(s.Pool), id)
}

var errNoHold = apperr.NotFound("legal_hold_not_found", "No such legal hold")

func (s *Service) hold(ctx context.Context, q *dbgen.Queries, id uuid.UUID) (Hold, error) {
	list, err := s.listHolds(ctx, q, uuid.NullUUID{UUID: id, Valid: true}, "all")
	if err != nil {
		return Hold{}, err
	}
	if len(list) == 0 {
		return Hold{}, errNoHold
	}
	return list[0], nil
}

// NewHold places a hold. Scope identifies what it covers: an ID, or a
// user's email, a team's slug, or an agent as team-slug/agent-slug.
type NewHold struct {
	ScopeType            string
	Scope                string
	Reason               string
	CoversFrom, CoversTo *time.Time
}

func (in *NewHold) validate() error {
	in.Scope, in.Reason = strings.TrimSpace(in.Scope), strings.TrimSpace(in.Reason)
	if err := validReason(in.Reason, "invalid_reason", "Give the reason for the hold"); err != nil {
		return err
	}
	if in.CoversFrom != nil && in.CoversTo != nil && !in.CoversFrom.Before(*in.CoversTo) {
		return apperr.Invalid("invalid_range", "The end of the date range must be after its start")
	}
	if in.Scope == "" {
		return apperr.Invalid("invalid_scope", "Say what the hold covers")
	}
	return nil
}

func validReason(reason, code, missing string) error {
	if reason == "" {
		return apperr.Invalid(code, missing)
	}
	if utf8.RuneCountInString(reason) > MaxHoldReason {
		return apperr.Invalid(code, fmt.Sprintf("The reason can be at most %d characters", MaxHoldReason))
	}
	return nil
}

// resolveScope finds the covered object and its name.
func resolveScope(ctx context.Context, q *dbgen.Queries, typ, scope string) (uuid.UUID, string, error) {
	id, idErr := uuid.Parse(scope)
	nid := uuid.NullUUID{UUID: id, Valid: idErr == nil}
	var (
		found uuid.UUID
		label string
		err   error
	)
	switch typ {
	case ScopeUser:
		var r dbgen.LegalHoldUserRow
		r, err = q.LegalHoldUser(ctx, dbgen.LegalHoldUserParams{ID: nid, Email: &scope})
		found, label = r.ID, r.Label
	case ScopeTeam:
		var r dbgen.LegalHoldTeamRow
		r, err = q.LegalHoldTeam(ctx, dbgen.LegalHoldTeamParams{ID: nid, Slug: &scope})
		found, label = r.ID, r.Label
	case ScopeAgent:
		team, agent, _ := strings.Cut(scope, "/")
		var r dbgen.LegalHoldAgentRow
		r, err = q.LegalHoldAgent(ctx, dbgen.LegalHoldAgentParams{ID: nid, TeamSlug: &team, AgentSlug: &agent})
		found, label = r.ID, r.Label
	case ScopeConversation:
		if idErr != nil {
			return uuid.Nil, "", apperr.Invalid("scope_not_found", "That isn't a conversation ID. Paste the conversation's link or ID.")
		}
		var r dbgen.LegalHoldConversationRow
		r, err = q.LegalHoldConversation(ctx, id)
		found, label = r.ID, r.Label
	default:
		return uuid.Nil, "", apperr.Invalid("invalid_scope_type", "The scope must be a user, team, agent or conversation")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, "", apperr.Invalid("scope_not_found", fmt.Sprintf("No %s matches %q", typ, scope))
	}
	return found, label, err
}

// PlaceHold places a legal hold (platform admins with a session; audited).
// It takes effect for the next retention batch.
func (s *Service) PlaceHold(ctx context.Context, a authz.Actor, in NewHold) (Hold, error) {
	if err := canWrite(a); err != nil {
		return Hold{}, err
	}
	if err := in.validate(); err != nil {
		return Hold{}, err
	}
	var out Hold
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		id, label, err := resolveScope(ctx, q, in.ScopeType, in.Scope)
		if err != nil {
			return err
		}
		h, err := q.InsertLegalHold(ctx, dbgen.InsertLegalHoldParams{
			ScopeType: in.ScopeType, ScopeID: id, ScopeLabel: truncate(label, 300), Reason: in.Reason,
			CoversFrom: in.CoversFrom, CoversTo: in.CoversTo, CreatedBy: a.UserID,
		})
		if err != nil {
			return err
		}
		e := a.Audit("legal_hold.create", "legal_hold", h.ID.String())
		e.After = holdSnapshot(h)
		e.Metadata = map[string]any{"name": holdName(h)}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		out, err = s.hold(ctx, q, h.ID)
		return err
	})
	return out, err
}

// ReleaseHold releases a hold with a reason (platform admins; audited).
// Retention then deletes what it no longer keeps at its next run.
func (s *Service) ReleaseHold(ctx context.Context, a authz.Actor, id uuid.UUID, reason string) (Hold, error) {
	if err := canWrite(a); err != nil {
		return Hold{}, err
	}
	reason = strings.TrimSpace(reason)
	if err := validReason(reason, "invalid_reason", "Give the reason for releasing the hold"); err != nil {
		return Hold{}, err
	}
	var out Hold
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockLegalHold(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNoHold
		}
		if err != nil {
			return err
		}
		if cur.ReleasedAt != nil {
			return apperr.Conflict("legal_hold_released", "This hold was already released")
		}
		h, err := q.ReleaseLegalHold(ctx, dbgen.ReleaseLegalHoldParams{ID: id, ReleasedBy: actorID(a.UserID), ReleaseReason: reason})
		if err != nil {
			return err
		}
		e := a.Audit("legal_hold.release", "legal_hold", id.String())
		e.Before, e.After = holdSnapshot(cur), holdSnapshot(h)
		e.Metadata = map[string]any{"name": holdName(h)}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		out, err = s.hold(ctx, q, id)
		return err
	})
	return out, err
}

func holdSnapshot(h dbgen.LegalHold) map[string]any {
	m := map[string]any{
		"scopeType": h.ScopeType, "scopeId": h.ScopeID.String(), "scopeName": h.ScopeLabel, "reason": h.Reason,
		"coversFrom": timeOrNil(h.CoversFrom), "coversTo": timeOrNil(h.CoversTo), "active": h.ReleasedAt == nil,
	}
	if h.ReleasedAt != nil {
		m["releaseReason"] = h.ReleaseReason
	}
	return m
}

func holdName(h dbgen.LegalHold) string {
	return truncate(fmt.Sprintf("Legal hold on %s %s", h.ScopeType, h.ScopeLabel), 300)
}

func timeOrNil(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
