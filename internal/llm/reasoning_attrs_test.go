package llm

import (
	"testing"

	"go.opentelemetry.io/otel/attribute"
)

func TestReasoningAttributes(t *testing.T) {
	got := reasoningAttributes(Usage{Output: 1024, Reasoning: 1000})
	if len(got) != 1 || got[0] != attribute.Int("gen_ai.usage.reasoning_tokens", 1000) {
		t.Errorf("attributes = %v, want gen_ai.usage.reasoning_tokens=1000", got)
	}
}

func TestReasoningAttributesAreOmittedWhenTheGatewayReportsNone(t *testing.T) {
	// zero means "not reported" as often as "none": an attribute of 0 would claim a model never reasoned
	if got := reasoningAttributes(Usage{Output: 60}); len(got) != 0 {
		t.Errorf("attributes = %v, want none", got)
	}
}
