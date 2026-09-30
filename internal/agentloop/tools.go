package agentloop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/ncecere/grounded/internal/llm"
)

// Mode is a tool's execution mode.
type Mode string

const (
	// Parallel tools in one assistant message run concurrently (the default).
	Parallel Mode = "parallel"
	// Sequential: if any call in a message is to a sequential tool, all calls
	// in that message run one at a time, in order.
	Sequential Mode = "sequential"
)

// ToolResult is what a tool returns. Content is sent to the model; Details is
// for the application (for example retrieval hits for citations) and is
// never sent.
type ToolResult struct {
	Content string
	Details any
	IsError bool
}

// ExecuteFunc runs a tool. params has been validated against the tool's
// schema. onUpdate may be called with partial results while it runs (it is
// ignored once Execute returns). An error becomes an isError result for the
// model; it never ends the loop.
type ExecuteFunc func(ctx context.Context, callID string, params json.RawMessage, onUpdate func(ToolResult)) (ToolResult, error)

// Tool is a function the model may call.
type Tool struct {
	Name        string
	Label       string // human-readable, for UIs
	Description string
	Parameters  json.RawMessage // JSON Schema (draft 2020-12) for the arguments object; nil = any object
	Mode        Mode
	Execute     ExecuteFunc
}

// CheckTool reports whether a tool would be accepted by Run: a name, an
// Execute, a known mode and a parameters schema that compiles (external
// references are refused). Callers that build tools from outside data (MCP
// servers' input schemas) check each one first, so one bad schema doesn't
// fail the whole run.
func CheckTool(t Tool) error {
	_, err := compileTools([]Tool{t})
	return err
}

// compiledTool is a Tool with its schema compiled.
type compiledTool struct {
	Tool
	schema   *jsonschema.Schema
	required map[string]bool
}

type noLoader struct{}

func (noLoader) Load(url string) (any, error) {
	return nil, fmt.Errorf("external schema references are not allowed: %s", url)
}

func compileTools(tools []Tool) (map[string]*compiledTool, error) {
	out := make(map[string]*compiledTool, len(tools))
	for _, t := range tools {
		if t.Name == "" {
			return nil, errors.New("agentloop: tool without a name")
		}
		if out[t.Name] != nil {
			return nil, fmt.Errorf("agentloop: duplicate tool %q", t.Name)
		}
		if t.Execute == nil {
			return nil, fmt.Errorf("agentloop: tool %q has no Execute", t.Name)
		}
		if t.Mode != "" && t.Mode != Parallel && t.Mode != Sequential {
			return nil, fmt.Errorf("agentloop: tool %q has unknown mode %q", t.Name, t.Mode)
		}
		params := t.Parameters
		if len(params) == 0 {
			params = json.RawMessage(`{"type":"object"}`)
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(params))
		if err != nil {
			return nil, fmt.Errorf("agentloop: tool %q parameters: %w", t.Name, err)
		}
		c := jsonschema.NewCompiler()
		c.UseLoader(noLoader{})
		url := "mem://tools/" + t.Name + ".json"
		if err := c.AddResource(url, doc); err != nil {
			return nil, fmt.Errorf("agentloop: tool %q parameters: %w", t.Name, err)
		}
		sch, err := c.Compile(url)
		if err != nil {
			return nil, fmt.Errorf("agentloop: tool %q parameters: %w", t.Name, err)
		}
		var shape struct {
			Required []string `json:"required"`
		}
		_ = json.Unmarshal(params, &shape)
		req := map[string]bool{}
		for _, r := range shape.Required {
			req[r] = true
		}
		out[t.Name] = &compiledTool{Tool: t, schema: sch, required: req}
	}
	return out, nil
}

// validate checks the model's arguments. Optional top-level properties set
// to null are dropped first (models often send "maxResults": null for "not
// given"). It returns the arguments to pass to Execute.
func (t *compiledTool) validate(args json.RawMessage) (json.RawMessage, error) {
	raw := bytes.TrimSpace(args)
	if len(raw) == 0 || string(raw) == "null" {
		raw = []byte("{}")
	}
	if raw[0] == '"' {
		var s string
		_ = json.Unmarshal(raw, &s)
		return nil, fmt.Errorf("arguments for tool %q are not valid JSON: %s", t.Name, truncate(s, 500))
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, fmt.Errorf("arguments for tool %q must be a JSON object, got: %s", t.Name, truncate(string(raw), 500))
	}
	changed := false
	for k, v := range obj {
		if string(v) == "null" && !t.required[k] {
			delete(obj, k)
			changed = true
		}
	}
	if changed {
		raw, _ = json.Marshal(obj)
	}
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("arguments for tool %q are not valid JSON", t.Name)
	}
	if err := t.schema.Validate(inst); err != nil {
		return nil, fmt.Errorf("validation failed for tool %q:\n%s\n\nreceived arguments:\n%s",
			t.Name, describeValidation(err), truncate(string(args), 1000))
	}
	return raw, nil
}

func describeValidation(err error) string {
	var ve *jsonschema.ValidationError
	if !errors.As(err, &ve) {
		return err.Error()
	}
	// Drop the "jsonschema validation failed with 'mem://…'" header line.
	msg := ve.Error()
	if _, rest, ok := strings.Cut(msg, "\n"); ok {
		msg = rest
	}
	return strings.TrimSpace(msg)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// toolDecls is the tool list sent to the model, in configuration order.
func toolDecls(tools []Tool) []llm.Tool {
	out := make([]llm.Tool, len(tools))
	for i, t := range tools {
		out[i] = llm.Tool{Name: t.Name, Description: t.Description, Parameters: t.Parameters}
	}
	return out
}
