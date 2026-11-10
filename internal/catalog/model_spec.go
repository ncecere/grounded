package catalog

import (
	"context"
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Model kinds.
const (
	KindChat       = "chat"
	KindEmbedding  = "embedding"
	KindRerank     = "rerank"
	KindModeration = "moderation"
	// KindSystemOne is a SystemOne judgment model (ADR-0020): typed
	// questions over POST /v1/systemone.
	KindSystemOne = "systemone"
	// KindVision is a model that reads images over /chat/completions: the
	// OCR backend "vision" transcribes page images with it (docs/ocr.md §2).
	KindVision = "vision"
)

var (
	keyRE      = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,62}$`)
	validKinds = map[string]bool{KindChat: true, KindEmbedding: true, KindRerank: true, KindModeration: true, KindSystemOne: true, KindVision: true}
	errNoModel = apperr.NotFound("model_not_found", "Model not found")
)

// Compat holds OpenAI-compatibility flags for proxy quirks (ADR-0017, after
// pi's OpenAICompletionsCompat). Nil means "use the default"; internal/llm
// resolves the defaults. The JSON is stored as-is, so adding a flag needs no
// migration.
type Compat struct {
	SupportsDeveloperRole   *bool   `json:"supportsDeveloperRole,omitempty"`
	SupportsReasoningEffort *bool   `json:"supportsReasoningEffort,omitempty"`
	SupportsStreamUsage     *bool   `json:"supportsStreamUsage,omitempty"`
	MaxTokensField          *string `json:"maxTokensField,omitempty"` // "max_tokens" or "max_completion_tokens"
	// SupportsToolChoice: the proxy honours tool_choice (for example
	// "required"). Default false: some servers accept it but ignore it.
	SupportsToolChoice *bool `json:"supportsToolChoice,omitempty"`
	// ThinkingField is the streamed delta field carrying reasoning:
	// "reasoning_content" or "reasoning". Default: whichever is present.
	ThinkingField *string `json:"thinkingField,omitempty"`
	// ThinkingOff (chat models) is how to turn thinking off when an
	// answer's reasoning effort is off: "reasoning_effort_none" or
	// "enable_thinking_false" (Qwen3 on vLLM or SGLang). Default: not
	// supported.
	ThinkingOff *string `json:"thinkingOff,omitempty"`
	// SupportsDimensionsParam (embedding models): the server accepts the
	// OpenAI "dimensions" parameter, so a profile with fewer output
	// dimensions asks for them. Default false: Grounded truncates the vectors
	// and L2-renormalises them itself (Matryoshka models; DESIGN.md §10).
	SupportsDimensionsParam *bool `json:"supportsDimensionsParam,omitempty"`
	// RerankDocumentsField (rerank models) is the request field carrying
	// the documents: "documents" (the default; Cohere, Jina, LiteLLM, vLLM,
	// SGLang) or "texts" (Hugging Face text embeddings inference).
	RerankDocumentsField *string `json:"rerankDocumentsField,omitempty"`
	// SupportsRerankTopN (rerank models): send top_n, the number of
	// results wanted. Default true; false for servers that reject it.
	SupportsRerankTopN *bool `json:"supportsRerankTopN,omitempty"`
	// ExtraBody (chat and moderation models) is merged into every chat
	// completion request, e.g. {"chat_template_kwargs": {"enable_thinking":
	// false}}. It cannot set the fields Grounded controls
	// (gateway.ReservedChatField).
	ExtraBody map[string]any `json:"extraBody,omitempty"`
}

// MaxExtraBodyBytes bounds a model's extraBody (as compact JSON).
const MaxExtraBodyBytes = 4096

func (c Compat) validate() error {
	if c.MaxTokensField != nil && *c.MaxTokensField != "max_tokens" && *c.MaxTokensField != "max_completion_tokens" {
		return apperr.Invalid("invalid_compat", "maxTokensField must be max_tokens or max_completion_tokens")
	}
	if c.ThinkingField != nil && *c.ThinkingField != "reasoning_content" && *c.ThinkingField != "reasoning" {
		return apperr.Invalid("invalid_compat", "thinkingField must be reasoning_content or reasoning")
	}
	if c.ThinkingOff != nil && !llm.ValidThinkingOff(*c.ThinkingOff) {
		return apperr.Invalid("invalid_compat", "thinkingOff must be reasoning_effort_none or enable_thinking_false")
	}
	if f := c.RerankDocumentsField; f != nil && *f != "documents" && *f != "texts" {
		return apperr.Invalid("invalid_compat", "rerankDocumentsField must be documents or texts")
	}
	return validateExtraBody(c.ExtraBody)
}

func validateExtraBody(extra map[string]any) error {
	if len(extra) == 0 {
		return nil
	}
	keys := make([]string, 0, len(extra))
	for k := range extra {
		if gateway.ReservedChatField(k) || strings.TrimSpace(k) == "" {
			keys = append(keys, strconv.Quote(k))
		}
	}
	if len(keys) > 0 {
		slices.Sort(keys)
		return apperr.Invalid("invalid_extra_body",
			"extraBody cannot set "+strings.Join(keys, ", ")+": Grounded sets these fields itself")
	}
	if raw, err := json.Marshal(extra); err != nil || len(raw) > MaxExtraBodyBytes {
		return apperr.Invalid("invalid_extra_body", "extraBody must be a JSON object of at most 4096 bytes")
	}
	return nil
}

// DecodeCompat reads the stored compat JSON.
func DecodeCompat(raw json.RawMessage) Compat {
	var c Compat
	_ = json.Unmarshal(raw, &c)
	return c
}

// ModelSpec is the editable part of a model.
type ModelSpec struct {
	UpstreamModel, DisplayName, Description, MaxClassification string
	Enabled                                                    bool
	ContextWindow, MaxOutputTokens                             *int32
	SupportsTools, SupportsVision                              bool
	Dimensions, MaxInputTokens                                 *int32
	Compat                                                     Compat
	// Moderation models only (ADR-0019): how the model is called, and the
	// guardrail family for guardrail_chat.
	ModerationProvider, ModerationFamily string
	// ModerationTimeoutSeconds bounds one attempt of a check (1-120); nil
	// uses the platform default (docs/ui-review F-01).
	ModerationTimeoutSeconds *int32
}

// ModelInput creates a model. Key, kind and connection are fixed afterwards.
type ModelInput struct {
	ConnectionID uuid.UUID
	Key, Kind    string
	ModelSpec
}

// ModelUpdate holds optional changes.
type ModelUpdate struct {
	UpstreamModel, DisplayName, Description, MaxClassification *string
	Enabled                                                    *bool
	ContextWindow, MaxOutputTokens                             *int32
	SupportsTools, SupportsVision                              *bool
	Dimensions, MaxInputTokens                                 *int32
	Compat                                                     *Compat
	ModerationProvider, ModerationFamily                       *string
	// ModerationTimeoutSeconds: 0 clears it (the platform default).
	ModerationTimeoutSeconds *int32
}

func positive(p *int32, code, msg string) error {
	if p != nil && *p <= 0 {
		return apperr.Invalid(code, msg)
	}
	return nil
}

// normalizeSpec validates a spec for kind and clears fields that do not apply
// to it, so a chat model never carries embedding dimensions and vice versa.
func normalizeSpec(ctx context.Context, q *dbgen.Queries, kind string, s *ModelSpec) error {
	s.UpstreamModel, s.DisplayName = strings.TrimSpace(s.UpstreamModel), strings.TrimSpace(s.DisplayName)
	if err := trimmedLen(s.UpstreamModel, 1, 200, "invalid_upstream_model", "Upstream model ID must be 1-200 characters"); err != nil {
		return err
	}
	if err := trimmedLen(s.DisplayName, 1, 100, "invalid_name", "Display name must be 1-100 characters"); err != nil {
		return err
	}
	if len(s.Description) > 2000 {
		return apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
	}
	if _, err := q.GetClassification(ctx, s.MaxClassification); err != nil {
		return notFound(err, apperr.Invalid("unknown_classification", "Unknown classification level"))
	}
	for _, chk := range []error{
		positive(s.ContextWindow, "invalid_context_window", "Context window must be positive"),
		positive(s.MaxOutputTokens, "invalid_max_output_tokens", "Maximum output tokens must be positive"),
		positive(s.MaxInputTokens, "invalid_max_input_tokens", "Maximum input tokens must be positive"),
		s.Compat.validate(),
		normalizeModeration(kind, s),
		validateOutputWindow(kind, s.ContextWindow, s.MaxOutputTokens),
	} {
		if chk != nil {
			return chk
		}
	}
	clearKindFlags(kind, s)
	if kind == KindEmbedding {
		if s.Dimensions == nil || *s.Dimensions < 1 || *s.Dimensions > 16000 {
			return apperr.Invalid("invalid_dimensions", "Embedding models need dimensions between 1 and 16000. Use Test to detect them.")
		}
	} else {
		s.Dimensions = nil
		if kind != KindRerank {
			s.MaxInputTokens = nil
		}
	}
	return nil
}

// clearKindFlags clears the capabilities and compat flags that don't apply
// to kind.
func clearKindFlags(kind string, s *ModelSpec) {
	if kind != KindChat {
		s.ContextWindow, s.SupportsTools, s.SupportsVision = nil, false, false
		if kind != KindVision { // a vision model's transcription length
			s.MaxOutputTokens = nil
		}
	}
	// Only chat completions take extraBody (chat and vision models, and
	// moderation models called over /chat/completions); only embeddings
	// take dimensions.
	if kind != KindChat && kind != KindModeration && kind != KindVision {
		s.Compat.ExtraBody = nil
	}
	if kind != KindEmbedding {
		s.Compat.SupportsDimensionsParam = nil
	}
	if kind != KindRerank {
		s.Compat.RerankDocumentsField, s.Compat.SupportsRerankTopN = nil, nil
	}
}
