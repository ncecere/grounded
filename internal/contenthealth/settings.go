package contenthealth

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Settings are the platform's content health settings: the switch, off by default.
type Settings struct {
	Enabled   bool
	Revision  int64
	UpdatedAt time.Time
}

func settingsOf(r dbgen.ContentHealthSetting) Settings {
	return Settings{Enabled: r.Enabled, Revision: r.Revision, UpdatedAt: r.UpdatedAt}
}

// Enabled reports whether content health reports are switched on.
func (s *Service) Enabled(ctx context.Context) (bool, error) { return s.enabled(ctx) }

// Settings returns the switch (platform admins and auditors). It is all platform staff see of this feature.
func (s *Service) Settings(ctx context.Context, a authz.Actor) (Settings, error) {
	if a.Delegated() || !a.CanReadPlatform() {
		return Settings{}, errStaffRead
	}
	r, err := s.q.GetContentHealthSettings(ctx)
	return settingsOf(r), err
}

// SetEnabled turns the feature on or off (platform admins; audited).
func (s *Service) SetEnabled(ctx context.Context, a authz.Actor, enabled bool, expectedRevision int64) (Settings, error) {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return Settings{}, errAdminOnly
	}
	var out Settings
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockContentHealthSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if cur.Enabled == enabled {
			out = settingsOf(cur)
			return nil
		}
		by := uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
		row, err := q.SetContentHealthSettings(ctx, dbgen.SetContentHealthSettingsParams{Enabled: enabled, UpdatedBy: by})
		if err != nil {
			return err
		}
		out = settingsOf(row)
		e := a.Audit("platform.content_health", "content_health_settings", "settings")
		e.Before, e.After = map[string]any{"enabled": cur.Enabled}, map[string]any{"enabled": row.Enabled}
		return audit.Record(ctx, q, e)
	})
	return out, err
}
