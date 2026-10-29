package httpapi_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

func TestRetrieveRejectsExplicitOutOfRangeTopK(t *testing.T) {
	env := newAgentEnv(t)
	path := env.base + "/kbs/" + env.kb.Id.String() + "/retrieve"
	for _, topK := range []int{0, -1, 51, 1_000_000_000} {
		code, e := env.owner.call("POST", path, map[string]any{"query": "parking permit", "topK": topK}, nil, nil)
		if code != 400 || e != "invalid_topk" {
			t.Errorf("explicit topK %d = %d %s, want 400 invalid_topk", topK, code, e)
		}
	}
	for _, topK := range []int{0, 1, 50} {
		body := map[string]any{"query": "parking permit"}
		if topK != 0 {
			body["topK"] = topK
		}
		var result apitypes.RetrieveResult
		code, e := env.owner.call("POST", path, body, &result, nil)
		mustCode(t, "omitted or valid topK", code, e, 200, "")
		if len(result.Hits) == 0 {
			t.Errorf("topK %d (0 means omitted) lost working retrieval", topK)
		}
	}
}

func TestOpenAIRequestBoundariesHTTP(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Text helper", env.agentConfig(env.kb.Id.String()))
	model := "agent:" + env.team + "/" + ag.Slug
	var key apitypes.APIKeyCreated
	code, e := env.member.call("POST", env.base+"/api-keys", map[string]any{"name": "text sdk", "scopes": []string{"query"}}, &key, nil)
	mustCode(t, "key", code, e, 201, "")
	image := map[string]any{"type": "image_url", "image_url": map[string]string{"url": "https://example.org/image.png"}}
	cases := []struct {
		name, explanation string
		messages          any
	}{
		{"image only", "image", []map[string]any{{"role": "user", "content": []any{image}}}},
		{"text and image", "image", []map[string]any{{"role": "user", "content": []any{map[string]string{"type": "text", "text": "Describe it"}, image}}}},
		{"52 messages", "51", openAIBoundaryMessages(52)},
		{"5000 messages", "51", openAIBoundaryMessages(5000)},
	}
	before := env.scalar(t, `SELECT count(*) FROM message_events WHERE channel = 'openai'`)
	for _, tc := range cases {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%t", tc.name, stream), func(t *testing.T) {
				status, raw, headers := openaiCall(t, env.app.URL, key.Secret, map[string]any{"model": model, "messages": tc.messages, "stream": stream})
				var problem openaiErr
				if status != 400 || json.Unmarshal(raw, &problem) != nil || problem.Error.Code != "invalid_messages" ||
					problem.Error.Type != "invalid_request_error" || !strings.Contains(problem.Error.Message, tc.explanation) ||
					!strings.HasPrefix(headers.Get("Content-Type"), "application/json") {
					t.Fatalf("invalid request = %d %s (%s)", status, raw, headers.Get("Content-Type"))
				}
			})
		}
	}
	if env.scalar(t, `SELECT count(*) FROM message_events WHERE channel = 'openai'`) != before {
		t.Error("rejected requests created chat events")
	}
	for _, count := range []int{1, 51} {
		status, raw, _ := openaiCall(t, env.app.URL, key.Secret, map[string]any{"model": model, "messages": openAIBoundaryMessages(count)})
		if status != 200 || !strings.Contains(string(raw), `"object":"chat.completion"`) {
			t.Fatalf("valid %d-message request = %d %s", count, status, raw)
		}
	}
}

func openAIBoundaryMessages(count int) []map[string]string {
	messages := make([]map[string]string, count)
	for i := range messages {
		messages[i] = map[string]string{"role": "user", "content": "Where do students buy a parking permit?"}
	}
	return messages
}
