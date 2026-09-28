package captcha

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/ncecere/grounded/internal/config"
)

// TurnstileVerifyURL is Cloudflare's siteverify endpoint.
const TurnstileVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// TurnstileScriptOrigin serves the browser widget (added to the Content
// Security Policy when Turnstile is on).
const TurnstileScriptOrigin = "https://challenges.cloudflare.com"

// Turnstile verifies Cloudflare Turnstile tokens server-side.
type Turnstile struct {
	Site, Secret string
	// URL overrides TurnstileVerifyURL (tests).
	URL    string
	Client *http.Client
}

func (t *Turnstile) Provider() string { return config.CaptchaTurnstile }
func (t *Turnstile) SiteKey() string  { return t.Site }

// Verify posts the token to siteverify. An empty token fails without a
// request.
func (t *Turnstile) Verify(ctx context.Context, token, remoteIP string) error {
	token = strings.TrimSpace(token)
	if token == "" || len(token) > 2048 {
		return ErrFailed
	}
	form := url.Values{"secret": {t.Secret}, "response": {token}}
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	endpoint := t.URL
	if endpoint == "" {
		endpoint = TurnstileVerifyURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := t.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("turnstile: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("turnstile: siteverify answered %d", resp.StatusCode)
	}
	var out struct {
		Success    bool     `json:"success"`
		ErrorCodes []string `json:"error-codes"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&out); err != nil {
		return fmt.Errorf("turnstile: %w", err)
	}
	if !out.Success {
		for _, c := range out.ErrorCodes {
			// Our own misconfiguration is an outage, not the visitor's fault.
			if c == "missing-input-secret" || c == "invalid-input-secret" || c == "internal-error" {
				return fmt.Errorf("turnstile: %s", c)
			}
		}
		return ErrFailed
	}
	return nil
}
