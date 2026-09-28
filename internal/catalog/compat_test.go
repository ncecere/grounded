package catalog

import (
	"encoding/json"
	"strings"
	"testing"
)

func ptr[T any](v T) *T { return &v }

func TestCompatValidate(t *testing.T) {
	ok := []Compat{
		{},
		{MaxTokensField: ptr("max_tokens")},
		{MaxTokensField: ptr("max_completion_tokens")},
		{ThinkingField: ptr("reasoning_content"), SupportsToolChoice: ptr(true)},
		{ThinkingField: ptr("reasoning")},
		{SupportsDimensionsParam: ptr(true)},
		{ExtraBody: map[string]any{"chat_template_kwargs": map[string]any{"enable_thinking": false}}},
		{ExtraBody: map[string]any{"top_k": 20, "repetition_penalty": 1.05}},
		{ExtraBody: map[string]any{}},
	}
	for _, c := range ok {
		if err := c.validate(); err != nil {
			t.Errorf("%+v: %v", c, err)
		}
	}
	bad := []Compat{
		{MaxTokensField: ptr("max_output_tokens")},
		{ThinkingField: ptr("thinking")},
		// Core fields Grounded sets itself can't be overridden.
		{ExtraBody: map[string]any{"model": "other"}},
		{ExtraBody: map[string]any{"messages": []any{}}},
		{ExtraBody: map[string]any{"stream": false, "top_k": 1}},
		{ExtraBody: map[string]any{"tools": nil}},
		{ExtraBody: map[string]any{"max_tokens": 5}},
		{ExtraBody: map[string]any{" ": 1}},
		{ExtraBody: map[string]any{"big": strings.Repeat("x", MaxExtraBodyBytes)}},
	}
	for _, c := range bad {
		if err := c.validate(); err == nil {
			t.Errorf("%+v: expected an error", c)
		}
	}
	err := Compat{ExtraBody: map[string]any{"tools": 1, "model": 2}}.validate()
	if err == nil || !strings.Contains(err.Error(), `"model", "tools"`) {
		t.Errorf("message = %v", err)
	}
}

func TestNormalizeSpecClearsKindFlags(t *testing.T) {
	yes := true
	extra := map[string]any{"chat_template_kwargs": map[string]any{"enable_thinking": false}}
	for kind, keep := range map[string][2]bool{
		// {keeps extraBody, keeps supportsDimensionsParam}
		KindChat: {true, false}, KindModeration: {true, false}, KindEmbedding: {false, true}, KindSystemOne: {false, false},
	} {
		s := ModelSpec{Compat: Compat{ExtraBody: extra, SupportsDimensionsParam: &yes}}
		clearKindFlags(kind, &s)
		if (s.Compat.ExtraBody != nil) != keep[0] || (s.Compat.SupportsDimensionsParam != nil) != keep[1] {
			t.Errorf("%s: %+v", kind, s.Compat)
		}
	}
}

func TestDecodeCompatRoundTrip(t *testing.T) {
	in := Compat{SupportsToolChoice: ptr(false), ThinkingField: ptr("reasoning"), SupportsStreamUsage: ptr(true)}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"supportsStreamUsage":true,"supportsToolChoice":false,"thinkingField":"reasoning"}` {
		t.Fatalf("json = %s", raw)
	}
	out := DecodeCompat(raw)
	if out.SupportsToolChoice == nil || *out.SupportsToolChoice || *out.ThinkingField != "reasoning" || out.MaxTokensField != nil {
		t.Fatalf("decoded = %+v", out)
	}
	// Rows written before the new flags existed still decode.
	if old := DecodeCompat(json.RawMessage(`{"maxTokensField":"max_tokens"}`)); old.SupportsToolChoice != nil || old.ThinkingField != nil {
		t.Fatalf("old = %+v", old)
	}
}
