package public

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Publishable key administration (team admins and owners; audited). Keys
// belong to one agent of the team.

// Key is a stored publishable key.
type Key = dbgen.PublishableKey

// KeyInput creates or changes a key; nil fields are unchanged (defaults on
// create: enabled, no origins, no overrides).
type KeyInput struct {
	Name           *string
	AllowedOrigins *[]string
	Enabled        *bool
	RateLimits     *KeyLimits
}

var errNoKey = apperr.NotFound("publishable_key_not_found", "Publishable key not found")

// keyAccess checks that the actor is a team admin or owner (a person, not
// an API key) of the agent's team and the agent exists.
func (s *Service) keyAccess(ctx context.Context, a authz.Actor, teamRef string, agentID uuid.UUID) (dbgen.Team, error) {
	if a.Key != nil {
		return dbgen.Team{}, apperr.Forbidden("API keys cannot manage publishable keys")
	}
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return dbgen.Team{}, err
	}
	if acc.Role == "" {
		return dbgen.Team{}, apperr.NotFound("team_not_found", "Team not found")
	}
	if !authz.RoleAtLeast(acc.Role, authz.RoleAdmin) {
		return dbgen.Team{}, apperr.Forbidden("Only team admins and owners can manage publishable keys")
	}
	ag, err := s.q.GetAgent(ctx, agentID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && ag.TeamID != acc.Team.ID) {
		return dbgen.Team{}, apperr.NotFound("agent_not_found", "Agent not found")
	} else if err != nil {
		return dbgen.Team{}, err
	}
	return acc.Team, nil
}

// ListKeys lists an agent's keys (not revoked).
func (s *Service) ListKeys(ctx context.Context, a authz.Actor, teamRef string, agentID uuid.UUID) ([]Key, error) {
	if _, err := s.keyAccess(ctx, a, teamRef, agentID); err != nil {
		return nil, err
	}
	return s.q.ListPublishableKeys(ctx, agentID)
}

// CreateKey creates a key; the returned secret is shown once.
func (s *Service) CreateKey(ctx context.Context, a authz.Actor, teamRef string, agentID uuid.UUID, in KeyInput) (Key, string, error) {
	if len(s.Pepper) == 0 {
		return Key{}, "", apperr.New(503, "keys_unavailable", "Publishable keys need API_KEY_PEPPER")
	}
	team, err := s.keyAccess(ctx, a, teamRef, agentID)
	if err != nil {
		return Key{}, "", err
	}
	if team.Status != teams.StatusActive {
		return Key{}, "", apperr.Conflict("team_archived", "This team is archived and read-only")
	}
	next, err := s.applyKeyInput(ctx, team.ID, Key{Enabled: true, AllowedOrigins: []string{}, RateLimits: json.RawMessage("{}")}, in)
	if err != nil {
		return Key{}, "", err
	}
	if next.Name == "" {
		return Key{}, "", apperr.Invalid("invalid_name", "Name must be 1-100 characters")
	}
	raw, id := NewKey()
	var out Key
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if out, err = q.InsertPublishableKey(ctx, dbgen.InsertPublishableKeyParams{
			AgentID: agentID, TeamID: team.ID, Name: next.Name, Prefix: id, SecretHash: HashKey(s.Pepper, raw), PepperID: s.peppers().CurrentID(),
			AllowedOrigins: next.AllowedOrigins, RateLimits: next.RateLimits,
			CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		}); err != nil {
			return err
		}
		if !next.Enabled {
			if out, err = q.UpdatePublishableKey(ctx, updateParams(out.ID, next)); err != nil {
				return err
			}
		}
		return s.auditKey(ctx, q, a, "agent.publishable_key_create", team.ID, agentID, nil, &out)
	})
	return out, raw, err
}

// UpdateKey changes a key's name, origins, overrides or enabled flag
// (If-Match revision).
func (s *Service) UpdateKey(ctx context.Context, a authz.Actor, teamRef string, agentID, keyID uuid.UUID, in KeyInput, rev int64) (Key, error) {
	team, err := s.keyAccess(ctx, a, teamRef, agentID)
	if err != nil {
		return Key{}, err
	}
	var out Key
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockPublishableKey(ctx, keyID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && cur.AgentID != agentID) {
			return errNoKey
		} else if err != nil {
			return err
		}
		if cur.Revision != rev {
			return apperr.Stale()
		}
		next, err := s.applyKeyInput(ctx, team.ID, cur, in)
		if err != nil {
			return err
		}
		if out, err = q.UpdatePublishableKey(ctx, updateParams(keyID, next)); err != nil {
			return err
		}
		return s.auditKey(ctx, q, a, "agent.publishable_key_update", team.ID, agentID, &cur, &out)
	})
	return out, err
}

// RevokeKey revokes a key for good: widgets using it stop at once.
func (s *Service) RevokeKey(ctx context.Context, a authz.Actor, teamRef string, agentID, keyID uuid.UUID) error {
	team, err := s.keyAccess(ctx, a, teamRef, agentID)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockPublishableKey(ctx, keyID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && cur.AgentID != agentID) {
			return errNoKey
		} else if err != nil {
			return err
		}
		if err := q.RevokePublishableKey(ctx, keyID); err != nil {
			return err
		}
		return s.auditKey(ctx, q, a, "agent.publishable_key_revoke", team.ID, agentID, &cur, nil)
	})
}

func updateParams(id uuid.UUID, k Key) dbgen.UpdatePublishableKeyParams {
	return dbgen.UpdatePublishableKeyParams{ID: id, Name: k.Name, AllowedOrigins: k.AllowedOrigins, RateLimits: k.RateLimits, Enabled: k.Enabled}
}

// applyKeyInput validates the input over the current key: the name, the
// origins and the overrides (within the platform ceilings).
func (s *Service) applyKeyInput(ctx context.Context, teamID uuid.UUID, k Key, in KeyInput) (Key, error) {
	if in.Name != nil {
		k.Name = strings.TrimSpace(*in.Name)
		if n := len([]rune(k.Name)); n < 1 || n > 100 {
			return k, apperr.Invalid("invalid_name", "Name must be 1-100 characters")
		}
	}
	if in.AllowedOrigins != nil {
		origins, err := NormalizeAllowedOrigins(*in.AllowedOrigins)
		if err != nil {
			return k, apperr.Invalid("invalid_origin", err.Error())
		}
		k.AllowedOrigins = origins
	}
	if in.Enabled != nil {
		k.Enabled = *in.Enabled
	}
	if in.RateLimits != nil {
		set, err := s.Limits.Effective(ctx, nil, teamID)
		if err != nil {
			return k, err
		}
		for key, v := range map[limits.Key]*int64{
			limits.PublicQueriesPerIPPerMinute: in.RateLimits.PerIPPerMinute, limits.PublicQueriesPerSessionPerMinute: in.RateLimits.PerSessionPerMinute,
		} {
			d, _ := limits.Lookup(key)
			if err := limits.ValidateOverride(d, set.Platform.Settings[key], v); err != nil {
				return k, err
			}
		}
		k.RateLimits, _ = json.Marshal(in.RateLimits)
	}
	return k, nil
}

func keySnapshot(k *Key) map[string]any {
	if k == nil {
		return nil
	}
	return map[string]any{"name": k.Name, "prefix": k.Prefix, "allowedOrigins": k.AllowedOrigins,
		"rateLimits": json.RawMessage(k.RateLimits), "enabled": k.Enabled}
}

func (s *Service) auditKey(ctx context.Context, q *dbgen.Queries, a authz.Actor, action string, teamID, agentID uuid.UUID, before, after *Key) error {
	id := ""
	if after != nil {
		id = after.ID.String()
	} else if before != nil {
		id = before.ID.String()
	}
	e := a.Audit(action, "publishable_key", id)
	e.TeamID = teamID
	e.Before, e.After = keySnapshot(before), keySnapshot(after)
	e.Metadata = map[string]any{"agentId": agentID.String()}
	return audit.Record(ctx, q, e)
}

// checkKey authenticates a publishable key for an agent: well-formed,
// known, enabled, for this agent, and its digest matches.
func (s *Service) checkKey(ctx context.Context, raw string, agentID uuid.UUID) (Key, error) {
	id, ok := ParseKey(raw)
	if !ok || len(s.Pepper) == 0 {
		return Key{}, errKey
	}
	k, err := s.q.PublishableKeyByPrefix(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Key{}, errKey
	} else if err != nil {
		return Key{}, err
	}
	match, rehash := s.verifyKey(k, strings.TrimSpace(raw))
	if match == secrets.NoMatch || !k.Enabled || k.AgentID != agentID {
		return Key{}, errKey
	}
	if err := s.markPepper(ctx, k, match, rehash); err != nil {
		return Key{}, err
	}
	_ = s.q.TouchPublishableKey(ctx, k.ID)
	return k, nil
}

// EmbedKey is the key an embed page was opened with, for its CSP.
func (s *Service) EmbedKey(ctx context.Context, raw string, agentID uuid.UUID) (Key, error) {
	return s.checkKey(ctx, raw, agentID)
}
