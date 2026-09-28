package captcha

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ncecere/grounded/internal/config"
)

// fakeTurnstile answers like Cloudflare's siteverify: the token "good"
// passes, "bad" fails, and a wrong secret is a configuration error.
func fakeTurnstile(t *testing.T, seen *[]string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		*seen = append(*seen, r.Form.Get("remoteip"))
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Form.Get("secret") != "s3cret":
			_, _ = w.Write([]byte(`{"success":false,"error-codes":["invalid-input-secret"]}`))
		case r.Form.Get("response") == "good":
			_, _ = w.Write([]byte(`{"success":true,"error-codes":[]}`))
		default:
			_, _ = w.Write([]byte(`{"success":false,"error-codes":["invalid-input-response"]}`))
		}
	}))
}

func TestTurnstile(t *testing.T) {
	var seen []string
	srv := fakeTurnstile(t, &seen)
	defer srv.Close()
	v := New(config.Public{CaptchaProvider: config.CaptchaTurnstile, TurnstileSiteKey: "site", TurnstileSecretKey: "s3cret", TurnstileVerifyURL: srv.URL})
	if v.Provider() != "turnstile" || v.SiteKey() != "site" {
		t.Fatalf("provider %q site %q", v.Provider(), v.SiteKey())
	}
	ctx := context.Background()
	if err := v.Verify(ctx, "good", "203.0.113.9"); err != nil {
		t.Fatalf("good token: %v", err)
	}
	if err := v.Verify(ctx, "bad", ""); !errors.Is(err, ErrFailed) {
		t.Fatalf("bad token: %v", err)
	}
	if err := v.Verify(ctx, "", ""); !errors.Is(err, ErrFailed) {
		t.Fatalf("empty token: %v", err)
	}
	if len(seen) != 2 || seen[0] != "203.0.113.9" {
		t.Fatalf("requests %v (the empty token must not be sent)", seen)
	}
	wrong := New(config.Public{CaptchaProvider: config.CaptchaTurnstile, TurnstileSiteKey: "site", TurnstileSecretKey: "nope", TurnstileVerifyURL: srv.URL})
	if err := wrong.Verify(ctx, "good", ""); err == nil || errors.Is(err, ErrFailed) {
		t.Fatalf("a bad secret must be an outage, got %v", err)
	}
	srv.Close()
	if err := v.Verify(ctx, "good", ""); err == nil || errors.Is(err, ErrFailed) {
		t.Fatalf("unreachable siteverify must be an outage, got %v", err)
	}
}

func TestNone(t *testing.T) {
	v := New(config.Public{})
	if v.Provider() != "none" || v.SiteKey() != "" || v.Verify(context.Background(), "", "") != nil {
		t.Fatal("none must accept everything")
	}
}
