package moderation

import (
	"encoding/json"
	"strings"

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
