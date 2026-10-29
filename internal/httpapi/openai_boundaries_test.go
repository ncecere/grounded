package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOpenAIRejectsNonTextParts(t *testing.T) {
	for _, raw := range []string{
		`[{"type":"image_url","image_url":{"url":"https://example.org/image.png"}}]`,
		`[{"type":"text","text":"Describe this"},{"type":"image_url","image_url":{"url":"https://example.org/image.png"}}]`,
		`[{"type":"input_audio","input_audio":{"data":"example","format":"wav"}}]`,
		`[{"text":"missing part type"}]`,
	} {
		t.Run(raw, func(t *testing.T) {
			_, problem := openaiTurns([]openaiMessage{{Role: "user", Content: json.RawMessage(raw)}})
			if problem == "" || !strings.Contains(strings.ToLower(problem), "text") {
				t.Fatalf("non-text parts were accepted or not explained: %q", problem)
			}
		})
	}
	for _, raw := range []string{`"hello"`, `[{"type":"text","text":"hello"}]`} {
		turns, problem := openaiTurns([]openaiMessage{{Role: "user", Content: json.RawMessage(raw)}})
		if problem != "" || len(turns) != 1 || turns[0].Content != "hello" {
			t.Fatalf("valid text = %v, %q", turns, problem)
		}
	}
}

func TestOpenAISubmittedMessageLimit(t *testing.T) {
	for _, count := range []int{1, 51, 52, 5000} {
		messages := make([]openaiMessage, count)
		for i := range messages {
			messages[i] = openaiMessage{Role: "user", Content: json.RawMessage(`"hello"`)}
		}
		_, problem := openaiTurns(messages)
		if (problem == "") != (count <= 51) {
			t.Errorf("%d messages: problem = %q", count, problem)
		}
	}
	// Ignored roles cannot bypass the submitted-message budget.
	messages := make([]openaiMessage, 52)
	for i := range messages {
		messages[i] = openaiMessage{Role: "system", Content: json.RawMessage(`"ignored"`)}
	}
	messages[len(messages)-1].Role = "user"
	if _, problem := openaiTurns(messages); problem == "" {
		t.Error("ignored roles bypassed the message limit")
	}
}
