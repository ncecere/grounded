// Package captcha verifies CAPTCHA tokens when anonymous sessions start
// (docs/phase4-publishing.md §2 decision 4, §6). The verifier is pluggable:
// None (the default) accepts every request, Turnstile checks Cloudflare
// Turnstile tokens. Other providers implement Verifier.
package captcha

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/ncecere/grounded/internal/config"
)

// ErrFailed is a token that is missing, invalid, expired or already used.
var ErrFailed = errors.New("captcha failed")

// Verifier checks a CAPTCHA token.
type Verifier interface {
	// Provider names the verifier: none or turnstile.
	Provider() string
	// SiteKey is the public key the browser widget needs ("" for none).
	SiteKey() string
	// Verify returns nil when the token is valid, ErrFailed when it is
	// not, and another error when the provider could not be asked.
	Verify(ctx context.Context, token, remoteIP string) error
}

// None accepts every request.
type None struct{}

func (None) Provider() string                             { return config.CaptchaNone }
func (None) SiteKey() string                              { return "" }
func (None) Verify(context.Context, string, string) error { return nil }

// New builds the configured verifier.
func New(p config.Public) Verifier {
	if p.CaptchaProvider != config.CaptchaTurnstile {
		return None{}
	}
	return &Turnstile{
		Site: p.TurnstileSiteKey, Secret: p.TurnstileSecretKey, URL: p.TurnstileVerifyURL,
		Client: &http.Client{Timeout: 10 * time.Second},
	}
}
