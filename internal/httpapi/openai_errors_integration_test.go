package httpapi_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// The OpenAI-compatible endpoints answer every error in OpenAI's shape, including a request with no key at all (QA pass v0.6.0, #116): a client
// reads error.type, and the docs say "Errors use OpenAI's shape: {error:{message,type,code,param}}".
func TestOpenAICompatibleErrorsHaveTheOpenAIShape(t *testing.T) {
	env := newAgentEnv(t)
	for _, tc := range []struct {
		name, method, path, body string
		header                   map[string]string
		status                   int
		typ, code, allow         string
	}{
		{"models, no key", "GET", "/v1/models", "", nil, 401, "authentication_error", "unauthorized", ""},
		{"chat, no key", "POST", "/v1/chat/completions", `{"model":"agent:x/y","messages":[{"role":"user","content":"hi"}]}`, nil, 401, "authentication_error", "unauthorized", ""},
		{"models, a bad key", "GET", "/v1/models", "", map[string]string{"Authorization": "Bearer rag_nope"}, 401, "authentication_error", "invalid_api_key", ""},
		{"chat, a bad key", "POST", "/v1/chat/completions", `{}`, map[string]string{"Authorization": "Bearer rag_nope"}, 401, "authentication_error", "invalid_api_key", ""},
		{"models, wrong method", "POST", "/v1/models", "", nil, 405, "invalid_request_error", "method_not_allowed", "GET, HEAD"},
		{"chat, wrong method", "GET", "/v1/chat/completions", "", nil, 405, "invalid_request_error", "method_not_allowed", "POST"},
		{"models, OPTIONS", "OPTIONS", "/v1/models", "", nil, 405, "invalid_request_error", "method_not_allowed", "GET, HEAD"},
		{"chat, OPTIONS", "OPTIONS", "/v1/chat/completions", "", nil, 405, "invalid_request_error", "method_not_allowed", "POST"},
		{"models, wrong method with bad key", "DELETE", "/v1/models", "", map[string]string{"Authorization": "Bearer rag_nope"}, 405, "invalid_request_error", "method_not_allowed", "GET, HEAD"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest(tc.method, env.app.URL+tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			for k, v := range tc.header {
				req.Header.Set(k, v)
			}
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			if got := res.Header.Get("Allow"); got != tc.allow {
				t.Errorf("Allow = %q, want %q", got, tc.allow)
			}
			raw, _ := io.ReadAll(res.Body)
			var env struct{ Error map[string]any }
			if err := json.Unmarshal(raw, &env); err != nil {
				t.Fatalf("not JSON: %s", raw)
			}
			if res.StatusCode != tc.status || env.Error["type"] != tc.typ || env.Error["code"] != tc.code || env.Error["message"] == "" {
				t.Fatalf("%s = %d %s, want %d with type %s code %s", tc.name, res.StatusCode, raw, tc.status, tc.typ, tc.code)
			}
			if _, ok := env.Error["param"]; !ok {
				t.Errorf("no param field: %s", raw)
			}
		})
	}
}
