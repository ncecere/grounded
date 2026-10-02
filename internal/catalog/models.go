package catalog

import (
	"context"
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store"
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

func modelSnapshot(m dbgen.Model) map[string]any {
	return map[string]any{
		"key": m.Key, "kind": m.Kind, "connectionId": m.ConnectionID, "upstreamModel": m.UpstreamModel,
		"displayName": m.DisplayName, "maxClassification": m.MaxClassification, "enabled": m.Enabled,
		"contextWindow": m.ContextWindow, "maxOutputTokens": m.MaxOutputTokens,
		"supportsTools": m.SupportsTools, "supportsVision": m.SupportsVision,
		"dimensions": m.Dimensions, "maxInputTokens": m.MaxInputTokens, "compat": m.Compat,
		"moderationProvider": m.ModerationProvider, "moderationFamily": m.ModerationFamily,
		"moderationTimeoutSeconds": m.ModerationTimeoutSeconds,
	}
}

// ModelFilter narrows ListModels.
type ModelFilter struct {
	Kind         *string
	ConnectionID *uuid.UUID
}

func (s *Service) ListModels(ctx context.Context, a authz.Actor, f ModelFilter) ([]dbgen.Model, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	p := dbgen.ListModelsParams{Kind: f.Kind}
	if f.ConnectionID != nil {
		p.ConnectionID = uuid.NullUUID{UUID: *f.ConnectionID, Valid: true}
	}
	return s.q.ListModels(ctx, p)
}

func (s *Service) GetModel(ctx context.Context, a authz.Actor, id uuid.UUID) (dbgen.Model, error) {
	if !a.CanReadPlatform() {
		return dbgen.Model{}, errReadOnly
	}
	m, err := s.q.GetModel(ctx, id)
	return m, notFound(err, errNoModel)
}

func (s *Service) CreateModel(ctx context.Context, a authz.Actor, in ModelInput) (dbgen.Model, error) {
	if !a.IsPlatformAdmin() {
		return dbgen.Model{}, errAdminOnly
	}
	if !keyRE.MatchString(in.Key) {
		return dbgen.Model{}, apperr.Invalid("invalid_key", "Key must be 1-63 lowercase letters, digits, dots, dashes or underscores")
	}
	if !validKinds[in.Kind] {
		return dbgen.Model{}, apperr.Invalid("invalid_kind", "Kind must be chat, embedding, rerank, moderation, systemone or vision")
	}
	var out dbgen.Model
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if _, err := q.GetConnection(ctx, in.ConnectionID); err != nil {
			return notFound(err, apperr.Invalid("unknown_connection", "Unknown model connection"))
		}
		if err := normalizeSpec(ctx, q, in.Kind, &in.ModelSpec); err != nil {
			return err
		}
		compat, _ := json.Marshal(in.Compat)
		var err error
		out, err = q.InsertModel(ctx, dbgen.InsertModelParams{
			ConnectionID: in.ConnectionID, Key: in.Key, UpstreamModel: in.UpstreamModel, DisplayName: in.DisplayName,
			Description: in.Description, Kind: in.Kind, MaxClassification: in.MaxClassification, Enabled: in.Enabled,
			ContextWindow: in.ContextWindow, MaxOutputTokens: in.MaxOutputTokens,
			SupportsTools: in.SupportsTools, SupportsVision: in.SupportsVision,
			Dimensions: in.Dimensions, MaxInputTokens: in.MaxInputTokens, Compat: compat,
			ModerationProvider: optional(in.ModerationProvider), ModerationFamily: optional(in.ModerationFamily),
			ModerationTimeoutSeconds: in.ModerationTimeoutSeconds,
			CreatedBy:                uuid.NullUUID{UUID: a.UserID, Valid: true},
		})
		switch {
		case apperr.IsUniqueViolation(err, "models_key_key"):
			return apperr.Conflict("key_taken", "A model with that key already exists")
		case apperr.IsUniqueViolation(err, "models_connection_upstream_kind_key"):
			return apperr.Conflict("model_exists", "That upstream model is already added for this connection and kind")
		case err != nil:
			return err
		}
		e := a.Audit("platform.model_create", "model", out.ID.String())
		e.After = modelSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// specUpdate applies the changes in to the model's current spec.
func specUpdate(cur dbgen.Model, in ModelUpdate) ModelSpec {
	spec := ModelSpec{
		UpstreamModel: cur.UpstreamModel, DisplayName: cur.DisplayName, Description: cur.Description,
		MaxClassification: cur.MaxClassification, Enabled: cur.Enabled,
		ContextWindow: cur.ContextWindow, MaxOutputTokens: cur.MaxOutputTokens,
		SupportsTools: cur.SupportsTools, SupportsVision: cur.SupportsVision,
		Dimensions: cur.Dimensions, MaxInputTokens: cur.MaxInputTokens, Compat: DecodeCompat(cur.Compat),
		ModerationProvider: deref(cur.ModerationProvider), ModerationFamily: deref(cur.ModerationFamily),
		ModerationTimeoutSeconds: cur.ModerationTimeoutSeconds,
	}
	setValue(&spec.UpstreamModel, in.UpstreamModel)
	setValue(&spec.DisplayName, in.DisplayName)
	setValue(&spec.Description, in.Description)
	setValue(&spec.MaxClassification, in.MaxClassification)
	setValue(&spec.Enabled, in.Enabled)
	setPointer(&spec.ContextWindow, in.ContextWindow)
	setPointer(&spec.MaxOutputTokens, in.MaxOutputTokens)
	setValue(&spec.SupportsTools, in.SupportsTools)
	setValue(&spec.SupportsVision, in.SupportsVision)
	setPointer(&spec.Dimensions, in.Dimensions)
	setPointer(&spec.MaxInputTokens, in.MaxInputTokens)
	setValue(&spec.Compat, in.Compat)
	setValue(&spec.ModerationProvider, in.ModerationProvider)
	setValue(&spec.ModerationFamily, in.ModerationFamily)
	if in.ModerationTimeoutSeconds != nil {
		spec.ModerationTimeoutSeconds = in.ModerationTimeoutSeconds
		if *in.ModerationTimeoutSeconds == 0 {
			spec.ModerationTimeoutSeconds = nil
		}
	}
	return spec
}

// setValue sets *dst to *v when v is given.
func setValue[T any](dst *T, v *T) {
	if v != nil {
		*dst = *v
	}
}

// setPointer replaces the optional *dst with v when v is given.
func setPointer[T any](dst **T, v *T) {
	if v != nil {
		*dst = v
	}
}

func (s *Service) UpdateModel(ctx context.Context, a authz.Actor, id uuid.UUID, in ModelUpdate, expectedRevision int64) (dbgen.Model, error) {
	if !a.IsPlatformAdmin() {
		return dbgen.Model{}, errAdminOnly
	}
	var out dbgen.Model
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockModel(ctx, id)
		if err != nil {
			return notFound(err, errNoModel)
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		spec := specUpdate(cur, in)
		if err := normalizeSpec(ctx, q, cur.Kind, &spec); err != nil {
			return err
		}
		// Vectors already produced by an embedding model would silently stop
		// matching if the upstream model or its dimensions changed.
		if cur.Kind == KindEmbedding && (spec.UpstreamModel != cur.UpstreamModel || *spec.Dimensions != *cur.Dimensions) {
			n, err := q.CountModelProfiles(ctx, id)
			if err != nil {
				return err
			}
			if n > 0 {
				return apperr.Conflict("model_in_use",
					"This embedding model is used by an embedding profile, so its upstream model and dimensions cannot change. Add a new model and profile instead.")
			}
		}
		// Phase 1/3: lowering max_classification or disabling a model must be
		// checked against the sources, profiles and agents that use it.
		compat, _ := json.Marshal(spec.Compat)
		if out, err = q.UpdateModel(ctx, dbgen.UpdateModelParams{
			ID: id, UpstreamModel: spec.UpstreamModel, DisplayName: spec.DisplayName, Description: spec.Description,
			MaxClassification: spec.MaxClassification, Enabled: spec.Enabled,
			ContextWindow: spec.ContextWindow, MaxOutputTokens: spec.MaxOutputTokens,
			SupportsTools: spec.SupportsTools, SupportsVision: spec.SupportsVision,
			Dimensions: spec.Dimensions, MaxInputTokens: spec.MaxInputTokens, Compat: compat,
			ModerationProvider: optional(spec.ModerationProvider), ModerationFamily: optional(spec.ModerationFamily),
			ModerationTimeoutSeconds: spec.ModerationTimeoutSeconds,
		}); err != nil {
			return err
		}
		e := a.Audit("platform.model_update", "model", id.String())
		e.Before, e.After = modelSnapshot(cur), modelSnapshot(out)
		return audit.Record(ctx, q, e)
	})
	return out, err
}

func (s *Service) DeleteModel(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if !a.IsPlatformAdmin() {
		return errAdminOnly
	}
	return store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockModel(ctx, id)
		if err != nil {
			return notFound(err, errNoModel)
		}
		if err := q.DeleteModel(ctx, id); apperr.IsForeignKeyViolation(err, "") {
			return apperr.Conflict("model_in_use", "This model is in use. Disable it instead.")
		} else if err != nil {
			return err
		}
		e := a.Audit("platform.model_delete", "model", id.String())
		e.Before = modelSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
}

// ModelTest is the result of a tiny real request to a model.
type ModelTest struct {
	OK      bool
	Latency time.Duration
	// Embedding models: the dimensions the proxy returned, and whether they
	// match the configured value.
	Dimensions      *int32
	DimensionsMatch *bool
	// Chat models: the start of the reply.
	Reply string
	Usage gateway.Usage
	// Rerank models: the scores of the fixed test passages.
	Rerank *RerankTest
	Error  *ProbeError
}

// TestModel sends a small request so admins can confirm the model works
// (and, for embeddings, learn its real dimensions) before relying on it.
func (s *Service) TestModel(ctx context.Context, a authz.Actor, id uuid.UUID) (ModelTest, error) {
	if !a.IsPlatformAdmin() {
		return ModelTest{}, errAdminOnly
	}
	m, err := s.q.GetModel(ctx, id)
	if err != nil {
		return ModelTest{}, notFound(err, errNoModel)
	}
	c, err := s.q.GetConnection(ctx, m.ConnectionID)
	if err != nil {
		return ModelTest{}, err
	}
	cl, err := s.client(c)
	if err != nil {
		return ModelTest{}, err
	}
	user := "grounded-admin-test:" + a.UserID.String()
	start := time.Now()
	var res ModelTest
	switch m.Kind {
	case KindEmbedding:
		out, err := cl.Embed(ctx, gateway.EmbedRequest{Model: m.UpstreamModel, Input: []string{"Grounded connection test."}, User: user})
		res.Latency = time.Since(start)
		if err != nil {
			res.Error, err = probeError(err)
			return res, err
		}
		dims := int32(len(out.Vectors[0]))
		match := m.Dimensions != nil && *m.Dimensions == dims
		res.Dimensions, res.DimensionsMatch, res.Usage, res.OK = &dims, &match, out.Usage, true
	case KindChat:
		out, err := cl.Complete(ctx, gateway.CompleteRequest{
			Model: m.UpstreamModel, MaxTokens: 16, User: user, Extra: DecodeCompat(m.Compat).ExtraBody,
			Messages: []gateway.ChatMessage{{Role: "user", Content: "Reply with the single word: pong"}},
		})
		res.Latency = time.Since(start)
		if err != nil {
			res.Error, err = probeError(err)
			return res, err
		}
		reply := strings.TrimSpace(out.Text)
		if len(reply) > 200 {
			reply = reply[:200]
		}
		res.Reply, res.Usage, res.OK = reply, out.Usage, true
	case KindRerank:
		return testRerank(ctx, cl, m, user), nil
	default:
		return ModelTest{}, apperr.Invalid("test_unsupported", "Testing "+m.Kind+" models is not supported yet")
	}
	return res, nil
}

// ChatTarget is a chat model with a client for its connection.
type ChatTarget struct {
	Model  dbgen.Model
	Client *gateway.Client
}

// ErrChatModelUnusable is returned when a chat model or its connection is
// disabled (or the model is not a chat model).
var ErrChatModelUnusable = apperr.New(503, "model_unavailable", "The agent's chat model is disabled or unavailable. Ask a platform admin.")

// ChatTarget returns a client for an enabled chat model. Callers check
// classification ceilings themselves.
func (s *Service) ChatTarget(ctx context.Context, modelID uuid.UUID) (ChatTarget, error) {
	m, err := s.q.GetModel(ctx, modelID)
	if err != nil {
		return ChatTarget{}, notFound(err, ErrChatModelUnusable)
	}
	if m.Kind != KindChat || !m.Enabled {
		return ChatTarget{}, ErrChatModelUnusable
	}
	conn, err := s.q.GetConnection(ctx, m.ConnectionID)
	if err != nil {
		return ChatTarget{}, err
	}
	if !conn.Enabled {
		return ChatTarget{}, ErrChatModelUnusable
	}
	cl, err := s.observedClient(conn, KindChat)
	if err != nil {
		return ChatTarget{}, err
	}
	return ChatTarget{Model: m, Client: cl}, nil
}

// ListUsableChatModels returns the chat models teams may choose for agents:
// enabled, on an enabled connection. Any signed-in user may list them
// (names and capabilities only; no connection details).
func (s *Service) ListUsableChatModels(ctx context.Context) ([]dbgen.Model, error) {
	return s.q.ListUsableChatModels(ctx)
}
