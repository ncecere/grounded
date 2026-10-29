package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChainUsesEndpointErrorEnvelopeBeforeHeaders(t *testing.T) {
	mux := http.NewServeMux()
	panicHandler := func(http.ResponseWriter, *http.Request) { panic("private panic details") }
	mux.HandleFunc("GET /v1/models", panicHandler)
	mux.HandleFunc("GET /v1/chat/completions", panicHandler)
	mux.HandleFunc("GET /v1/native", panicHandler)
	h := chain(mux, metricsTestDeps(""))
	for _, tc := range []struct {
		path, typ, code string
		status          int
	}{
		{"/v1/models", "api_error", "internal", 500},
		{"/v1/chat/completions", "api_error", "internal", 500},
		{"/v1/models?q=%00", "invalid_request_error", "invalid_text", 400},
		{"/v1/native", "", "internal", 500},
		{"/v1/native?q=%00", "", "invalid_text", 400},
	} {
		t.Run(tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest("GET", tc.path, nil))
			var body struct{ Error map[string]any }
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if rec.Code != tc.status || body.Error["code"] != tc.code {
				t.Fatalf("got %d %s, want %d %s", rec.Code, rec.Body, tc.status, tc.code)
			}
			if tc.typ == "" {
				if _, exists := body.Error["type"]; exists {
					t.Fatalf("native error acquired OpenAI fields: %s", rec.Body)
				}
			} else if param, exists := body.Error["param"]; body.Error["type"] != tc.typ || !exists || param != nil {
				t.Fatalf("OpenAI error shape: %s", rec.Body)
			}
			if strings.Contains(rec.Body.String(), "private panic details") {
				t.Fatal("panic cause leaked to the client")
			}
		})
	}
}
