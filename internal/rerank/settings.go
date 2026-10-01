// Package rerank is cross-encoder reranking (docs/v0.4.0.md §3, roadmap
// A1b): the platform's rerank model (Admin → Models), and the reranking
// step every search runs once it is set. A search fetches about 40
// candidates, the model scores them in one /rerank call, and the best go on
// to SystemOne judging or the model. Reranking is quality, not safety: an
// error or a timeout keeps the fusion order (fail open), and without a
// rerank model retrieval is as before.
package rerank

import (
	"encoding/json"
	"fmt"
	"time"
)

// Settings are the platform's rerank settings.
type Settings struct {
	// Candidates is how many fused hits a search fetches and reranks (the
	// knowledge base's or agent's results per search when that is more).
	Candidates int `json:"candidates"`
	// TimeLimitMs bounds the /rerank call of one search; beyond it the
	// search keeps the fusion order.
	TimeLimitMs int `json:"timeLimitMs"`
}

// Limits and defaults.
const (
	DefaultCandidates = 40
	MinCandidates     = 5
	MaxCandidates     = 100
	// DefaultTimeLimitMs: a reranker scores 40 passages in a few hundred
	// milliseconds on one GPU; 2 s leaves room for a cold start.
	DefaultTimeLimitMs = 2000
	MinTimeLimitMs     = 200
	MaxTimeLimitMs     = 10000
	// DefaultTopN is how many reranked passages an agent keeps
	// (rerankTopN; Build → Advanced).
	DefaultTopN = 6
	MaxTopN     = 20
	// MaxDocuments bounds one /rerank call (an evaluation's deep search
	// asks for 50 results).
	MaxDocuments = 100
)

// DefaultSettings are the settings until an admin saves some.
func DefaultSettings() Settings {
	return Settings{Candidates: DefaultCandidates, TimeLimitMs: DefaultTimeLimitMs}
}

// DecodeSettings reads stored settings over the defaults.
func DecodeSettings(raw json.RawMessage) Settings {
	s := DefaultSettings()
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &s)
	}
	return s
}

// TimeLimit is how long a search waits for its /rerank call.
func (s Settings) TimeLimit() time.Duration { return time.Duration(s.TimeLimitMs) * time.Millisecond }

// Problem is one invalid field.
type Problem struct {
	Field, Problem string
}

func (p Problem) String() string { return fmt.Sprintf("%s: %s", p.Field, p.Problem) }

// Validate checks the settings.
func (s Settings) Validate() []Problem {
	var out []Problem
	if s.Candidates < MinCandidates || s.Candidates > MaxCandidates {
		out = append(out, Problem{"candidates", fmt.Sprintf("Candidates must be between %d and %d", MinCandidates, MaxCandidates)})
	}
	if s.TimeLimitMs < MinTimeLimitMs || s.TimeLimitMs > MaxTimeLimitMs {
		out = append(out, Problem{"timeLimitMs", fmt.Sprintf("The time limit must be between %d and %d ms", MinTimeLimitMs, MaxTimeLimitMs)})
	}
	return out
}
