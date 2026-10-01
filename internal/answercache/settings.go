// The platform switch (Admin → Overview → Features) and agents' settings
// (Agent → Settings).

package answercache

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// switchTTL is how long a process trusts its cached platform switch.
const switchTTL = 5 * time.Second

// PlatformSettings is the platform switch.
type PlatformSettings struct {
	Enabled   bool
	Revision  int64
	UpdatedAt time.Time
}

var (
	errReadOnly  = apperr.Forbidden("Only platform admins and auditors can see this")
	errAdminOnly = apperr.Forbidden("Only platform admins can turn the answer cache on or off")
)

// Enabled reports the platform switch (cached briefly; off when unreadable).
func (s *Service) Enabled(ctx context.Context) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.at.IsZero() && time.Since(s.at) < switchTTL {
		return s.on
	}
	st, err := s.load(ctx, s.pool)
	if err != nil {
		s.log.Warn("answer cache: read the platform switch", "err", err)
		return false
	}
	s.on, s.at = st.Enabled, time.Now()
	return s.on
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (s *Service) load(ctx context.Context, q querier) (PlatformSettings, error) {
	var st PlatformSettings
	err := q.QueryRow(ctx, `SELECT enabled, revision, updated_at FROM answer_cache_settings`).Scan(&st.Enabled, &st.Revision, &st.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return PlatformSettings{Enabled: true, Revision: 1, UpdatedAt: time.Now()}, nil
	}
	return st, err
}

// Platform returns the switch (platform admins and auditors).
func (s *Service) Platform(ctx context.Context, a authz.Actor) (PlatformSettings, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return PlatformSettings{}, errReadOnly
	}
	return s.load(ctx, s.pool)
}

// SetPlatform turns the cache on or off for every agent (platform admins;
// audited as platform.answer_cache). Turning it off keeps the entries; they
// expire as usual.
func (s *Service) SetPlatform(ctx context.Context, a authz.Actor, enabled bool, expectedRevision int64) (PlatformSettings, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return PlatformSettings{}, errAdminOnly
	}
	var out PlatformSettings
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		var cur PlatformSettings
		if err := tx.QueryRow(ctx, `SELECT enabled, revision, updated_at FROM answer_cache_settings FOR UPDATE`).Scan(
			&cur.Enabled, &cur.Revision, &cur.UpdatedAt); err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if cur.Enabled == enabled {
			out = cur
			return nil
		}
		if err := tx.QueryRow(ctx, `UPDATE answer_cache_settings SET enabled = $1, revision = revision + 1, updated_by = $2, updated_at = now()
			RETURNING enabled, revision, updated_at`, enabled, nullUser(a)).Scan(&out.Enabled, &out.Revision, &out.UpdatedAt); err != nil {
			return err
		}
		e := a.Audit("platform.answer_cache", "answer_cache_settings", "enabled")
		e.Before, e.After = map[string]any{"enabled": cur.Enabled}, map[string]any{"enabled": enabled}
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.mu.Lock()
		s.on, s.at = out.Enabled, time.Now()
		s.mu.Unlock()
	}
	return out, err
}

func nullUser(a authz.Actor) uuid.NullUUID {
	return uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
}

// AgentSettings returns an agent's settings (the defaults when never saved).
func (s *Service) AgentSettings(ctx context.Context, agentID uuid.UUID) (AgentSettings, error) {
	return agentSettings(ctx, s.pool, agentID, false)
}

func agentSettings(ctx context.Context, q querier, agentID uuid.UUID, lock bool) (AgentSettings, error) {
	sql := `SELECT enabled, near_identical, expiry_hours, revision, updated_at FROM agent_answer_cache WHERE agent_id = $1`
	if lock {
		sql += " FOR UPDATE"
	}
	st := DefaultAgentSettings()
	var at time.Time
	err := q.QueryRow(ctx, sql, agentID).Scan(&st.Enabled, &st.NearIdentical, &st.ExpiryHours, &st.Revision, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return st, nil
	}
	st.UpdatedAt = &at
	return st, err
}

// AgentInput changes an agent's settings.
type AgentInput struct {
	// Enabled nil returns to the default.
	Enabled       *bool
	NearIdentical bool
	ExpiryHours   int
}

// PutAgentSettings saves an agent's settings in tx (the caller checks
// access and audits). expectedRevision is the If-Match revision.
func PutAgentSettings(ctx context.Context, tx pgx.Tx, agentID uuid.UUID, in AgentInput, expectedRevision int64, by uuid.NullUUID) (before, after AgentSettings, err error) {
	if in.ExpiryHours < MinExpiryHours || in.ExpiryHours > MaxExpiryHours {
		return before, after, apperr.Invalid("invalid_expiry", "The time limit must be between 1 and 720 hours")
	}
	// The row is created first, so concurrent saves serialise on it.
	if _, err := tx.Exec(ctx, `INSERT INTO agent_answer_cache (agent_id) VALUES ($1) ON CONFLICT DO NOTHING`, agentID); err != nil {
		return before, after, err
	}
	if before, err = agentSettings(ctx, tx, agentID, true); err != nil {
		return before, after, err
	}
	if before.Revision != expectedRevision {
		return before, after, apperr.Stale()
	}
	var at time.Time
	after = AgentSettings{}
	err = tx.QueryRow(ctx, `UPDATE agent_answer_cache SET enabled = $2, near_identical = $3, expiry_hours = $4, revision = revision + 1,
		updated_by = $5, updated_at = now() WHERE agent_id = $1 RETURNING enabled, near_identical, expiry_hours, revision, updated_at`,
		agentID, in.Enabled, in.NearIdentical, in.ExpiryHours, by).Scan(&after.Enabled, &after.NearIdentical, &after.ExpiryHours, &after.Revision, &at)
	after.UpdatedAt = &at
	return before, after, err
}

// Stats are an agent's live entries and their hits.
type Stats struct {
	Entries, Hits int64
}

// AgentStats counts an agent's entries that haven't expired.
func (s *Service) AgentStats(ctx context.Context, agentID uuid.UUID) (Stats, error) {
	var st Stats
	err := s.pool.QueryRow(ctx, `SELECT count(*), coalesce(sum(hits), 0) FROM answer_cache WHERE agent_id = $1 AND expires_at > now()`,
		agentID).Scan(&st.Entries, &st.Hits)
	return st, err
}

// Clear deletes every entry of an agent in tx and returns how many.
func Clear(ctx context.Context, tx pgx.Tx, agentID uuid.UUID) (int64, error) {
	tag, err := tx.Exec(ctx, `DELETE FROM answer_cache WHERE agent_id = $1`, agentID)
	return tag.RowsAffected(), err
}
