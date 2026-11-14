package moderation

import (
	"encoding/json"
	"fmt"
)

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
		if r.Input.active() || r.Output.active() || !isCategory(c) {
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
		if !isCategory(c) {
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
	if o.OutputMode != ModeStreamRetract && validMode(o.OutputMode) && modeRank[o.OutputMode] > modeRank[out.OutputMode] {
		out.OutputMode = o.OutputMode
	}
	if a := o.SeverityBlock; a != nil && (out.SeverityBlock == nil || *a < *out.SeverityBlock) {
		v := *a
		out.SeverityBlock = &v
	}
	return out
}
