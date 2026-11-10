package teamrequests

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/ssogroups"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Settings are the platform's team request settings.
type Settings struct {
	Enabled bool
	// MaxOpen is how many pending requests one person may have.
	MaxOpen int
	// AllowedGroup is the SSO group a person must be in to ask ("": anyone signed in).
	AllowedGroup string
	Revision     int64
	UpdatedAt    time.Time
}

func settingsOf(row dbgen.TeamRequestSetting) Settings {
	return Settings{Enabled: row.Enabled, MaxOpen: int(row.MaxOpen), AllowedGroup: row.AllowedGroup, Revision: row.Revision, UpdatedAt: row.UpdatedAt}
}

// Enabled reports the platform switch.
func (s *Service) Enabled(ctx context.Context) (bool, error) {
	row, err := s.q.GetTeamRequestSettings(ctx)
	return row.Enabled, err
}

// Settings returns the settings (platform admins and auditors).
func (s *Service) Settings(ctx context.Context, a authz.Actor) (Settings, error) {
	if a.Delegated() || !a.CanReadPlatform() {
		return Settings{}, apperr.Forbidden("Only platform admins and auditors can see this setting")
	}
	row, err := s.q.GetTeamRequestSettings(ctx)
	return settingsOf(row), err
}

// SettingsInput changes the settings.
type SettingsInput struct {
	Enabled      bool
	MaxOpen      int
	AllowedGroup string
}

// SetSettings changes the switch and the limits (platform admins; audited).
func (s *Service) SetSettings(ctx context.Context, a authz.Actor, in SettingsInput, expectedRevision int64) (Settings, error) {
	if a.Delegated() || !a.IsPlatformAdmin() {
		return Settings{}, apperr.Forbidden("Only platform admins can change team requests")
	}
	if in.MaxOpen < 1 || in.MaxOpen > 20 {
		return Settings{}, apperr.Invalid("invalid_max_open", "Open requests per person must be between 1 and 20")
	}
	group := ""
	if g := ssogroups.NormalizeGroups([]string{in.AllowedGroup}); len(g) == 1 {
		group = g[0]
	} else if strings.TrimSpace(in.AllowedGroup) != "" {
		return Settings{}, apperr.Invalid("invalid_group", "Enter one SSO group name, or leave it empty to let anyone signed in ask")
	}
	var out Settings
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockTeamRequestSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if cur.Enabled == in.Enabled && int(cur.MaxOpen) == in.MaxOpen && cur.AllowedGroup == group {
			out = settingsOf(cur)
			return nil
		}
		row, err := q.SetTeamRequestSettings(ctx, dbgen.SetTeamRequestSettingsParams{
			Enabled: in.Enabled, MaxOpen: int32(in.MaxOpen), AllowedGroup: group, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		})
		if err != nil {
			return err
		}
		out = settingsOf(row)
		e := a.Audit("platform.team_requests", "team_request_settings", "settings")
		e.Before = map[string]any{"enabled": cur.Enabled, "maxOpen": cur.MaxOpen, "allowedGroup": cur.AllowedGroup}
		e.After = map[string]any{"enabled": row.Enabled, "maxOpen": row.MaxOpen, "allowedGroup": row.AllowedGroup}
		return audit.Record(ctx, q, e)
	})
	return out, err
}
