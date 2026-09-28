package systemone

import (
	"time"
)

// Citation-check modes (docs/systemone.md §3).
const (
	// CitationAnnotate marks each citation verified, unsupported or
	// contradicted and changes nothing else (the default).
	CitationAnnotate = "annotate"
	// CitationEnforce also removes confidently unsupported or contradicted
	// markers, and a strict agent whose claims are all unsupported refuses.
	CitationEnforce = "enforce"
)

// Citations configures citation checks.
type Citations struct {
	// Enabled is the platform default for agents without an override.
	Enabled bool   `json:"enabled"`
	Mode    string `json:"mode"`
	// AutoAccept is the confidence at or above which a verdict stands on
	// its own: enforce acts only on these, and lower ones are counted for
	// review in analytics.
	AutoAccept float64 `json:"autoAccept"`
	// TimeoutMs bounds the whole check of one answer (500-60000); claims
	// not checked by then are left unchecked.
	TimeoutMs int `json:"timeoutMs"`
}

// Scope configures the scope check.
type Scope struct {
	// Enabled is the platform default for agents without an override.
	Enabled bool `json:"enabled"`
	// SmallTalk: at or above, the message is answered as small talk,
	// without retrieval.
	SmallTalk float64 `json:"smallTalk"`
	// InScope: below, the message is out of the agent's scope and a
	// strict agent refuses without retrieval or a chat-model call.
	InScope float64 `json:"inScope"`
	// TimeoutMs bounds the request (500-60000); on timeout the message is
	// answered normally.
	TimeoutMs int `json:"timeoutMs"`
}

// Defaults of the citation and scope checks, from the evaluation
// (docs/benchmarks/systemone.md §7-§8): verdicts at or above 0.8 were all
// right; scope scores are bimodal, and 0.2 keeps an ambiguous message (a
// question about the assistant itself) from being refused.
const (
	DefaultAutoAccept        = 0.8
	DefaultCitationTimeoutMs = 20000
	DefaultSmallTalk         = 0.5
	DefaultInScope           = 0.2
	DefaultScopeTimeoutMs    = 5000
)

// DefaultCitations are the citation-check settings until an admin saves
// some: off, annotate.
func DefaultCitations() Citations {
	return Citations{Mode: CitationAnnotate, AutoAccept: DefaultAutoAccept, TimeoutMs: DefaultCitationTimeoutMs}
}

// DefaultScope are the scope-check settings until an admin saves some: off.
func DefaultScope() Scope {
	return Scope{SmallTalk: DefaultSmallTalk, InScope: DefaultInScope, TimeoutMs: DefaultScopeTimeoutMs}
}

// Timeout bounds the check of one answer.
func (c Citations) Timeout() time.Duration { return time.Duration(c.TimeoutMs) * time.Millisecond }

// Timeout bounds the scope request.
func (s Scope) Timeout() time.Duration { return time.Duration(s.TimeoutMs) * time.Millisecond }

func checkTimeout(field string, ms int) []Problem {
	if ms < minTimeoutMs || ms > maxTimeoutMs {
		return []Problem{{field, "The timeout must be between 500 and 60000 ms"}}
	}
	return nil
}

func (c Citations) validate() []Problem {
	var out []Problem
	if c.Mode != CitationAnnotate && c.Mode != CitationEnforce {
		out = append(out, Problem{"citations.mode", "Mode must be annotate or enforce"})
	}
	out = append(out, checkUnit("citations.autoAccept", c.AutoAccept)...)
	return append(out, checkTimeout("citations.timeoutMs", c.TimeoutMs)...)
}

func (s Scope) validate() []Problem {
	out := checkUnit("scope.smallTalk", s.SmallTalk)
	out = append(out, checkUnit("scope.inScope", s.InScope)...)
	return append(out, checkTimeout("scope.timeoutMs", s.TimeoutMs)...)
}

// Effective applies an agent's override: whether citations are checked
// and in which mode.
func (c Citations) Effective(o Override) Citations {
	c.Enabled = switched(c.Enabled, o.Citations)
	if o.CitationMode != "" {
		c.Mode = o.CitationMode
	}
	return c
}

// Effective applies an agent's override: whether the scope is checked.
func (s Scope) Effective(o Override) Scope {
	s.Enabled = switched(s.Enabled, o.Scope)
	return s
}
