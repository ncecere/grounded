package agents

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/rerank"
	"github.com/ncecere/grounded/internal/systemone"
)

// Retrieval modes, citation modes and defaults (docs/phase3-agents.md §3).
const (
	ModeAlways = "always"
	ModeTool   = "tool"

	CitationNone        = "none"
	CitationSnippet     = "snippet"
	CitationSnippetLink = "snippet_link"

	DefaultRefusal     = "I couldn't find an answer to that in the sources I have."
	DefaultMaxTurns    = 4
	DefaultTokenBudget = 6000

	MaxInstructions = 20000
	MaxKBs          = 5
	// MaxTools bounds the MCP tools of an agent (docs/mcp-client.md).
	MaxTools = 10
)

// KBRef is one KB an agent searches.
type KBRef struct {
	KBID uuid.UUID `json:"kbId"`
	// TopK is the agent's results per search from this KB; nil inherits
	// the KB's own top-k (C14). Agents saved before v0.2 store 6.
	TopK *int `json:"topK"`
}

// EffectiveTopK is the results per search from a KB whose own top-k is kbTopK.
func (r KBRef) EffectiveTopK(kbTopK int) int {
	if r.TopK != nil {
		return *r.TopK
	}
	return max(kbTopK, 1)
}

// Config is an agent's configuration, as stored in the draft and in
// immutable versions. Decode stored JSON with DecodeConfig so defaults apply.
type Config struct {
	Instructions       string              `json:"instructions"`
	ChatModelID        *uuid.UUID          `json:"chatModelId"`
	Temperature        *float64            `json:"temperature,omitempty"`
	MaxOutputTokens    *int                `json:"maxOutputTokens,omitempty"`
	ReasoningEffort    string              `json:"reasoningEffort,omitempty"`
	KBs                []KBRef             `json:"kbs"`
	RetrievalMode      string              `json:"retrievalMode"`
	MaxTurns           int                 `json:"maxTurns"`
	ContextTokenBudget int                 `json:"contextTokenBudget"`
	Filters            *kbs.MetadataFilter `json:"filters,omitempty"`
	MinSimilarity      float64             `json:"minSimilarity"`
	StrictlyGrounded   bool                `json:"strictlyGrounded"`
	RefusalMessage     string              `json:"refusalMessage"`
	CitationMode       string              `json:"citationMode"`
	QueryRewrite       bool                `json:"queryRewrite"`
	// Moderation is the agent's stricter-only override of the audience's
	// platform moderation policy (docs/phase4-publishing.md §4).
	Moderation moderation.Override `json:"moderation"`
	// Audience is who may chat once this configuration is published: team,
	// all_authenticated or public (docs/phase4-publishing.md §3). It is a
	// draft setting, so audiences are versioned.
	Audience string `json:"audience"`
	// SystemOne is the agent's "SystemOne checks" override
	// (docs/systemone.md §2); nil follows the platform.
	SystemOne *systemone.Override `json:"systemOne,omitempty"`
	// Tools are the approved MCP server tools the agent may call
	// (docs/mcp-client.md), by ID, in the order the model is offered them.
	Tools []uuid.UUID `json:"tools"`
	// Rerank reranks searches with the platform's rerank model (on by
	// default; it only applies once a platform admin sets one), keeping
	// the best RerankTopN passages of each (docs/v0.4.0.md §3).
	Rerank     bool `json:"rerank"`
	RerankTopN int  `json:"rerankTopN"`
	// FollowUpSuggestions offers up to 3 follow-up questions under an
	// answer with citations (docs/follow-ups.md): on by default, and for
	// configurations saved before v0.4.1 (owner decision, 2026-10-02).
	FollowUpSuggestions bool `json:"followUpSuggestions"`
}

// configInput is Config with every field optional, so absent fields take
// their defaults.
type configInput struct {
	Instructions       *string              `json:"instructions"`
	ChatModelID        *uuid.UUID           `json:"chatModelId"`
	Temperature        *float64             `json:"temperature"`
	MaxOutputTokens    *int                 `json:"maxOutputTokens"`
	ReasoningEffort    *string              `json:"reasoningEffort"`
	KBs                []KBRef              `json:"kbs"`
	RetrievalMode      *string              `json:"retrievalMode"`
	MaxTurns           *int                 `json:"maxTurns"`
	ContextTokenBudget *int                 `json:"contextTokenBudget"`
	Filters            *kbs.MetadataFilter  `json:"filters"`
	MinSimilarity      *float64             `json:"minSimilarity"`
	StrictlyGrounded   *bool                `json:"strictlyGrounded"`
	RefusalMessage     *string              `json:"refusalMessage"`
	CitationMode       *string              `json:"citationMode"`
	QueryRewrite       *bool                `json:"queryRewrite"`
	Moderation         *moderation.Override `json:"moderation"`
	Audience           *string              `json:"audience"`
	SystemOne          *systemone.Override  `json:"systemOne"`
	Tools              []uuid.UUID          `json:"tools"`
	Rerank             *bool                `json:"rerank"`
	RerankTopN         *int                 `json:"rerankTopN"`
	FollowUps          *bool                `json:"followUpSuggestions"`
}

// Problem is one reason a configuration is invalid.
type Problem struct {
	Field   string `json:"field"`
	Problem string `json:"problem"`
}

// DefaultConfig is a new agent's draft.
func DefaultConfig() Config {
	c, _ := normalize(configInput{})
	return c
}

// ParseConfig reads a configuration from the API (unknown fields are
// rejected) and checks types and ranges only: an incomplete draft (no model,
// no KBs) is fine. Failures are 400 invalid_config with details.problems.
func ParseConfig(raw json.RawMessage) (Config, error) {
	var in configInput
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return Config{}, invalidConfig([]Problem{{Field: "config", Problem: "The configuration is not valid: " + jsonProblem(err)}})
	}
	c, problems := normalize(in)
	if len(problems) > 0 {
		return c, invalidConfig(problems)
	}
	return c, nil
}

// DecodeConfig reads a stored configuration, applying defaults. It never
// fails: stored drafts were validated when saved.
func DecodeConfig(raw json.RawMessage) Config {
	var in configInput
	_ = json.Unmarshal(raw, &in)
	c, _ := normalize(in)
	return c
}

func jsonProblem(err error) string {
	msg := err.Error()
	msg = strings.TrimPrefix(msg, "json: ")
	return msg
}

func invalidConfig(p []Problem) error {
	return &apperr.Error{Status: 400, Code: "invalid_config", Message: problemsMessage("The agent configuration is invalid", p),
		Details: map[string]any{"problems": p}}
}

// Invalid is the 422 agent_invalid error for strict (publish) validation.
func Invalid(p []Problem) error {
	return &apperr.Error{Status: 422, Code: "agent_invalid", Message: problemsMessage("The agent can't be published yet", p),
		Details: map[string]any{"problems": p}}
}

func problemsMessage(prefix string, p []Problem) string {
	if len(p) == 0 {
		return prefix
	}
	return prefix + ": " + p[0].Problem
}

// normalize applies defaults and checks types and ranges. Problems are
// reported in field order.
func normalize(in configInput) (Config, []Problem) {
	var p problems
	c := Config{
		ChatModelID: in.ChatModelID, Temperature: in.Temperature, MaxOutputTokens: in.MaxOutputTokens,
		RetrievalMode: ModeAlways, MaxTurns: DefaultMaxTurns, ContextTokenBudget: DefaultTokenBudget,
		StrictlyGrounded: true, RefusalMessage: DefaultRefusal, CitationMode: CitationSnippetLink,
		QueryRewrite: true, Moderation: moderation.Override{}.Normalize(), KBs: []KBRef{},
		Audience: authz.AudienceTeam, Tools: []uuid.UUID{}, Rerank: true, RerankTopN: rerank.DefaultTopN,
		FollowUpSuggestions: true,
	}
	c.normalizeModel(in, &p)
	c.normalizeTools(in.Tools, &p)
	c.normalizeKBs(in.KBs, &p)
	c.normalizeRetrieval(in, &p)
	c.normalizeAnswer(in, &p)
	return c, p
}

// problems collects the problems of a configuration.
type problems []Problem

func (p *problems) bad(field, format string, args ...any) {
	*p = append(*p, Problem{Field: field, Problem: fmt.Sprintf(format, args...)})
}

// setIf overrides a default with an input value that is present.
func setIf[T any](dst *T, v *T) {
	if v != nil {
		*dst = *v
	}
}

// normalizeModel handles the instructions and the model options.
func (c *Config) normalizeModel(in configInput, p *problems) {
	setIf(&c.Instructions, in.Instructions)
	if n := len([]rune(c.Instructions)); n > MaxInstructions {
		p.bad("instructions", "Instructions must be at most %d characters", MaxInstructions)
	}
	if c.ChatModelID != nil && *c.ChatModelID == uuid.Nil {
		c.ChatModelID = nil
	}
	if t := c.Temperature; t != nil && (math.IsNaN(*t) || *t < 0 || *t > 2) {
		p.bad("temperature", "Temperature must be between 0 and 2")
	}
	if m := c.MaxOutputTokens; m != nil && (*m < 1 || *m > 1_000_000) {
		p.bad("maxOutputTokens", "Maximum output tokens must be a positive number")
	}
	setIf(&c.ReasoningEffort, in.ReasoningEffort)
	switch c.ReasoningEffort {
	case "", "off", "low", "medium", "high":
	default:
		p.bad("reasoningEffort", "Reasoning effort must be off, low, medium or high")
	}
}

// normalizeKBs handles the KB list: unique KBs, top-k 1-20 or inherited
// from the KB (absent, null or 0).
func (c *Config) normalizeKBs(refs []KBRef, p *problems) {
	if len(refs) > MaxKBs {
		p.bad("kbs", "An agent can search at most %d knowledge bases", MaxKBs)
	}
	seen := map[uuid.UUID]bool{}
	for i, ref := range refs {
		if ref.TopK != nil && *ref.TopK == 0 {
			ref.TopK = nil
		}
		field := "kbs[" + strconv.Itoa(i) + "]"
		switch {
		case ref.KBID == uuid.Nil:
			p.bad(field+".kbId", "Choose a knowledge base")
		case seen[ref.KBID]:
			p.bad(field+".kbId", "This knowledge base is listed twice")
		}
		if ref.TopK != nil && (*ref.TopK < 1 || *ref.TopK > 20) {
			p.bad(field+".topK", "Results per knowledge base must be between 1 and 20")
		}
		seen[ref.KBID] = true
		c.KBs = append(c.KBs, ref)
	}
}

// normalizeRetrieval handles the retrieval mode, turns, token budget,
// metadata filters and similarity threshold.
func (c *Config) normalizeRetrieval(in configInput, p *problems) {
	setIf(&c.RetrievalMode, in.RetrievalMode)
	if c.RetrievalMode != ModeAlways && c.RetrievalMode != ModeTool {
		p.bad("retrievalMode", "Retrieval mode must be always or tool")
	}
	setIf(&c.MaxTurns, in.MaxTurns)
	if c.MaxTurns < 1 || c.MaxTurns > 8 {
		p.bad("maxTurns", "Maximum turns must be between 1 and 8")
	}
	setIf(&c.ContextTokenBudget, in.ContextTokenBudget)
	if c.ContextTokenBudget < 500 || c.ContextTokenBudget > 32000 {
		p.bad("contextTokenBudget", "The context token budget must be between 500 and 32000")
	}
	if in.Filters != nil {
		f, err := in.Filters.Normalize()
		if err != nil {
			field := "filters"
			if e, ok := apperr.As(err); ok {
				if d, ok := e.Details.(map[string]any); ok {
					field, _ = d["field"].(string)
				}
				p.bad(field, "%s", e.Message)
			}
		} else if !f.IsZero() {
			c.Filters = &f
		}
	}
	setIf(&c.MinSimilarity, in.MinSimilarity)
	if math.IsNaN(c.MinSimilarity) || c.MinSimilarity < 0 || c.MinSimilarity > 1 {
		p.bad("minSimilarity", "Minimum similarity must be between 0 and 1")
	}
	setIf(&c.Rerank, in.Rerank)
	setIf(&c.RerankTopN, in.RerankTopN)
	if c.RerankTopN < 1 || c.RerankTopN > rerank.MaxTopN {
		p.bad("rerankTopN", "Passages kept after reranking must be between 1 and %d", rerank.MaxTopN)
	}
}

// normalizeAnswer handles grounding, the refusal message, citations, query
// rewriting and moderation.
func (c *Config) normalizeAnswer(in configInput, p *problems) {
	setIf(&c.StrictlyGrounded, in.StrictlyGrounded)
	if in.RefusalMessage != nil && strings.TrimSpace(*in.RefusalMessage) != "" {
		c.RefusalMessage = strings.TrimSpace(*in.RefusalMessage)
	}
	if len([]rune(c.RefusalMessage)) > 500 {
		p.bad("refusalMessage", "The refusal message must be at most 500 characters")
	}
	if strings.ContainsAny(c.RefusalMessage, "\r\n") {
		p.bad("refusalMessage", "The refusal message must be a single line")
	}
	setIf(&c.CitationMode, in.CitationMode)
	switch c.CitationMode {
	case CitationNone, CitationSnippet, CitationSnippetLink:
	default:
		p.bad("citationMode", "Citation mode must be none, snippet or snippet_link")
	}
	setIf(&c.QueryRewrite, in.QueryRewrite)
	setIf(&c.FollowUpSuggestions, in.FollowUps)
	setIf(&c.Audience, in.Audience)
	if !authz.ValidAudience(c.Audience) {
		p.bad("audience", "Audience must be team, all_authenticated or public")
	}
	if in.Moderation != nil {
		for _, pr := range in.Moderation.Validate() {
			p.bad(pr.Field, "%s", pr.Problem)
		}
		c.Moderation = in.Moderation.Normalize()
	}
	if o := in.SystemOne; o != nil && !o.IsZero() {
		for _, pr := range o.Validate() {
			p.bad(pr.Field, "%s", pr.Problem)
		}
		c.SystemOne = o
	}
}

// normalizeTools handles the MCP tools: unique, at most MaxTools.
func (c *Config) normalizeTools(ids []uuid.UUID, p *problems) {
	if len(ids) > MaxTools {
		p.bad("tools", "An agent can use at most %d tools", MaxTools)
	}
	seen := map[uuid.UUID]bool{}
	for i, id := range ids {
		switch {
		case id == uuid.Nil:
			p.bad("tools["+strconv.Itoa(i)+"]", "Choose a tool")
		case seen[id]:
			p.bad("tools["+strconv.Itoa(i)+"]", "This tool is listed twice")
		}
		seen[id] = true
		c.Tools = append(c.Tools, id)
	}
}

// JSON returns the canonical stored form.
func (c Config) JSON() json.RawMessage {
	b, _ := json.Marshal(c)
	return b
}

// KBIDs lists the configured KB IDs in order.
func (c Config) KBIDs() []uuid.UUID {
	out := make([]uuid.UUID, len(c.KBs))
	for i, k := range c.KBs {
		out[i] = k.KBID
	}
	return out
}

// ---- profile fields -----------------------------------------------------------

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// MinContrast is the WCAG AA contrast required between the accent colour and
// white text (and the white surface).
const MinContrast = 4.5

// NormalizeAccent validates an accent colour ("" = platform default) and
// checks its contrast against white (DESIGN §7.6).
func NormalizeAccent(c string) (string, error) {
	c = strings.TrimSpace(c)
	if c == "" {
		return "", nil
	}
	if !hexColor.MatchString(c) {
		return "", apperr.Invalid("invalid_accent_color", "Accent colour must be a hex colour such as #4b4fd6")
	}
	c = strings.ToLower(c)
	if r := ContrastWithWhite(c); r < MinContrast {
		return "", &apperr.Error{Status: 400, Code: "insufficient_contrast",
			Message: fmt.Sprintf("This colour's contrast with white is %.2f:1; it needs at least %.1f:1. Choose a darker colour.", r, MinContrast),
			Details: map[string]any{"contrast": math.Round(r*100) / 100, "minimum": MinContrast}}
	}
	return c, nil
}

// ContrastWithWhite returns the WCAG contrast ratio of #rrggbb against white.
func ContrastWithWhite(hex string) float64 {
	lum := func(s string) float64 {
		v, _ := strconv.ParseUint(s, 16, 8)
		c := float64(v) / 255
		if c <= 0.03928 {
			return c / 12.92
		}
		return math.Pow((c+0.055)/1.055, 2.4)
	}
	l := 0.2126*lum(hex[1:3]) + 0.7152*lum(hex[3:5]) + 0.0722*lum(hex[5:7])
	return 1.05 / (l + 0.05)
}
