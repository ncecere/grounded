package moderation

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/authz"
)

// Actions of a rule, from least to most strict.
const (
	ActionOff   = "off"
	ActionFlag  = "flag"  // allowed, but recorded
	ActionBlock = "block" // refused (input) or withheld (output)
	// ActionSupport replaces the message or answer with the policy's
	// support message, for example crisis resources (docs/systemone.md
	// §1). Only SupportCategories may use it.
	ActionSupport = "support"
)

// SupportCategories may use the support action.
var SupportCategories = map[string]bool{SelfHarm: true}

// DefaultSupportMessage is the support message until an admin writes one.
// It names no country or service (ADR-0018): installs add their own
// resources.
const DefaultSupportMessage = "It sounds like you may be going through something really hard. You don't have to face it alone: " +
	"please reach out to someone you trust, a crisis line or support service in your area, or your local emergency number. " +
	"If you are in immediate danger, call emergency services now."

// Severity levels are 0 (none) to 3 (severe).
const maxSeverity = 3

// Output modes (docs/phase4-publishing.md §2 decision 1, docs/v0.4.0.md §4),
// from the least to the most strict.
const (
	ModeStreamRetract = "stream_retract" // stream live, retract a failing answer
	// ModeStreamChecked releases the answer paragraph by paragraph, each
	// checked with everything before it: nothing is shown unchecked.
	ModeStreamChecked = "stream_checked"
	ModeBuffer        = "buffer" // send the answer only after it passes
)

// modeRank orders the output modes by strictness (an override may only
// raise it).
var modeRank = map[string]int{ModeStreamRetract: 0, ModeStreamChecked: 1, ModeBuffer: 2}

// ValidMode reports whether m is an output mode.
func ValidMode(m string) bool {
	_, ok := modeRank[m]
	return ok
}

// DefaultNotice replaces a blocked message or answer.
const DefaultNotice = "This message can't be answered because it may break the usage policy."

// UnavailableNotice is the reply when a fail-closed provider errs (decision
// 2): the safety check, not the assistant, is what failed, and trying again
// usually works (docs/ui-review F-01).
const UnavailableNotice = "The safety check is unavailable right now. Please try again."

// DefaultThreshold is a new rule's threshold.
const DefaultThreshold = 0.5

// DefaultUncalibratedBlockThreshold is the lowest score at which a rule
// blocks when the provider is not calibrated (a chat model's own estimate,
// or a guardrail without log-probabilities): such scores are rough, so a
// block rule only flags below it (docs/ui-review F-02). Chat classifiers
// answer in round numbers and gave a benign question 0.9 in the live check,
// so the default keeps blocks for near-certain scores only.
const DefaultUncalibratedBlockThreshold = 0.95

var actionRank = map[string]int{ActionOff: 0, ActionFlag: 1, ActionBlock: 2, ActionSupport: 3}

// Rule is what happens when a category's probability reaches Threshold.
type Rule struct {
	Action    string  `json:"action"`
	Threshold float64 `json:"threshold"`
}

func (r Rule) active() bool { return actionRank[r.Action] > 0 }

// CategoryRules are one category's rules for the input and the output.
type CategoryRules struct {
	Input  Rule `json:"input"`
	Output Rule `json:"output"`
}

func (c CategoryRules) stage(s string) Rule {
	if s == StageOutput {
		return c.Output
	}
	return c.Input
}

// Policy is the platform policy of one audience (§4). The provider is
// stored beside it (moderation_policies.model_id).
type Policy struct {
	Categories map[string]CategoryRules `json:"categories"`
	OutputMode string                   `json:"outputMode"`
	FailClosed bool                     `json:"failClosed"`
	Notice     string                   `json:"notice"`
	// SeverityBlock blocks a message or answer whose severity score (0
	// none to 3 severe) reaches it, at any stage that is moderated; nil is
	// off. Only SystemOne providers rate severity.
	SeverityBlock *float64 `json:"severityBlock,omitempty"`
	// SupportMessage replaces a message or answer that triggers a support
	// action.
	SupportMessage string `json:"supportMessage"`
	// UncalibratedBlockThreshold is the effective floor of block
	// thresholds for providers that are not calibrated: a block rule whose
	// score is at or above its threshold but below this one flags instead.
	// 0 treats uncalibrated scores like calibrated ones. Support actions
	// are not lowered (a missed crisis costs more than a support message).
	UncalibratedBlockThreshold float64 `json:"uncalibratedBlockThreshold"`
	// ReasoningEffort is the reasoning effort of the audience's answers
	// when the agent sets none (docs/v0.4.0.md §4, owner decision 4):
	// EffortDefault (the model's), off, low, medium or high.
	ReasoningEffort string `json:"reasoningEffort,omitempty"`
}

// Reasoning efforts of a policy (ReasoningEffort).
const (
	EffortDefault = "default"
	EffortOff     = "off"
	EffortLow     = "low"
)

var validEfforts = map[string]bool{EffortDefault: true, EffortOff: true, EffortLow: true, "medium": true, "high": true}

// DefaultEffort is an audience's reasoning effort until an admin chooses
// one: low for public (visitors wait for checked answers; a policy saved
// before the field existed gets it too), the model's for the others.
func DefaultEffort(audience string) string {
	if audience == authz.AudiencePublic {
		return EffortLow
	}
	return EffortDefault
}

// Effort is the reasoning effort the policy asks for: "" for the model's
// default, else off, low, medium or high.
func (p Policy) Effort() string {
	if p.ReasoningEffort == EffortDefault {
		return ""
	}
	return p.ReasoningEffort
}

// DefaultPolicy is an audience's policy until an admin saves one: public
// blocks every category at 0.5 on input and output, streams checked
// paragraphs, fails closed and reasons at low effort; the others are off
// and stream.
func DefaultPolicy(audience string) Policy {
	p := Policy{Categories: map[string]CategoryRules{}, OutputMode: ModeStreamRetract, Notice: DefaultNotice,
		SupportMessage: DefaultSupportMessage, UncalibratedBlockThreshold: DefaultUncalibratedBlockThreshold,
		ReasoningEffort: DefaultEffort(audience)}
	action := ActionOff
	if audience == authz.AudiencePublic {
		action, p.OutputMode, p.FailClosed = ActionBlock, ModeStreamChecked, true
	}
	for _, c := range Categories {
		r := Rule{Action: action, Threshold: DefaultThreshold}
		p.Categories[c] = CategoryRules{Input: r, Output: r}
	}
	return p
}

// DecodePolicy reads a stored policy over the audience's defaults.
func DecodePolicy(audience string, raw json.RawMessage) Policy {
	p := DefaultPolicy(audience)
	var in Policy
	if json.Unmarshal(raw, &in) != nil {
		return p
	}
	for c, r := range in.Categories {
		if IsCategory(c) {
			p.Categories[c] = r
		}
	}
	if in.OutputMode != "" {
		p.OutputMode = in.OutputMode
	}
	p.FailClosed = in.FailClosed
	if strings.TrimSpace(in.Notice) != "" {
		p.Notice = in.Notice
	}
	if strings.TrimSpace(in.SupportMessage) != "" {
		p.SupportMessage = in.SupportMessage
	}
	p.SeverityBlock = in.SeverityBlock
	if validEfforts[in.ReasoningEffort] { // saved before v0.4.0: the audience's default
		p.ReasoningEffort = in.ReasoningEffort
	}
	// Policies saved before the floor existed keep the default.
	var floor struct {
		V *float64 `json:"uncalibratedBlockThreshold"`
	}
	if json.Unmarshal(raw, &floor) == nil && floor.V != nil {
		p.UncalibratedBlockThreshold = *floor.V
	}
	return p
}

// Problem is one invalid field of a policy or override.
type Problem struct {
	Field, Problem string
}

func checkRule(field, category string, r Rule) []Problem {
	var out []Problem
	if _, ok := actionRank[r.Action]; !ok {
		out = append(out, Problem{field + ".action", "Action must be off, flag, block or support"})
	} else if r.Action == ActionSupport && !SupportCategories[category] {
		out = append(out, Problem{field + ".action", "Only self_harm can use the support action"})
	}
	if math.IsNaN(r.Threshold) || r.Threshold < 0 || r.Threshold > 1 {
		out = append(out, Problem{field + ".threshold", "Threshold must be between 0 and 1"})
	}
	return out
}

// Validate checks a policy for an audience. Public must fail closed
// (decision 2).
func (p Policy) Validate(audience string) []Problem {
	var out []Problem
	for c, r := range p.Categories {
		if !IsCategory(c) {
			out = append(out, Problem{"categories." + c, "Unknown category"})
			continue
		}
		out = append(out, checkRule("categories."+c+".input", c, r.Input)...)
		out = append(out, checkRule("categories."+c+".output", c, r.Output)...)
	}
	out = append(out, checkSeverity("severityBlock", p.SeverityBlock)...)
	if v := p.UncalibratedBlockThreshold; math.IsNaN(v) || v < 0 || v > 1 {
		out = append(out, Problem{"uncalibratedBlockThreshold", "The block threshold for uncalibrated providers must be between 0 and 1"})
	}
	if n := utf8.RuneCountInString(p.SupportMessage); n > 1000 || strings.TrimSpace(p.SupportMessage) == "" {
		out = append(out, Problem{"supportMessage", "The support message must be 1-1000 characters"})
	}
	if p.ReasoningEffort != "" && !validEfforts[p.ReasoningEffort] {
		out = append(out, Problem{"reasoningEffort", "Reasoning effort must be default, off, low, medium or high"})
	}
	if !ValidMode(p.OutputMode) {
		out = append(out, Problem{"outputMode", "Output mode must be stream_retract, stream_checked or buffer"})
	}
	if audience == authz.AudiencePublic && !p.FailClosed {
		out = append(out, Problem{"failClosed", "Moderation for public agents must fail closed"})
	}
	if n := utf8.RuneCountInString(p.Notice); n > 500 || strings.TrimSpace(p.Notice) == "" {
		out = append(out, Problem{"notice", "The notice must be 1-500 characters"})
	}
	return out
}

func checkSeverity(field string, v *float64) []Problem {
	if v != nil && (math.IsNaN(*v) || *v < 0 || *v > maxSeverity) {
		return []Problem{{field, "The severity threshold must be between 0 (none) and 3 (severe)"}}
	}
	return nil
}

// Active reports whether any category is flagged, blocked or supported at
// stage, or severity blocks.
func (p Policy) Active(stage string) bool {
	if p.SeverityBlock != nil {
		return true
	}
	for _, r := range p.Categories {
		if r.stage(stage).active() {
			return true
		}
	}
	return false
}

// Override is an agent's moderation override (agent config): it may only
// make the platform policy stricter. A rule with action off (or absent)
// keeps the platform's rule.
type Override struct {
	Categories map[string]CategoryRules `json:"categories"`
	// OutputMode "" keeps the platform's mode; stream_checked and buffer
	// apply where the platform's mode is less strict (modeRank).
	OutputMode string `json:"outputMode"`
	// SeverityBlock nil keeps the platform's; a value blocks at that
	// severity or the platform's, whichever is lower.
	SeverityBlock *float64 `json:"severityBlock,omitempty"`
}

// UnmarshalJSON also accepts the Phase 3 placeholder "off" (no override),
// so stored drafts and versions keep decoding.
func (o *Override) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		if s != "off" && s != "" {
			return fmt.Errorf("moderation must be an object")
		}
		*o = Override{}
		return nil
	}
	type plain Override
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	*o = Override(p)
	return nil
}

// Normalize drops rules that change nothing, so equal overrides have equal
// JSON.
func (o Override) Normalize() Override {
	out := Override{Categories: map[string]CategoryRules{}, OutputMode: o.OutputMode, SeverityBlock: o.SeverityBlock}
	for c, r := range o.Categories {
		if !r.Input.active() {
			r.Input = Rule{Action: ActionOff, Threshold: DefaultThreshold}
		}
		if !r.Output.active() {
			r.Output = Rule{Action: ActionOff, Threshold: DefaultThreshold}
		}
		if r.Input.active() || r.Output.active() || !IsCategory(c) {
			out.Categories[c] = r
		}
	}
	return out
}

// IsZero reports whether the override changes nothing.
func (o Override) IsZero() bool {
	if o.OutputMode == ModeBuffer || o.OutputMode == ModeStreamChecked || o.SeverityBlock != nil {
		return false
	}
	for _, r := range o.Categories {
		if r.Input.active() || r.Output.active() {
			return false
		}
	}
	return true
}

// Validate checks an override's values (not whether they are stricter:
// Merge never lets them weaken the policy).
func (o Override) Validate() []Problem {
	var out []Problem
	for c, r := range o.Categories {
		if !IsCategory(c) {
			out = append(out, Problem{"moderation.categories." + c, "Unknown category"})
			continue
		}
		out = append(out, checkRule("moderation.categories."+c+".input", c, r.Input)...)
		out = append(out, checkRule("moderation.categories."+c+".output", c, r.Output)...)
	}
	out = append(out, checkSeverity("moderation.severityBlock", o.SeverityBlock)...)
	if o.OutputMode != "" && o.OutputMode != ModeBuffer && o.OutputMode != ModeStreamChecked {
		out = append(out, Problem{"moderation.outputMode", `The output mode override must be "" (the platform's), stream_checked or buffer`})
	}
	return out
}

// stricter combines a platform rule with an agent's: the stronger action
// and the lower threshold, never weaker than the platform.
func stricter(platform, agent Rule) Rule {
	switch {
	case !agent.active():
		return platform
	case !platform.active():
		return agent
	}
	action := platform.Action
	if actionRank[agent.Action] > actionRank[action] {
		action = agent.Action
	}
	return Rule{Action: action, Threshold: min(platform.Threshold, agent.Threshold)}
}

// Merge applies an agent's override to the platform policy, stricter only.
func (p Policy) Merge(o Override) Policy {
	out := p
	out.Categories = make(map[string]CategoryRules, len(p.Categories))
	for c, r := range p.Categories {
		if a, ok := o.Categories[c]; ok {
			r = CategoryRules{Input: stricter(r.Input, a.Input), Output: stricter(r.Output, a.Output)}
		}
		out.Categories[c] = r
	}
	if o.OutputMode != ModeStreamRetract && ValidMode(o.OutputMode) && modeRank[o.OutputMode] > modeRank[out.OutputMode] {
		out.OutputMode = o.OutputMode
	}
	if a := o.SeverityBlock; a != nil && (out.SeverityBlock == nil || *a < *out.SeverityBlock) {
		v := *a
		out.SeverityBlock = &v
	}
	return out
}

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

func (p Problem) String() string { return fmt.Sprintf("%s: %s", p.Field, p.Problem) }
