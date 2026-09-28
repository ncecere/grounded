package moderation

import (
	_ "embed"
	"encoding/json"
	"math"
	"strings"
	"time"
)

// Categories (docs/phase4-publishing.md §4). Every provider maps its own
// labels into these; a category a provider cannot judge is reported as
// unsupported.
const (
	Violence        = "violence"
	SelfHarm        = "self_harm"
	Sexual          = "sexual"
	SexualMinors    = "sexual_minors"
	HarassmentHate  = "harassment_hate"
	Illicit         = "illicit"
	PersonalData    = "personal_data"
	PromptInjection = "prompt_injection"
)

// Categories lists every category in display order.
var Categories = []string{Violence, SelfHarm, Sexual, SexualMinors, HarassmentHate, Illicit, PersonalData, PromptInjection}

// IsCategory reports whether c is a category.
func IsCategory(c string) bool {
	for _, k := range Categories {
		if k == c {
			return true
		}
	}
	return false
}

// definitions is the versioned policy text: category definitions, the
// classifier prompt and the model test samples (ADR-0019: policy text lives
// in versioned configuration, reviewed like policy, not in code).
//
//go:embed definitions.v1.json
var definitionsJSON []byte

type categoryText struct {
	Label      string `json:"label"`
	Definition string `json:"definition"`
	Question   string `json:"question"`
}

var defs = func() (d struct {
	Version          string                  `json:"version"`
	Categories       map[string]categoryText `json:"categories"`
	ClassifierPrompt string                  `json:"classifierPrompt"`
	Samples          struct {
		Benign  string `json:"benign"`
		Harmful string `json:"harmful"`
	} `json:"samples"`
}) {
	if err := json.Unmarshal(definitionsJSON, &d); err != nil {
		panic("moderation: definitions.v1.json: " + err.Error())
	}
	for _, c := range Categories {
		if d.Categories[c].Question == "" || d.Categories[c].Definition == "" {
			panic("moderation: definitions.v1.json lacks category " + c)
		}
	}
	return d
}()

// DefinitionsVersion is the version of the category definitions and
// prompts in use.
func DefinitionsVersion() string { return defs.Version }

// Score is one category's probability.
type Score struct {
	// Probability is 0-1. Providers that only return labels report 0 or 1.
	Probability float64 `json:"probability"`
	// Supported is false when the provider cannot judge the category.
	Supported bool `json:"supported"`
}

// Result is a provider's normalised answer: a score for every category.
type Result struct {
	Scores   map[string]Score
	Provider string // provider kind, with the family for guardrails (guardrail_chat/llama_guard)
	// Calibrated: the probabilities are real probabilities (System One,
	// guardrails with logprobs, /moderations scores), so thresholds can be
	// tuned. Label-only answers are not.
	Calibrated bool
	Latency    time.Duration
	// Severity is how much harm complying would do, 0 (none) to 3
	// (severe); nil when the provider does not rate it (only SystemOne
	// models do).
	Severity *float64
}

// newResult returns a result with every category unsupported.
func newResult(provider string, calibrated bool) Result {
	r := Result{Scores: map[string]Score{}, Provider: provider, Calibrated: calibrated}
	for _, c := range Categories {
		r.Scores[c] = Score{}
	}
	return r
}

// set records p for category c (the highest value wins when several of the
// provider's labels map to one category).
func (r *Result) set(c string, p float64) {
	if math.IsNaN(p) {
		p = 0
	}
	p = min(max(p, 0), 1)
	cur := r.Scores[c]
	if !cur.Supported || p > cur.Probability {
		cur.Probability = p
	}
	cur.Supported = true
	r.Scores[c] = cur
}

// Top returns the highest-scoring supported category ("" when none).
func (r Result) Top() (string, float64) {
	top, best := "", -1.0
	for _, c := range Categories {
		if s := r.Scores[c]; s.Supported && s.Probability > best {
			top, best = c, s.Probability
		}
	}
	return top, max(best, 0)
}

// categoryList formats the categories for a prompt: "- key: definition".
func categoryList() string {
	var b strings.Builder
	for _, c := range Categories {
		b.WriteString("- " + c + ": " + defs.Categories[c].Definition + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}
