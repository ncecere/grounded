package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpx"
)

// A request its client cancelled is counted as 499, not as a 5xx, so page
// reloads don't show up as server errors in the metrics or the error SLO.
func TestChainRecordsClientCancellationAs499(t *testing.T) {
	d := metricsTestDeps("")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/notifications", func(w http.ResponseWriter, r *http.Request) {
		httpx.Error(w, http.StatusInternalServerError, "internal", "failed") // e.g. a query that saw the cancel
	})
	h := chain(mux, d)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/v1/notifications", nil).WithContext(ctx))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/v1/notifications", nil))

	rec := httptest.NewRecorder()
	d.Metrics.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body := rec.Body.String()
	if !strings.Contains(body, `route="GET /v1/notifications",status="499"} 1`) {
		t.Fatalf("the cancelled request isn't counted as 499:\n%s", grepLines(body, "grounded_http_requests_total"))
	}
	if !strings.Contains(body, `route="GET /v1/notifications",status="500"} 1`) {
		t.Fatalf("the real failure isn't counted as 500:\n%s", grepLines(body, "grounded_http_requests_total"))
	}
}

func grepLines(s, sub string) string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if strings.Contains(l, sub) {
			out = append(out, l)
		}
	}
	return strings.Join(out, "\n")
}

// U+0000 in a path or query would reach Postgres and fail as a 500; the chain
// answers 400 before any handler runs.
func TestChainRefusesNULInURL(t *testing.T) {
	d := metricsTestDeps("")
	mux := http.NewServeMux()
	reached := 0
	mux.HandleFunc("GET /v1/teams/{team}", func(w http.ResponseWriter, r *http.Request) {
		reached++
		httpx.JSON(w, http.StatusOK, map[string]string{"team": r.PathValue("team")})
	})
	h := chain(mux, d)
	for _, tc := range []struct {
		name, target string
		want         int
	}{
		{"path", "/v1/teams/%00", http.StatusBadRequest},
		{"path in the middle", "/v1/teams/a%00b", http.StatusBadRequest},
		{"query", "/v1/teams/demo?q=%00", http.StatusBadRequest},
		{"query key", "/v1/teams/demo?a%00=1", http.StatusBadRequest},
		{"a literal percent-00 is text, not a NUL", "/v1/teams/demo?q=%2500", http.StatusOK},
		{"plain", "/v1/teams/demo?q=ok", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := reached
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest("GET", tc.target, nil))
			if rec.Code != tc.want {
				t.Fatalf("%s: want %d, got %d %s", tc.target, tc.want, rec.Code, rec.Body)
			}
			if tc.want == http.StatusBadRequest && (reached != before || !strings.Contains(rec.Body.String(), `"invalid_text"`)) {
				t.Fatalf("%s: the handler ran or the code is wrong: %s", tc.target, rec.Body)
			}
		})
	}
}

// The OpenAI-compatible endpoint reads its own body; a NUL there is a 400 in OpenAI's error shape, not a 500 (#109).
func TestOpenAIRequestRefusesNUL(t *testing.T) {
	rec := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"agent:t/a","messages":[{"role":"user","content":"a\u0000b"}]}`))
	if _, ok := readOpenAIRequest(rec, r); ok {
		t.Fatal("a message with U+0000 was accepted")
	}
	body := rec.Body.String()
	if rec.Code != http.StatusBadRequest || !strings.Contains(body, `"invalid_text"`) || !strings.Contains(body, `"type"`) {
		t.Fatalf("want 400 invalid_text in OpenAI's shape, got %d %s", rec.Code, body)
	}
	rec = httptest.NewRecorder()
	r = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"agent:t/a","messages":[{"role":"user","content":"ok"}]}`))
	if _, ok := readOpenAIRequest(rec, r); !ok {
		t.Fatalf("a plain request was refused: %d %s", rec.Code, rec.Body)
	}
}

// An OpenAI client reads error.type; an internal failure on the OpenAI-compatible endpoints has the same four fields as any other error there
// (QA pass v0.6.0, #116).
func TestOpenAIInternalErrorHasTheOpenAIShape(t *testing.T) {
	rec := httptest.NewRecorder()
	openaiFail(rec, httptest.NewRequest("GET", "/v1/models", nil), errors.New("the database fell over"))
	var env struct{ Error map[string]any }
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("not JSON: %s", rec.Body)
	}
	if rec.Code != http.StatusInternalServerError || env.Error["type"] != "api_error" || env.Error["code"] != "internal" || env.Error["message"] == "" {
		t.Fatalf("an internal failure = %d %s, want 500 with type api_error, code internal and a message", rec.Code, rec.Body)
	}
	if _, ok := env.Error["param"]; !ok {
		t.Errorf("the error has no param field: %s", rec.Body)
	}
	if strings.Contains(rec.Body.String(), "database") {
		t.Errorf("the error leaks the cause: %s", rec.Body)
	}
}
