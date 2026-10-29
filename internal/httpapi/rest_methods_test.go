package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRESTMethodFallbackCoversTheRealAPITable(t *testing.T) {
	// The real handlers have no database/services: a probe must not execute
	// authentication or look up a resource just to discover allowed methods.
	h := NewAPIHandler(metricsTestDeps(""))
	for _, tc := range []struct{ method, path, allow string }{
		{"POST", "/v1/admin/users", "GET, HEAD"},
		{"POST", "/v1/teams/demo/api-keys/key", "DELETE, GET, HEAD, PATCH"},
		{"GET", "/v1/teams/demo/kbs/kb/retrieve", "POST"},
		{"OPTIONS", "/v1/public/agents/example", "GET, HEAD"},
		{"DELETE", "/v1/public/sessions", "POST"},
		{"POST", "/v1/models", "GET, HEAD"},
		{"GET", "/v1/chat/completions", "POST"},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != 405 || rec.Header().Get("Allow") != tc.allow {
			t.Errorf("%s %s = %d Allow %q %s", tc.method, tc.path, rec.Code, rec.Header().Get("Allow"), rec.Body)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("OPTIONS", "/v1/no-such-route", nil))
	if rec.Code != 404 || rec.Header().Get("Allow") != "" {
		t.Fatalf("unknown REST path = %d %v", rec.Code, rec.Header())
	}
}

func TestRESTMethodFallbackUsesActualMatchingRoutes(t *testing.T) {
	called := 0
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
		w.WriteHeader(http.StatusNoContent)
	})
	routes := []route{
		{"GET", "/v1/things/{id}", ok},
		{"POST", "/v1/things/{id}", ok},
		{"PATCH", "/v1/things/recent", ok},
		{"GET", "/v1/things/{id}/children", ok},
		{"GET", "/v1/files/{path...}", ok},
		{"POST", "/v1/public/sessions", ok},
	}
	h := build(metricsTestDeps(""), routes, notFound)
	for _, tc := range []struct{ method, path, allow string }{
		{"PUT", "/v1/things/one", "GET, HEAD, POST"},
		{"OPTIONS", "/v1/things/one?test=1", "GET, HEAD, POST"},
		// Literal PATCH and wildcard GET/POST all match this path. Taking
		// only the most specific path pattern would incorrectly omit GET/POST.
		{"DELETE", "/v1/things/recent", "GET, HEAD, PATCH, POST"},
		{"POST", "/v1/things/one/children", "GET, HEAD"},
		{"CUSTOM", "/v1/files/one/two", "GET, HEAD"},
		{"OPTIONS", "/v1/public/sessions", "POST"},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			before := called
			r := httptest.NewRequest(tc.method, tc.path, nil)
			r.Header.Set("Origin", "https://other.example.edu")
			r.Header.Set("Access-Control-Request-Method", "POST")
			r.Header.Set("Access-Control-Request-Headers", "authorization, content-type")
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, r)
			if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != tc.allow {
				t.Fatalf("got %d Allow %q %s; want %q", rec.Code, rec.Header().Get("Allow"), rec.Body, tc.allow)
			}
			if called != before || r.Method != tc.method {
				t.Fatal("method probing ran a handler or mutated the request")
			}
			if !strings.Contains(rec.Body.String(), `"code":"method_not_allowed"`) || strings.Contains(rec.Body.String(), `"type":`) {
				t.Fatalf("want the native error shape: %s", rec.Body)
			}
			for _, header := range []string{"Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Allow-Credentials"} {
				if rec.Header().Get(header) != "" {
					t.Fatalf("wrong method granted CORS: %s", header)
				}
			}
		})
	}
	for _, tc := range []struct{ method, path string }{
		{"HEAD", "/v1/things/one"}, {"GET", "/v1/things/recent"},
		{"PATCH", "/v1/things/recent"}, {"POST", "/v1/things/recent"},
		{"GET", "/v1/files/one/two"},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != http.StatusNoContent {
			t.Fatalf("supported %s %s changed: %d", tc.method, tc.path, rec.Code)
		}
	}
	for _, path := range []string{"/v1/unknown", "/v1/things/one/unknown", "/app", "/mcp"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("OPTIONS", path, nil))
		if rec.Code != http.StatusNotFound || rec.Header().Get("Allow") != "" {
			t.Fatalf("unregistered path %s = %d %v", path, rec.Code, rec.Header())
		}
	}
}
