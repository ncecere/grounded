// Validation of a loaded configuration per process mode.

package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/secrets"
)

// Validate checks the configuration needed by a process mode.
// Modes: "serve", "api", "worker", "migrate". It includes the production
// safety checks (SafetyErrors).
func (c Config) Validate(mode string) error {
	errs := c.SafetyErrors(mode)
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	}
	if mode == "migrate" {
		return errors.Join(errs...)
	}
	errs = append(errs, c.validateProcess()...)
	errs = append(errs, c.validateIngest()...)
	errs = append(errs, c.Crawl.validate()...)
	errs = append(errs, c.Instance.validate()...)
	errs = append(errs, c.SMTP.validate(c.AppURL)...)
	errs = append(errs, c.Public.validate()...)
	if mode == "serve" || mode == "api" {
		if _, err := secrets.ParseKey(c.APIKeyPepper); err != nil {
			errs = append(errs, fmt.Errorf("API_KEY_PEPPER: %w (generate one with `openssl rand -base64 32`)", err))
		}
		errs = append(errs, c.validateWeb()...)
	}
	return errors.Join(errs...)
}

// validateProcess checks what every long-running mode needs: Valkey, the
// encryption keys and logging.
func (c Config) validateProcess() []error {
	var errs []error
	if c.ValkeyURL == "" {
		errs = append(errs, errors.New("VALKEY_URL is required"))
	}
	if _, err := secrets.ParseKey(c.EncryptionKey); err != nil {
		errs = append(errs, fmt.Errorf("ENCRYPTION_KEY: %w (generate one with `openssl rand -base64 32`)", err))
	}
	if c.EncryptionKeyPrevious != "" {
		if _, err := secrets.ParseKey(c.EncryptionKeyPrevious); err != nil {
			errs = append(errs, fmt.Errorf("ENCRYPTION_KEY_PREVIOUS: %w", err))
		}
	}
	if c.APIKeyPepperPrevious != "" {
		if _, err := secrets.ParseKey(c.APIKeyPepperPrevious); err != nil {
			errs = append(errs, fmt.Errorf("API_KEY_PEPPER_PREVIOUS: %w", err))
		} else if c.APIKeyPepper == "" {
			errs = append(errs, errors.New("API_KEY_PEPPER_PREVIOUS is set without API_KEY_PEPPER"))
		}
	}
	if !slices.Contains([]string{"debug", "info", "warn", "error"}, c.LogLevel) {
		errs = append(errs, errors.New("LOG_LEVEL must be debug, info, warn or error"))
	}
	if c.LogFormat != "json" && c.LogFormat != "text" {
		errs = append(errs, errors.New("LOG_FORMAT must be json or text"))
	}
	return errs
}

// validateIngest checks file storage, parsing and retrieval settings.
func (c Config) validateIngest() []error {
	var errs []error
	switch c.BlobBackend {
	case "fs":
		if c.BlobDir == "" {
			errs = append(errs, errors.New("BLOB_DIR is required when BLOB_BACKEND=fs"))
		}
	case "s3":
		if c.S3.Bucket == "" {
			errs = append(errs, errors.New("S3_BUCKET is required when BLOB_BACKEND=s3"))
		}
	default:
		errs = append(errs, errors.New("BLOB_BACKEND must be fs or s3"))
	}
	if c.TikaURL != "" {
		if u, err := url.Parse(c.TikaURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs = append(errs, errors.New("TIKA_URL must be an http(s) URL such as http://tika:9998"))
		}
	}
	if c.OCR.TesseractURL != "" {
		if u, err := url.Parse(c.OCR.TesseractURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs = append(errs, errors.New("OCR_TESSERACT_URL must be an http(s) URL such as http://grounded-ocr:8080"))
		}
	}
	for _, k := range c.TikaPreferKinds {
		if !slices.Contains([]string{"pdf", "docx", "pptx", "html"}, k) {
			errs = append(errs, fmt.Errorf("TIKA_PREFER_KINDS: unknown kind %q (use pdf, docx, pptx, html)", k))
		}
	}
	if c.RetrievalVectorWeight+c.RetrievalKeywordWeight <= 0 {
		errs = append(errs, errors.New("RETRIEVAL_VECTOR_WEIGHT and RETRIEVAL_KEYWORD_WEIGHT cannot both be 0"))
	}
	return errs
}

func (c Crawl) validate() []error {
	var errs []error
	if c.MaxPages < 1 {
		errs = append(errs, errors.New("CRAWL_MAX_PAGES must be at least 1"))
	}
	if c.OriginInterval < 0 {
		errs = append(errs, errors.New("CRAWL_ORIGIN_INTERVAL must not be negative"))
	}
	if c.Timeout <= 0 {
		errs = append(errs, errors.New("CRAWL_TIMEOUT must be positive"))
	}
	if c.MaxBodyBytes <= 0 {
		errs = append(errs, errors.New("CRAWL_MAX_BODY_BYTES must be positive"))
	}
	if c.Concurrency < 1 {
		errs = append(errs, errors.New("CRAWL_CONCURRENCY must be at least 1"))
	}
	if strings.ContainsAny(c.UserAgent, "\r\n") {
		errs = append(errs, errors.New("CRAWL_USER_AGENT must be a single line"))
	}
	return errs
}

func (in Instance) validate() []error {
	var errs []error
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 100 || hasControl(in.Name) {
		errs = append(errs, errors.New("INSTANCE_NAME must be 1 to 100 characters on one line"))
	}
	if utf8.RuneCountInString(in.OrgName) > 200 || hasControl(in.OrgName) {
		errs = append(errs, errors.New("ORG_NAME must be at most 200 characters on one line"))
	}
	if !slices.Contains(Themes, in.Theme) {
		errs = append(errs, fmt.Errorf("UI_THEME must be one of %s", strings.Join(Themes, ", ")))
	}
	if in.LogoURL != "" && !validLogoURL(in.LogoURL) {
		errs = append(errs, errors.New("UI_LOGO_URL must be an https URL or a same-origin path such as /logo.svg"))
	}
	if in.SupportURL != "" {
		u, err := url.Parse(in.SupportURL)
		ok := err == nil && !hasControl(in.SupportURL) && u.User == nil &&
			(((u.Scheme == "https" || u.Scheme == "http") && u.Host != "") || (u.Scheme == "mailto" && u.Opaque != ""))
		if !ok {
			errs = append(errs, errors.New("SUPPORT_URL must be an http(s) URL or a mailto: address"))
		}
	}
	return errs
}

// validLogoURL accepts https://host/... or a same-origin absolute path
// ("/logo.svg", not "//host" or "/\host", which browsers treat as hosts).
func validLogoURL(s string) bool {
	if hasControl(s) || strings.ContainsAny(s, " \\\"'<>") {
		return false
	}
	if strings.HasPrefix(s, "/") {
		return !strings.HasPrefix(s, "//")
	}
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil
}

func hasControl(s string) bool {
	return strings.IndexFunc(s, unicode.IsControl) >= 0
}

// validateWeb checks what serving the web app and API needs: the public
// origin and a sign-in method.
func (c Config) validateWeb() []error {
	var errs []error
	u, err := url.Parse(c.AppURL)
	if c.AppURL == "" || err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return append(errs, errors.New("APP_URL must be an origin such as https://rag.example.edu"))
	}
	// https and DEV_AUTH on a reachable host: SafetyErrors.
	if c.TeamRequestURL != "" {
		if t, err := url.Parse(c.TeamRequestURL); err != nil || (t.Scheme != "https" && t.Scheme != "http") || t.Host == "" {
			errs = append(errs, errors.New("TEAM_REQUEST_URL must be an http(s) URL"))
		}
	}
	return append(errs, c.validateSignIn()...)
}

// validateSignIn checks that a sign-in method is configured, and OIDC's
// settings when it is enabled.
func (c Config) validateSignIn() []error {
	var errs []error
	if !c.DevAuth && !c.OIDC.Enabled() {
		errs = append(errs, errors.New("no sign-in method: set OIDC_ISSUER (or DEV_AUTH=true for local development)"))
	}
	if c.OIDC.Enabled() {
		if c.OIDC.ClientID == "" || c.OIDC.ClientSecret == "" {
			errs = append(errs, errors.New("OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required with OIDC_ISSUER"))
		}
		if !slices.Contains(c.OIDC.Scopes, "openid") {
			errs = append(errs, errors.New("OIDC_SCOPES must include openid"))
		}
		if c.OIDC.EmailClaim == "" {
			errs = append(errs, errors.New("OIDC_EMAIL_CLAIM must not be empty"))
		}
		if c.OIDC.GroupsClaim == "" {
			errs = append(errs, errors.New("OIDC_GROUPS_CLAIM must not be empty (the default is groups)"))
		}
	}
	return errs
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
