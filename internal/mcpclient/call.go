package mcpclient

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/tracing"
)

// Calls from agents (internal/agents). The agent chooses its tools from
// UsableTools; publishing and every answer check them with ToolsByID; each
// call goes through Call, which checks the server again (enabled, the
// ceiling) right before it is made.

// UsableTool is an approved tool of an enabled server.
type UsableTool = dbgen.ListUsableMCPToolsRow

// UsableTools lists the tools editors may choose (approved, listed by an
// enabled server). Everyone who can edit an agent may read them: names and
// descriptions only, never the server's URL or credentials.
func (s *Service) UsableTools(ctx context.Context) ([]UsableTool, error) {
	return s.q.ListUsableMCPTools(ctx)
}

// ToolRef is a tool with its server, as agents see it.
type ToolRef = dbgen.MCPToolsByIDsRow

// ToolsByID loads tools with their servers (missing ones are absent).
func (s *Service) ToolsByID(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]ToolRef, error) {
	out := map[uuid.UUID]ToolRef{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.q.MCPToolsByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ID] = r
	}
	return out, nil
}

// Call outcomes (grounded_mcp_client_calls_total and the audit entry).
const (
	OutcomeOK        = "ok"
	OutcomeToolError = "tool_error" // the tool answered with isError
	OutcomeRefused   = "refused"    // not called: disabled, ceiling, input request
	OutcomeTimeout   = "timeout"
	OutcomeTooLarge  = "too_large"
	OutcomeError     = "error"
)

// Refusal is a call that was not made (or whose answer was refused): the
// server is disabled or gone, the agent's data is above its ceiling, or it
// asked for input.
type Refusal struct{ Reason, Message string }

func (r *Refusal) Error() string { return r.Message }

// Refusal reasons.
const (
	RefusedDisabled = "disabled"
	RefusedCeiling  = "ceiling"
	RefusedInput    = "input_required"
)

// CallRequest is one tool call of an agent.
type CallRequest struct {
	ServerID uuid.UUID
	Tool     string
	// Arguments are the model's arguments, exactly (never the conversation).
	Arguments json.RawMessage
	// Rank is the classification rank of the agent's data: the call is
	// refused when it is above the server's ceiling.
	Rank int32
}

// CallOutcome is a call's result and what the audit entry records.
type CallOutcome struct {
	Result   CallResult
	Outcome  string
	Duration time.Duration
	// ServerName is the server's name as the call found it.
	ServerName string
}

// Call checks the server and calls the tool. err is a *Refusal, an *Error
// or a database error; the outcome is set either way.
func (s *Service) Call(ctx context.Context, req CallRequest) (out CallOutcome, err error) {
	// The tool and server names are the registry's; the arguments and the
	// result are never recorded (only the result's size).
	ctx, span := tracing.StartKind(ctx, "tools/call "+req.Tool, trace.SpanKindClient, attribute.String("mcp.method.name", "tools/call"),
		attribute.String("gen_ai.tool.name", req.Tool), attribute.String("grounded.mcp.server_id", req.ServerID.String()))
	defer func() { endCallSpan(span, out) }()
	start := time.Now()
	out = CallOutcome{Outcome: OutcomeRefused}
	row, err := s.q.MCPServerCallTarget(ctx, req.ServerID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return out, &Refusal{RefusedDisabled, "This tool's server was removed."}
	} else if err != nil {
		out.Outcome = OutcomeError
		return out, err
	}
	out.ServerName = row.Name
	defer func() { observability.ObserveMCPClientCall(row.Name, req.Tool, out.Outcome, out.Duration) }()
	switch {
	case !row.Enabled:
		return out, &Refusal{RefusedDisabled, "This tool's server is turned off."}
	case row.MaxRank < req.Rank:
		return out, &Refusal{RefusedCeiling, "This tool's server is not approved for this agent's data."}
	}
	t, err := s.target(dbgen.McpServer{ID: row.ID, Name: row.Name, URL: row.URL, AuthHeaderName: row.AuthHeaderName,
		AuthValueCipher: row.AuthValueCipher, TimeoutSeconds: row.TimeoutSeconds})
	if err == nil {
		out.Result, err = s.call(ctx, t, req.Tool, req.Arguments)
	}
	out.Duration = time.Since(start)
	out.Outcome = outcomeOf(out.Result, err)
	var e *Error
	if errors.As(err, &e) && e.Class == ClassInputRequired {
		return out, &Refusal{RefusedInput, e.Message}
	}
	return out, err
}

// endCallSpan records a call's server, outcome and result size.
func endCallSpan(span trace.Span, out CallOutcome) {
	span.SetAttributes(attribute.String("grounded.mcp.server", out.ServerName), attribute.String("grounded.mcp.outcome", out.Outcome),
		attribute.Int("grounded.mcp.result_bytes", out.Result.Size))
	if out.Outcome != OutcomeOK {
		tracing.Fail(span, out.Outcome)
	}
	span.End()
}

func outcomeOf(r CallResult, err error) string {
	var e *Error
	switch {
	case err == nil && r.IsError:
		return OutcomeToolError
	case err == nil:
		return OutcomeOK
	case errors.As(err, &e) && e.Class == ClassTimeout:
		return OutcomeTimeout
	case errors.As(err, &e) && e.Class == ClassTooLarge:
		return OutcomeTooLarge
	case errors.As(err, &e) && e.Class == ClassInputRequired:
		return OutcomeRefused
	}
	return OutcomeError
}
