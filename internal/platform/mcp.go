// The MCP server's platform switch (docs/v0.3.0.md §3, docs/mcp.md): off
// until a platform admin turns it on; while off, POST /mcp answers 404.

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

// mcpSwitch caches the switch for /mcp, which reads it on every request.
type mcpSwitch struct {
	mu sync.Mutex
	on bool
	at time.Time
}

var errMCPAdminOnly = apperr.Forbidden("Only platform admins can turn the MCP server on or off")

// MCPEnabled reports whether the MCP server is on (cached briefly).
func (s *Service) MCPEnabled(ctx context.Context) (bool, error) {
	s.mcp.mu.Lock()
	defer s.mcp.mu.Unlock()
	if !s.mcp.at.IsZero() && time.Since(s.mcp.at) < mcpSwitchTTL {
		return s.mcp.on, nil
	}
	st, err := s.q.GetMCPSettings(ctx)
	if err != nil {
		return false, err
	}
	s.mcp.on, s.mcp.at = st.Enabled, time.Now()
	return st.Enabled, nil
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
		if cur.Enabled == enabled {
			out = cur
			return nil
		}
		if out, err = q.SetMCPEnabled(ctx, dbgen.SetMCPEnabledParams{
			Enabled: enabled, UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		}); err != nil {
			return err
		}
		e := a.Audit("platform.mcp", "mcp_settings", "enabled")
		e.Before, e.After = map[string]any{"enabled": cur.Enabled}, map[string]any{"enabled": enabled}
		return audit.Record(ctx, q, e)
	})
	if err == nil {
		s.mcp.mu.Lock()
		s.mcp.on, s.mcp.at = out.Enabled, time.Now()
		s.mcp.mu.Unlock()
	}
	return out, err
}
