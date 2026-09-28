// Short names: platform admins give an agent a unique /a/{short} address
// (ADR-0009, docs/phase4-publishing.md §3).

package agents

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var shortNameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,39}$`)

// reservedShortNames would collide with fixed paths (/a/id/…, /embed,
// /widget.js, /v1, …) or read as official pages.
var reservedShortNames = map[string]bool{
	"admin": true, "api": true, "id": true, "embed": true, "widget": true, "auth": true, "v1": true,
	"assets": true, "static": true, "agents": true, "teams": true, "settings": true, "notifications": true,
	"public": true, "short": true, "login": true, "logout": true, "me": true, "new": true, "help": true,
	"healthz": true, "readyz": true, "metrics": true, "a": true, "www": true, "support": true,
}

// ValidateShortName normalises (trims, lower-cases) and checks a short
// name: 2-40 lowercase letters, digits or hyphens starting with a letter or
// digit, not reserved, not a UUID.
func ValidateShortName(raw string) (string, error) {
	s := strings.ToLower(strings.TrimSpace(raw))
	if !shortNameRE.MatchString(s) {
		return "", apperr.Invalid("invalid_short_name",
			"A short name is 2-40 lowercase letters, digits or hyphens, starting with a letter or digit")
	}
	if reservedShortNames[s] {
		return "", apperr.Invalid("invalid_short_name", "That short name is reserved")
	}
	if _, err := uuid.Parse(s); err == nil {
		return "", apperr.Invalid("invalid_short_name", "A short name cannot look like an ID")
	}
	return s, nil
}

// SetShortName assigns (or with nil, removes) an agent's short name
// (platform admins; audited). 409 short_name_taken when another agent has it.
func (s *Service) SetShortName(ctx context.Context, a authz.Actor, id uuid.UUID, short *string) (AdminAgent, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return AdminAgent{}, apperr.Forbidden("Only platform admins can do this")
	}
	var next string
	if short != nil && strings.TrimSpace(*short) != "" {
		var err error
		if next, err = ValidateShortName(*short); err != nil {
			return AdminAgent{}, err
		}
	}
	var teamID uuid.UUID
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockAgent(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoAgent
		} else if err != nil {
			return err
		}
		teamID = cur.TeamID
		prev := ""
		if sn, err := q.GetShortName(ctx, id); err == nil {
			prev = sn.ShortName
		}
		if prev == next {
			return nil
		}
		if next != "" {
			if owner, err := q.ShortNameOwner(ctx, next); err == nil && owner != id {
				return apperr.Conflict("short_name_taken", "Another agent already has that short name")
			}
		}
		if _, err := q.DeleteShortName(ctx, id); err != nil {
			return err
		}
		if next != "" {
			if err := q.InsertShortName(ctx, dbgen.InsertShortNameParams{ShortName: next, AgentID: id,
				CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}}); err != nil {
				return err
			}
		}
		e := a.Audit("agent.short_name", "agent", id.String())
		e.TeamID = cur.TeamID
		e.Before, e.After = map[string]any{"shortName": prev}, map[string]any{"shortName": next}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return AdminAgent{}, err
	}
	return s.adminAgent(ctx, teamID, id)
}

// adminAgent is one row of the admin agent list.
func (s *Service) adminAgent(ctx context.Context, teamID, id uuid.UUID) (AdminAgent, error) {
	rows, err := s.q.AdminListAgents(ctx, dbgen.AdminListAgentsParams{Team: ptr(teamID.String())})
	if err != nil {
		return AdminAgent{}, err
	}
	for _, r := range rows {
		if r.ID == id {
			return r, nil
		}
	}
	return AdminAgent{}, errNoAgent
}

// ProfileByShortName resolves /a/{short} for a signed-in user or key: the
// agent's profile when they may use it, 404 otherwise.
func (s *Service) ProfileByShortName(ctx context.Context, a authz.Actor, short string) (Card, error) {
	ag, err := s.q.AgentByShortName(ctx, strings.ToLower(strings.TrimSpace(short)))
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Card{}, errNoAgent
	} else if err != nil {
		return Card{}, err
	}
	return s.Profile(ctx, a, "", ag.ID.String())
}
