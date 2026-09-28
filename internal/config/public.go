// Public access settings (docs/phase4-publishing.md §5-§7): anonymous
// session lifetime and the CAPTCHA verifier used when anonymous sessions
// are created.

package config

import (
	"errors"
	"strings"
	"time"
)

// CAPTCHA providers.
const (
	CaptchaNone      = "none"
	CaptchaTurnstile = "turnstile"
)

// Public configures anonymous access to public agents.
type Public struct {
	// AnonSessionTTL is how long an anonymous session lives after its last
	// use (ANON_SESSION_TTL, default 24h).
	AnonSessionTTL time.Duration
	// CaptchaProvider is none (default) or turnstile.
	CaptchaProvider    string
	TurnstileSiteKey   string
	TurnstileSecretKey string
	// TurnstileVerifyURL overrides Cloudflare's siteverify endpoint. It has
	// no environment variable: only tests set it.
	TurnstileVerifyURL string
}

var publicSettings = []setting{
	{key: "ANON_SESSION_TTL", apply: duration(func(c *Config) *time.Duration { return &c.Public.AnonSessionTTL }, 5*time.Minute, 30*24*time.Hour)},
	{key: "CAPTCHA_PROVIDER", apply: func(c *Config, v string) error {
		c.Public.CaptchaProvider = strings.ToLower(strings.TrimSpace(v))
		if c.Public.CaptchaProvider == "" {
			c.Public.CaptchaProvider = CaptchaNone
		}
		return nil
	}},
	{key: "TURNSTILE_SITE_KEY", apply: str(func(c *Config) *string { return &c.Public.TurnstileSiteKey })},
	{key: "TURNSTILE_SECRET_KEY", secret: true, apply: str(func(c *Config) *string { return &c.Public.TurnstileSecretKey })},
}

func init() { settings = append(settings, publicSettings...) }

// validate checks the CAPTCHA configuration.
func (p Public) validate() []error {
	var errs []error
	switch p.CaptchaProvider {
	case "", CaptchaNone:
	case CaptchaTurnstile:
		if p.TurnstileSiteKey == "" || p.TurnstileSecretKey == "" {
			errs = append(errs, errors.New("CAPTCHA_PROVIDER=turnstile needs TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY"))
		}
	default:
		errs = append(errs, errors.New("CAPTCHA_PROVIDER must be none or turnstile"))
	}
	return errs
}
