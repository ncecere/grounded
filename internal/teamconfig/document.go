package teamconfig

import (
	"bytes"
	"encoding/json"
	"io"

	"github.com/ncecere/grounded/internal/web"
)

// Document is the portable, versioned configuration, never a content backup.
// JSON syntax is intentionally used for emitted YAML: it preserves decimal
// numbers exactly and has identical scalar semantics in both formats.
type Document struct {
	APIVersion     string          `json:"apiVersion"`
	Sources        []Source        `json:"sources"`
	KnowledgeBases []KnowledgeBase `json:"knowledgeBases"`
	Agents         []Agent         `json:"agents"`
	EvaluationSets []EvaluationSet `json:"evaluationSets"`
	Webhooks       []Webhook       `json:"webhooks"`
}
type Source struct {
	Name             string      `json:"name"`
	Description      string      `json:"description"`
	Type             string      `json:"type"`
	Classification   string      `json:"classification"`
	EmbeddingProfile string      `json:"embeddingProfile"`
	Status           string      `json:"status"`
	OCREnabled       bool        `json:"ocrEnabled"`
	Web              *web.Config `json:"web,omitempty"`
	Boilerplate      Boilerplate `json:"boilerplate"`
}
type Boilerplate struct {
	Enabled *bool        `json:"enabled,omitempty"`
	MinDocs *int         `json:"minDocs,omitempty"`
	Ratio   *json.Number `json:"ratio,omitempty"`
	Fuzzy   *bool        `json:"fuzzy,omitempty"`
}
type SourceRef struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}
type KnowledgeBase struct {
	Name             string       `json:"name"`
	Description      string       `json:"description"`
	EmbeddingProfile string       `json:"embeddingProfile"`
	TopK             int32        `json:"topK"`
	VectorWeight     *json.Number `json:"vectorWeight,omitempty"`
	KeywordWeight    *json.Number `json:"keywordWeight,omitempty"`
	Sources          []SourceRef  `json:"sources"`
}
type ModelRef struct {
	Connection string `json:"connection"`
	Name       string `json:"name"`
}
type KBRef struct {
	Name string `json:"name"`
	TopK *int   `json:"topK,omitempty"`
}
type AgentConfig struct {
	Model          *ModelRef `json:"model,omitempty"`
	KnowledgeBases []KBRef   `json:"knowledgeBases"`
	// Settings is checked against the agent domain schema, with all identity
	// fields removed. No arbitrary stored settings are passed through.
	Settings json.RawMessage `json:"settings"`
}
type Agent struct {
	Name             string         `json:"name"`
	Slug             string         `json:"slug"`
	Description      string         `json:"description"`
	AccentColor      string         `json:"accentColor"`
	WelcomeMessage   string         `json:"welcomeMessage"`
	StarterQuestions []string       `json:"starterQuestions"`
	Status           string         `json:"status"`
	Draft            AgentConfig    `json:"draft"`
	PublishedVersion int32          `json:"publishedVersion,omitempty"`
	Versions         []AgentVersion `json:"versions"`
}
type AgentVersion struct {
	Version int32       `json:"version"`
	Note    string      `json:"note"`
	Config  AgentConfig `json:"config"`
}
type EvaluationSet struct {
	Name          string           `json:"name"`
	Description   string           `json:"description"`
	KnowledgeBase string           `json:"knowledgeBase,omitempty"`
	Agent         string           `json:"agent,omitempty"`
	AutoRun       bool             `json:"autoRun"`
	Cases         []EvaluationCase `json:"cases"`
}
type EvaluationCase struct {
	Question    string   `json:"question"`
	URLs        []string `json:"urls"`
	MustMention []string `json:"mustMention"`
	Note        string   `json:"note"`
}

// Webhook is identified by its URL (webhooks have no name) and never carries signing material: an import creates
// a webhook turned off with a fresh secret made in the target install, and an update keeps the existing one
// (docs/specs/config-as-code-import §5).
type Webhook struct {
	URL         string   `json:"url"`
	Description string   `json:"description"`
	Events      []string `json:"events"`
	Enabled     bool     `json:"enabled"`
}

func strictJSON(raw []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	dec.UseNumber()
	if dec.Decode(out) != nil || dec.Decode(&struct{}{}) != io.EOF {
		return invalid("domain_fields", "$", nil)
	}
	return nil
}

// DecodeDocument adds strict per-resource types, domain checks and portable
// reference validation to the existing hostile-YAML ingress boundary.
func DecodeDocument(r io.Reader) (Document, error) {
	raw, err := DecodeEnvelope(r)
	if err != nil {
		return Document{}, err
	}
	var d Document
	if err = strictJSON(raw, &d); err != nil {
		return Document{}, err
	}
	if err = d.validate(); err != nil {
		return Document{}, err
	}
	return d, nil
}
