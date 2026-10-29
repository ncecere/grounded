package httpapi_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/config"
)

func requireOpenAIError(t *testing.T, res *http.Response, status int, code, typ string) {
	t.Helper()
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	var body struct{ Error map[string]any }
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("not JSON: %s", raw)
	}
	message, hasMessage := body.Error["message"].(string)
	param, hasParam := body.Error["param"]
	if res.StatusCode != status || body.Error["code"] != code || body.Error["type"] != typ || !hasMessage || message == "" || !hasParam || param != nil {
		t.Fatalf("OpenAI error shape: got %d %s, want %d %s %s and message/param", res.StatusCode, raw, status, code, typ)
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("error must not be cached: %v", res.Header)
	}
}

func TestOpenAISessionAndURLMiddlewareErrors(t *testing.T) {
	app := newTestApp(t, nil)
	user := app.signIn("user")
	t.Run("expired session", func(t *testing.T) {
		req, _ := http.NewRequest("GET", app.URL+"/v1/models", nil)
		req.AddCookie(&http.Cookie{Name: "grounded_session", Value: "expired"})
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		requireOpenAIError(t, res, 401, "unauthorized", "authentication_error")
	})
	t.Run("CSRF refusal", func(t *testing.T) {
		req, _ := http.NewRequest("POST", app.URL+"/v1/chat/completions", strings.NewReader(`{}`))
		req.Header.Set("Origin", app.URL)
		req.Header.Set("Content-Type", "application/json")
		res, err := user.client.Do(req) // valid cookie, intentionally no CSRF token
		if err != nil {
			t.Fatal(err)
		}
		requireOpenAIError(t, res, 403, "csrf_failed", "permission_error")
	})
	t.Run("invalid query text", func(t *testing.T) {
		res, err := http.Get(app.URL + "/v1/models?q=%00")
		if err != nil {
			t.Fatal(err)
		}
		requireOpenAIError(t, res, 400, "invalid_text", "invalid_request_error")
	})
	t.Run("suspended user with a remaining session", func(t *testing.T) {
		// Exercise the request-time guard independently of the suspension
		// command's session revocation (also protects an in-flight race).
		if _, err := app.Pool.Exec(t.Context(), "UPDATE users SET status='suspended' WHERE id=$1", user.me.User.Id); err != nil {
			t.Fatal(err)
		}
		res, err := user.client.Get(app.URL + "/v1/models")
		if err != nil {
			t.Fatal(err)
		}
		requireOpenAIError(t, res, 403, "user_suspended", "permission_error")
	})
}

func TestOpenAISessionRateLimitKeepsItsEnvelopeAndRetryAfter(t *testing.T) {
	app := newTestApp(t, func(c *config.Config) { c.RequestsPerMinute = 1 })
	user := app.signIn("user") // /v1/me uses the first admitted user request
	res, err := user.client.Get(app.URL + "/v1/models")
	if err != nil {
		t.Fatal(err)
	}
	requireOpenAIError(t, res, 429, "rate_limited", "rate_limit_error")
	if res.Header.Get("Retry-After") == "" {
		t.Fatal("rate limit lost its Retry-After header")
	}
}

func TestOpenAIAuthenticationInternalFailuresKeepTheirEnvelope(t *testing.T) {
	app := newTestApp(t, nil)
	user := app.signIn("user")
	app.Pool.Close() // force both authentication lookups to fail, not return not-found
	t.Run("browser session", func(t *testing.T) {
		res, err := user.client.Get(app.URL + "/v1/models")
		if err != nil {
			t.Fatal(err)
		}
		requireOpenAIError(t, res, 500, "internal", "api_error")
	})
	t.Run("API key", func(t *testing.T) {
		req, _ := http.NewRequest("GET", app.URL+"/v1/models", nil)
		req.Header.Set("Authorization", "Bearer rag_"+strings.Repeat("a", 12)+"_"+strings.Repeat("b", 40))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		requireOpenAIError(t, res, 500, "internal", "api_error")
	})
}
