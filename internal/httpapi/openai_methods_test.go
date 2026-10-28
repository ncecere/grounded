package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Wrong methods must not fall through to the SPA/native 404 (#116). Exercise
// the real router assembly without infrastructure, including its catch-all.
func TestOpenAIWrongMethods(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	routes := []route{{"GET", "/v1/models", ok}, {"POST", "/v1/chat/completions", ok}}
	for _, fallback := range []http.Handler{notFound, spaHandler(nil, false, spaOptions{})} {
		h := build(metricsTestDeps(""), routes, fallback)
		for _, tc := range []struct{ path, allow string }{
			{"/v1/models", "GET, HEAD"},
			{"/v1/chat/completions", "POST"},
		} {
			for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CUSTOM"} {
				t.Run(method+tc.path, func(t *testing.T) {
					rec := httptest.NewRecorder()
					h.ServeHTTP(rec, httptest.NewRequest(method, tc.path+"?test=1", nil))
					if strings.Contains(", "+tc.allow+", ", ", "+method+", ") {
						if rec.Code != http.StatusNoContent || rec.Header().Get("Allow") != "" {
							t.Fatalf("supported method = %d %s", rec.Code, rec.Body)
						}
						return
					}
					if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != tc.allow {
						t.Fatalf("got %d Allow %q %s", rec.Code, rec.Header().Get("Allow"), rec.Body)
					}
					var body struct{ Error map[string]any }
					if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
						t.Fatal(err)
					}
					if body.Error["code"] != "method_not_allowed" || body.Error["type"] != "invalid_request_error" || body.Error["message"] == "" {
						t.Fatalf("wrong OpenAI error: %s", rec.Body)
					}
					if param, exists := body.Error["param"]; !exists || param != nil {
						t.Fatalf("param must be present and null: %s", rec.Body)
					}
					if !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") || rec.Header().Get("Cache-Control") != "no-store" {
						t.Fatalf("wrong headers: %v", rec.Header())
					}
					if rec.Header().Get("Access-Control-Allow-Origin") != "" {
						t.Fatal("wrong method must not grant cross-origin access")
					}
				})
			}
		}
		for _, path := range []string{"/v1/models/unknown", "/v1/models/", "/v1/chat/completions/", "/v1/unknown"} {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest("POST", path, nil))
			if rec.Code != http.StatusNotFound || rec.Header().Get("Allow") != "" {
				t.Fatalf("unknown path %s = %d Allow %q", path, rec.Code, rec.Header().Get("Allow"))
			}
		}
	}
}

func TestOpenAIMethodFallbackDoesNotAddWorkerRoutes(t *testing.T) {
	h := build(metricsTestDeps(""), nil, notFound)
	for _, path := range []string{"/v1/models", "/v1/chat/completions"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("POST", path, nil))
		if rec.Code != http.StatusNotFound || rec.Header().Get("Allow") != "" {
			t.Fatalf("API route leaked into ops handler: %d %v", rec.Code, rec.Header())
		}
	}
}
