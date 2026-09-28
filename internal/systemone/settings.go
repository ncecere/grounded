package systemone

import (
	"encoding/json"
	"fmt"
	"math"
	"time"
)

// Settings are the platform's SystemOne feature settings (docs/systemone.md
// §2-§4, the admin SystemOne page). Every feature is off by default and
// has its own section.
type Settings struct {
	Judging   Judging   `json:"judging"`
	Citations Citations `json:"citations"`
	Scope     Scope     `json:"scope"`
}

// Judging configures passage judging.
type Judging struct {
	// Enabled is the platform default for agents without an override.
	Enabled bool `json:"enabled"`
	// Candidates is how many fused hits are judged per search (1-50).
	Candidates int    `json:"candidates"`
	Mode       string `json:"mode"`
	// TimeoutMs bounds each SystemOne request (500-60000).
	TimeoutMs  int        `json:"timeoutMs"`
	Thresholds Thresholds `json:"thresholds"`
}

// Limits and defaults of the judging settings.
const (
	// DefaultCandidates is 10, not the spec's 20: on a single GPU each
	// candidate costs about 0.7 s, and 10 kept most of the re-rank gain
	// (docs/benchmarks/systemone.md).
	DefaultCandidates = 10
	MaxCandidates     = 50
	DefaultTimeoutMs  = 5000
	minTimeoutMs      = 500
	maxTimeoutMs      = 60000
)

// DefaultSettings are the settings until an admin saves some.
func DefaultSettings() Settings {
	return Settings{
		Judging: Judging{Candidates: DefaultCandidates, Mode: ModePerPassage,
			TimeoutMs: DefaultTimeoutMs, Thresholds: DefaultThresholds},
		Citations: DefaultCitations(),
		Scope:     DefaultScope(),
	}
}

// DecodeSettings reads stored settings over the defaults.
func DecodeSettings(raw json.RawMessage) Settings {
	s := DefaultSettings()
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &s)
	}
	return s
}

// Timeout is the per-request timeout.
func (j Judging) Timeout() time.Duration { return time.Duration(j.TimeoutMs) * time.Millisecond }

// Problem is one invalid field.
type Problem struct {
	Field, Problem string
}

func (p Problem) String() string { return fmt.Sprintf("%s: %s", p.Field, p.Problem) }

func checkUnit(field string, v float64) []Problem {
	if math.IsNaN(v) || v < 0 || v > 1 {
		return []Problem{{field, "Thresholds must be between 0 and 1"}}
	}
	return nil
}

// Validate checks the settings.
func (s Settings) Validate() []Problem {
	var out []Problem
	j := s.Judging
	if j.Candidates < 1 || j.Candidates > MaxCandidates {
		out = append(out, Problem{"judging.candidates", fmt.Sprintf("Candidates must be between 1 and %d", MaxCandidates)})
	}
	if j.Mode != ModePerPassage && j.Mode != ModeBatched {
		out = append(out, Problem{"judging.mode", "Mode must be per_passage or batched"})
	}
	if j.TimeoutMs < minTimeoutMs || j.TimeoutMs > maxTimeoutMs {
		out = append(out, Problem{"judging.timeoutMs", "The timeout must be between 500 and 60000 ms"})
	}
	t := j.Thresholds
	out = append(out, checkUnit("judging.thresholds.injection", t.Injection)...)
	out = append(out, checkUnit("judging.thresholds.relevant", t.Relevant)...)
	out = append(out, checkUnit("judging.thresholds.contradicts", t.Contradicts)...)
	out = append(out, checkUnit("judging.thresholds.evidence", t.Evidence)...)
	out = append(out, s.Citations.validate()...)
	return append(out, s.Scope.validate()...)
}

// AnyEnabled reports whether any feature is on by default.
func (s Settings) AnyEnabled() bool {
	return s.Judging.Enabled || s.Citations.Enabled || s.Scope.Enabled
}

// Judging overrides (agent configuration).
const (
	OverrideOn  = "on"
	OverrideOff = "off"
)

// Override is an agent's "SystemOne checks" setting (Configure → Advanced).
// The zero value follows the platform. Thresholds are platform-only.
type Override struct {
	// Judging is "" (the platform default), on or off.
	Judging string `json:"judging,omitempty"`
	// Candidates overrides the platform's candidate count (1-50).
	Candidates *int `json:"candidates,omitempty"`
	// Citations is "" (the platform default), on or off; CitationMode
	// "" (the platform's), annotate or enforce (docs/systemone.md §3).
	Citations    string `json:"citations,omitempty"`
	CitationMode string `json:"citationMode,omitempty"`
	// Scope is "" (the platform default), on or off (§4).
	Scope string `json:"scope,omitempty"`
}

// IsZero reports whether the override follows the platform entirely.
func (o Override) IsZero() bool {
	return o.Judging == "" && o.Candidates == nil && o.Citations == "" && o.CitationMode == "" && o.Scope == ""
}

// Validate checks an override; fields are reported under systemOne.
func (o Override) Validate() []Problem {
	var out []Problem
	if o.Judging != "" && o.Judging != OverrideOn && o.Judging != OverrideOff {
		out = append(out, Problem{"systemOne.judging", `Judging must be "" (the platform default), on or off`})
	}
	if c := o.Candidates; c != nil && (*c < 1 || *c > MaxCandidates) {
		out = append(out, Problem{"systemOne.candidates", fmt.Sprintf("Candidates must be between 1 and %d", MaxCandidates)})
	}
	if o.Citations != "" && o.Citations != OverrideOn && o.Citations != OverrideOff {
		out = append(out, Problem{"systemOne.citations", `Citation checks must be "" (the platform default), on or off`})
	}
	if o.CitationMode != "" && o.CitationMode != CitationAnnotate && o.CitationMode != CitationEnforce {
		out = append(out, Problem{"systemOne.citationMode", `The citation mode must be "" (the platform's), annotate or enforce`})
	}
	if o.Scope != "" && o.Scope != OverrideOn && o.Scope != OverrideOff {
		out = append(out, Problem{"systemOne.scope", `The scope check must be "" (the platform default), on or off`})
	}
	return out
}

// switched applies an on/off override to a platform default.
func switched(def bool, o string) bool {
	switch o {
	case OverrideOn:
		return true
	case OverrideOff:
		return false
	}
	return def
}

// Effective applies an agent's override to the platform's judging
// settings: whether judging runs and with how many candidates.
func (j Judging) Effective(o Override) Judging {
	j.Enabled = switched(j.Enabled, o.Judging)
	if o.Candidates != nil {
		j.Candidates = *o.Candidates
	}
	return j
}
