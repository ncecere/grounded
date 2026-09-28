// Platform settings: the global switch for public agents
// (docs/phase4-publishing.md §7, ADR-0009 "platform controls").

package platform

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Settings are the platform-wide switches.
type Settings = dbgen.PlatformSetting

// Settings returns the platform settings (anyone; they are not secret).
func (s *Service) Settings(ctx context.Context) (Settings, error) {
	return s.q.GetPlatformSettings(ctx)
}

// PublicAgentsEnabled reports the global public switch.
func (s *Service) PublicAgentsEnabled(ctx context.Context) (bool, error) {
	st, err := s.q.GetPlatformSettings(ctx)
	return st.PublicAgentsEnabled, err
}

// SetPublicAgentsEnabled turns public agents on or off (platform admins;
// audited). expectedRevision is the If-Match revision.
func (s *Service) SetPublicAgentsEnabled(ctx context.Context, a authz.Actor, enabled bool, expectedRevision int64) (Settings, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Settings{}, errAdminOnly
	}
	var out Settings
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockPlatformSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if cur.PublicAgentsEnabled == enabled {
			out = cur
			return nil
		}
		if out, err = q.SetPublicAgentsEnabled(ctx, dbgen.SetPublicAgentsEnabledParams{
			Enabled: enabled, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		}); err != nil {
			return err
		}
		e := a.Audit("platform.public_access", "platform_settings", "public_agents_enabled")
		e.Before = map[string]any{"publicAgentsEnabled": cur.PublicAgentsEnabled}
		e.After = map[string]any{"publicAgentsEnabled": enabled}
		return audit.Record(ctx, q, e)
	})
	return out, err
}
