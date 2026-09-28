package llm

import (
	"encoding/json"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Compat holds the resolved OpenAI-compatibility flags for one model (after
// pi's OpenAICompletionsCompat). Build it with ResolveCompat so every flag has
// its documented default.
type Compat struct {
	// SupportsDeveloperRole sends the system prompt with role "developer"
	// instead of "system". Default false.
	SupportsDeveloperRole bool
	// SupportsReasoningEffort sends Options.ReasoningEffort as
	// reasoning_effort. Default false (unknown fields break some proxies).
	SupportsReasoningEffort bool
	// SupportsStreamUsage sends stream_options.include_usage so the final
	// chunk carries usage. Default true.
	SupportsStreamUsage bool
	// MaxTokensField names the output limit field: "max_tokens" (default,
	// accepted by vLLM, LiteLLM and most proxies) or "max_completion_tokens".
	MaxTokensField string
	// SupportsToolChoice sends Options.ToolChoice. Default false: some
	// gateways (e.g. vLLM serving gpt-oss-120b) accept "required" but ignore it.
	SupportsToolChoice bool
	// ThinkingField is the delta field read as thinking: "reasoning_content"
	// or "reasoning". Empty (the default) reads whichever is present, first
	// non-empty of reasoning_content, reasoning, reasoning_text.
	ThinkingField string
	// ExtraBody is merged into every request (gateway.MergeExtra): server
	// extensions such as {"chat_template_kwargs": {"enable_thinking":
	// false}}. It never overrides a field Grounded sets. Default none.
	ExtraBody map[string]any
}

// CompatOverrides is the stored form of the flags: nil means "use the
// default". Its JSON matches catalog.Compat (the models.compat column).
type CompatOverrides struct {
	SupportsDeveloperRole   *bool          `json:"supportsDeveloperRole,omitempty"`
	SupportsReasoningEffort *bool          `json:"supportsReasoningEffort,omitempty"`
	SupportsStreamUsage     *bool          `json:"supportsStreamUsage,omitempty"`
	MaxTokensField          *string        `json:"maxTokensField,omitempty"`
	SupportsToolChoice      *bool          `json:"supportsToolChoice,omitempty"`
	ThinkingField           *string        `json:"thinkingField,omitempty"`
	ExtraBody               map[string]any `json:"extraBody,omitempty"`
	// SupportsDimensionsParam applies to embedding models (catalog.EmbedTarget);
	// chat ignores it.
	SupportsDimensionsParam *bool `json:"supportsDimensionsParam,omitempty"`
}

// ResolveCompat applies the defaults to stored overrides.
func ResolveCompat(o CompatOverrides) Compat {
	c := Compat{SupportsStreamUsage: true, MaxTokensField: "max_tokens"}
	if o.SupportsDeveloperRole != nil {
		c.SupportsDeveloperRole = *o.SupportsDeveloperRole
	}
	if o.SupportsReasoningEffort != nil {
		c.SupportsReasoningEffort = *o.SupportsReasoningEffort
	}
	if o.SupportsStreamUsage != nil {
		c.SupportsStreamUsage = *o.SupportsStreamUsage
	}
	if o.MaxTokensField != nil && (*o.MaxTokensField == "max_tokens" || *o.MaxTokensField == "max_completion_tokens") {
		c.MaxTokensField = *o.MaxTokensField
	}
	if o.SupportsToolChoice != nil {
		c.SupportsToolChoice = *o.SupportsToolChoice
	}
	if o.ThinkingField != nil && (*o.ThinkingField == "reasoning_content" || *o.ThinkingField == "reasoning") {
		c.ThinkingField = *o.ThinkingField
	}
	c.ExtraBody = o.ExtraBody
	return c
}

// DecodeCompat resolves the stored compat JSON. Invalid JSON gives the
// defaults.
func DecodeCompat(raw json.RawMessage) Compat {
	var o CompatOverrides
	_ = json.Unmarshal(raw, &o)
	return ResolveCompat(o)
}

// Model is a chat model as the runtime needs it.
type Model struct {
	ID              string // upstream model ID sent to the proxy
	ContextWindow   int    // tokens; 0 = unknown
	MaxOutputTokens int    // tokens; 0 = unknown
	SupportsTools   bool
	Compat          Compat
}

// ModelFromRow builds a Model from a catalog model row.
func ModelFromRow(m dbgen.Model) Model {
	out := Model{ID: m.UpstreamModel, SupportsTools: m.SupportsTools, Compat: DecodeCompat(m.Compat)}
	if m.ContextWindow != nil {
		out.ContextWindow = int(*m.ContextWindow)
	}
	if m.MaxOutputTokens != nil {
		out.MaxOutputTokens = int(*m.MaxOutputTokens)
	}
	return out
}

// UserTag is the OpenAI "user" value for agent traffic, so gateway spend
// reports line up with the usage ledger (DESIGN §10).
func UserTag(team, agent string) string {
	return "grounded-" + team + "-" + agent
}
