package moderation

import (
	"math"
)

// Decision outcomes.
const (
	DecisionPass  = "pass"
	DecisionFlag  = "flag"
	DecisionBlock = "block"
	// DecisionSupport: a support action fired; the support message
	// replaces the text.
	DecisionSupport = "support"
	DecisionError   = "error" // the provider failed or timed out
)

// Decision is the outcome of one check.
type Decision struct {
	Stage string
	// Outcome is pass, flag, block or error.
	Outcome string
	// Blocked: the text must not be used (a block, or an error when the
	// policy fails closed).
	Blocked bool
	// TopCategory and Score: the highest-scoring triggered category (or
	// the highest overall when nothing triggered).
	TopCategory string
	Score       float64
	Categories  []string // triggered categories, in category order
	// SeverityBlocked: the severity score reached the policy's threshold.
	SeverityBlocked bool
	// Downgraded lists triggered categories whose block rule only flagged
	// because the provider is not calibrated and the score was below the
	// policy's UncalibratedBlockThreshold.
	Downgraded []string
	Result     Result
	Err        error
}

// Evaluate applies the policy's rules for stage to a provider result.
// Categories the provider does not support cannot trigger.
func (p Policy) Evaluate(stage string, r Result) Decision {
	d := Decision{Stage: stage, Outcome: DecisionPass, Result: r}
	topAny, topAnyScore := "", -1.0
	topHit, topHitScore, hitRank := "", -1.0, 0
	for _, c := range Categories {
		rule, s := p.Categories[c].stage(stage), r.Scores[c]
		if !rule.active() || !s.Supported {
			continue
		}
		if s.Probability > topAnyScore {
			topAny, topAnyScore = c, s.Probability
		}
		if s.Probability < rule.Threshold {
			continue
		}
		d.Categories = append(d.Categories, c)
		action := p.effectiveAction(rule, s.Probability, r.Calibrated)
		if action != rule.Action {
			d.Downgraded = append(d.Downgraded, c)
		}
		// The strongest action wins; among equal actions, the highest score.
		if rank := actionRank[action]; rank > hitRank || (rank == hitRank && s.Probability > topHitScore) {
			topHit, topHitScore, hitRank = c, s.Probability, rank
		}
	}
	d.Outcome = outcomes[hitRank]
	if topHit != "" {
		d.TopCategory, d.Score = topHit, topHitScore
	} else if topAny != "" {
		d.TopCategory, d.Score = topAny, topAnyScore
	}
	if p.SeverityBlock != nil && r.Severity != nil && *r.Severity >= *p.SeverityBlock && d.Outcome != DecisionSupport {
		d.Outcome, d.SeverityBlocked = DecisionBlock, true
	}
	d.Blocked = d.Outcome == DecisionBlock || d.Outcome == DecisionSupport
	return d
}

// effectiveAction is a triggered rule's action: a block from an
// uncalibrated provider below the policy's uncalibrated floor only flags.
func (p Policy) effectiveAction(rule Rule, score float64, calibrated bool) string {
	if rule.Action == ActionBlock && !calibrated && score < p.UncalibratedBlockThreshold {
		return ActionFlag
	}
	return rule.Action
}

// outcomes maps the strongest triggered action's rank to the outcome.
var outcomes = map[int]string{0: DecisionPass, 1: DecisionFlag, 2: DecisionBlock, 3: DecisionSupport}

// Record is the content-free record of a decision in message_events
// (ADR-0010): never the text.
type Record struct {
	Decision    string   `json:"decision"`
	TopCategory string   `json:"topCategory,omitempty"`
	Score       float64  `json:"score"`
	Categories  []string `json:"categories,omitempty"`
	Provider    string   `json:"provider,omitempty"`
	Calibrated  bool     `json:"calibrated"`
	LatencyMs   int64    `json:"latencyMs"`
	// Severity is the provider's severity score (0-3), when it rates one.
	Severity        *float64 `json:"severity,omitempty"`
	SeverityBlocked bool     `json:"severityBlocked,omitempty"`
	// Downgraded: triggered categories that only flagged because the
	// provider is not calibrated (Decision.Downgraded).
	Downgraded []string `json:"downgraded,omitempty"`
	// Checks counts the output checks of an answer streamed in checked
	// paragraphs (one per paragraph, each of the text so far); absent when
	// the answer was checked once, whole.
	Checks int `json:"checks,omitempty"`
}

// Record returns the decision's analytics record.
func (d Decision) Record() Record {
	rec := Record{Decision: d.Outcome, TopCategory: d.TopCategory, Score: math.Round(d.Score*1000) / 1000,
		Categories: d.Categories, Provider: d.Result.Provider, Calibrated: d.Result.Calibrated,
		LatencyMs: d.Result.Latency.Milliseconds(), SeverityBlocked: d.SeverityBlocked, Downgraded: d.Downgraded}
	if s := d.Result.Severity; s != nil {
		v := math.Round(*s*1000) / 1000
		rec.Severity = &v
	}
	return rec
}
