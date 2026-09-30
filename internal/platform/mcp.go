// The MCP server's platform switch (docs/v0.3.0.md §3, docs/mcp.md): off
// until a platform admin turns it on; while off, POST /mcp answers 404. Its
// second setting, OAuth sign-in for MCP clients (experimental, off by
// default), only takes effect while the server is on.

package platform

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// MCPSettings is the MCP server's switch.
type MCPSettings = dbgen.McpSetting

// mcpSwitchTTL is how long a process trusts its cached switch: turning the
// server off reaches the other processes within this time (this one at once).
const mcpSwitchTTL = 5 * time.Second

// mcpSwitch caches the switches for /mcp, which reads them on every request.
type mcpSwitch struct {
	mu    sync.Mutex
	on    bool
	oauth bool
	at    time.Time
}

var errMCPAdminOnly = apperr.Forbidden("Only platform admins can turn the MCP server or its OAuth sign-in on or off")

// mcpSwitches reads both switches (cached briefly).
func (s *Service) mcpSwitches(ctx context.Context) (on, oauth bool, err error) {
	s.mcp.mu.Lock()
	defer s.mcp.mu.Unlock()
	if !s.mcp.at.IsZero() && time.Since(s.mcp.at) < mcpSwitchTTL {
		return s.mcp.on, s.mcp.oauth, nil
	}
	st, err := s.q.GetMCPSettings(ctx)
	if err != nil {
		return false, false, err
	}
	s.mcp.on, s.mcp.oauth, s.mcp.at = st.Enabled, st.OauthEnabled, time.Now()
	return st.Enabled, st.OauthEnabled, nil
}

// MCPEnabled reports whether the MCP server is on (cached briefly).
func (s *Service) MCPEnabled(ctx context.Context) (bool, error) {
	on, _, err := s.mcpSwitches(ctx)
	return on, err
}

// MCPOAuthEnabled reports whether OAuth sign-in for MCP clients is in
// effect: its setting is on and so is the MCP server (cached briefly).
func (s *Service) MCPOAuthEnabled(ctx context.Context) (bool, error) {
	on, oauth, err := s.mcpSwitches(ctx)
	return on && oauth, err
}

// MCPSettings returns the switch (platform admins and auditors).
func (s *Service) MCPSettings(ctx context.Context, a authz.Actor) (MCPSettings, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return MCPSettings{}, errReadOnly
	}
	return s.q.GetMCPSettings(ctx)
}

// SetMCPEnabled turns the MCP server on or off (platform admins; audited as
// platform.mcp). expectedRevision is the If-Match revision.
func (s *Service) SetMCPEnabled(ctx context.Context, a authz.Actor, enabled bool, expectedRevision int64) (MCPSettings, error) {
	return s.SetMCPSettings(ctx, a, MCPSettingsUpdate{Enabled: enabled}, expectedRevision)
}

// MCPSettingsUpdate changes the switches; a nil OAuth keeps that setting.
type MCPSettingsUpdate struct {
	Enabled bool
	OAuth   *bool
}

// SetMCPSettings turns the MCP server and its OAuth sign-in on or off
// (platform admins; audited as platform.mcp and platform.mcp_oauth).
// expectedRevision is the If-Match revision.
func (s *Service) SetMCPSettings(ctx context.Context, a authz.Actor, in MCPSettingsUpdate, expectedRevision int64) (MCPSettings, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return MCPSettings{}, errMCPAdminOnly
	}
	var out MCPSettings
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockMCPSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		oauth := cur.OauthEnabled
		if in.OAuth != nil {
			oauth = *in.OAuth
		}
		if cur.Enabled == in.Enabled && cur.OauthEnabled == oauth {
			out = cur
			return nil
		}
		if out, err = q.SetMCPSettings(ctx, dbgen.SetMCPSettingsParams{
			Enabled: in.Enabled, OauthEnabled: oauth, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		}); err != nil {
			return err
		}
		if cur.Enabled != in.Enabled {
			e := a.Audit("platform.mcp", "mcp_settings", "enabled")
			e.Before, e.After = map[string]any{"enabled": cur.Enabled}, map[string]any{"enabled": in.Enabled}
			if err := audit.Record(ctx, q, e); err != nil {
				return err
			}
		}
		if cur.OauthEnabled == oauth {
			return nil
		}
		e := a.Audit("platform.mcp_oauth", "mcp_settings", "oauth")
		e.Before, e.After = map[string]any{"oauthEnabled": cur.OauthEnabled}, map[string]any{"oauthEnabled": oauth}
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.mcp.mu.Lock()
		s.mcp.on, s.mcp.oauth, s.mcp.at = out.Enabled, out.OauthEnabled, time.Now()
		s.mcp.mu.Unlock()
	}
	return out, err
}
