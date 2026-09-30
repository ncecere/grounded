package mcpclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Tools: Refresh reads a server's tool list (tools/list) and stores it. A
// tool is new (unapproved), unchanged (its approval stands), changed (its
// title, description or input schema differ: unapproved again, because the
// description and schema are prompts the model reads) or gone (the server no
// longer lists it: marked gone and unapproved). Approve and Unapprove are a
// platform admin's decision per tool.

// Tool is a stored tool with who approved it.
type Tool = dbgen.ListMCPServerToolsRow

// ListTools lists a server's tools, listed ones first.
func (s *Service) ListTools(ctx context.Context, a authz.Actor, serverID uuid.UUID) ([]Tool, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	if _, err := s.server(ctx, serverID); err != nil {
		return nil, err
	}
	return s.q.ListMCPServerTools(ctx, serverID)
}

// ToolUse is an agent whose published version uses one of a server's tools.
type ToolUse = dbgen.MCPServerToolPublishedUsesRow

// ToolUses lists, per tool of a server, the agents whose published version
// uses it, so the admin sees who loses a tool before withdrawing its
// approval (platform admins and auditors).
func (s *Service) ToolUses(ctx context.Context, a authz.Actor, serverID uuid.UUID) (map[uuid.UUID][]ToolUse, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	rows, err := s.q.MCPServerToolPublishedUses(ctx, serverID)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID][]ToolUse, len(rows))
	for _, r := range rows {
		out[r.ToolID] = append(out[r.ToolID], r)
	}
	return out, nil
}

// RefreshSummary counts what a refresh changed.
type RefreshSummary struct {
	Listed, Added, Changed, Gone int
}

// Refresh fetches a server's tool list and stores it (platform admins; the
// server may be disabled). A failure to reach the server is a 502
// mcp_server_unreachable with its class and message. Audited as
// mcp_server.refresh with the counts and the names of tools that lost
// their approval.
func (s *Service) Refresh(ctx context.Context, a authz.Actor, id uuid.UUID) (RefreshSummary, []Tool, error) {
	if !a.IsPlatformAdmin() {
		return RefreshSummary{}, nil, errAdminOnly
	}
	sv, err := s.server(ctx, id)
	if err != nil {
		return RefreshSummary{}, nil, err
	}
	t, err := s.target(sv.McpServer)
	if err != nil {
		return RefreshSummary{}, nil, unreachable(err)
	}
	listed, err := s.listTools(ctx, t)
	if err != nil {
		return RefreshSummary{}, nil, unreachable(err)
	}
	var sum RefreshSummary
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if _, err := q.LockMCPServer(ctx, id); err != nil {
			return store.NotFound(err)
		}
		var unapproved []string
		sum, unapproved, err = storeTools(ctx, q, id, listed)
		if err != nil {
			return err
		}
		if err := q.TouchMCPServerTools(ctx, id); err != nil {
			return err
		}
		e := a.Audit("mcp_server.refresh", "mcp_server", id.String())
		e.Metadata = map[string]any{"name": sv.Name, "listed": sum.Listed, "added": sum.Added, "changed": sum.Changed,
			"gone": sum.Gone, "unapproved": unapproved}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return sum, nil, err
	}
	tools, err := s.q.ListMCPServerTools(ctx, id)
	return sum, tools, err
}

// storeTools upserts the listed tools and marks the others gone. It
// returns the names of approved tools that lost their approval.
func storeTools(ctx context.Context, q *dbgen.Queries, id uuid.UUID, listed []ListedTool) (RefreshSummary, []string, error) {
	sum := RefreshSummary{Listed: len(listed)}
	unapproved := []string{}
	before, err := q.ListMCPServerTools(ctx, id)
	if err != nil {
		return sum, nil, err
	}
	prev := map[string]Tool{}
	for _, t := range before {
		prev[t.Name] = t
	}
	names := make([]string, 0, len(listed))
	for _, lt := range listed {
		if lt.Name == "" || len([]rune(lt.Name)) > maxToolName {
			continue
		}
		names = append(names, lt.Name)
		old, existed := prev[lt.Name]
		same := existed && old.GoneAt == nil && old.Title == lt.Title && old.Description == lt.Description && sameJSON(old.InputSchema, lt.InputSchema)
		switch {
		case !existed:
			sum.Added++
		case !same:
			sum.Changed++
			if old.Approved {
				unapproved = append(unapproved, lt.Name)
			}
		}
		if _, err := q.UpsertMCPServerTool(ctx, dbgen.UpsertMCPServerToolParams{ServerID: id, Name: lt.Name, Title: lt.Title,
			Description: lt.Description, InputSchema: lt.InputSchema, KeepApproval: same}); err != nil {
			return sum, nil, err
		}
	}
	gone, err := q.MarkMCPServerToolsGone(ctx, dbgen.MarkMCPServerToolsGoneParams{ServerID: id, Listed: names})
	if err != nil {
		return sum, nil, err
	}
	sum.Gone = len(gone)
	for _, g := range gone {
		if prev[g.Name].Approved {
			unapproved = append(unapproved, g.Name)
		}
	}
	return sum, unapproved, nil
}

// sameJSON compares two JSON documents by value.
func sameJSON(a, b json.RawMessage) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return bytes.Equal(a, b)
	}
	ca, _ := json.Marshal(x)
	cb, _ := json.Marshal(y)
	return bytes.Equal(ca, cb)
}

// unreachable is the refresh's error when the server couldn't be read.
func unreachable(err error) error {
	var e *Error
	if !errors.As(err, &e) {
		return err
	}
	out := apperr.New(502, "mcp_server_unreachable", e.Message)
	out.Details = map[string]any{"class": e.Class}
	return out
}

// SetApproval approves or unapproves a tool (platform admins). A tool the
// server no longer lists can't be approved. Audited as mcp_tool.approve or
// mcp_tool.unapprove.
func (s *Service) SetApproval(ctx context.Context, a authz.Actor, serverID, toolID uuid.UUID, approved bool) (dbgen.McpServerTool, error) {
	if !a.IsPlatformAdmin() {
		return dbgen.McpServerTool{}, errAdminOnly
	}
	var out dbgen.McpServerTool
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockMCPServerTool(ctx, dbgen.LockMCPServerToolParams{ID: toolID, ServerID: serverID})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoTool
		} else if err != nil {
			return err
		}
		if approved && cur.GoneAt != nil {
			return apperr.Conflict("mcp_tool_gone", "The server no longer lists this tool. Refresh the tools first.")
		}
		p := dbgen.SetMCPServerToolApprovalParams{ID: toolID, ServerID: serverID, Approved: approved}
		if approved {
			p.ApprovedBy = by(a)
		}
		if out, err = q.SetMCPServerToolApproval(ctx, p); err != nil {
			return err
		}
		action := "mcp_tool.unapprove"
		if approved {
			action = "mcp_tool.approve"
		}
		e := a.Audit(action, "mcp_tool", toolID.String())
		e.Before, e.After = map[string]any{"approved": cur.Approved}, map[string]any{"approved": approved}
		e.Metadata = map[string]any{"serverId": serverID, "tool": cur.Name}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// TestResult is the outcome of testing a server: its tool list was read.
type TestResult struct {
	OK        bool
	Latency   time.Duration
	ToolCount int
	Err       *Error
}

// probe reads a server's tool list without storing anything: the cheap
// call behind Test and the health job (never tools/call).
func (s *Service) probe(ctx context.Context, sv dbgen.McpServer) TestResult {
	start := time.Now()
	t, err := s.target(sv)
	if err == nil {
		var tools []ListedTool
		tools, err = s.listTools(ctx, t)
		if err == nil {
			return TestResult{OK: true, Latency: time.Since(start), ToolCount: len(tools)}
		}
	}
	res := TestResult{Latency: time.Since(start)}
	if !errors.As(err, &res.Err) {
		res.Err = &Error{Class: ClassUnavailable, Message: fmt.Sprintf("The test failed: %v", err)}
	}
	return res
}
