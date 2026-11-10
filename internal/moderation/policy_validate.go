package moderation

import (
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/authz"
)

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

func (p Problem) String() string { return fmt.Sprintf("%s: %s", p.Field, p.Problem) }
