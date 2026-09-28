// SMTP settings for notification email (docs/phase4-publishing.md §8).
// Email is off while SMTP_HOST is empty; in-app notifications always work.

package config

import (
	"errors"
	"net/mail"
	"slices"
	"strings"
)

// SMTP TLS modes.
const (
	SMTPStartTLS = "starttls" // plain connection upgraded with STARTTLS (required), usually port 587
	SMTPTLS      = "tls"      // implicit TLS, usually port 465
	SMTPNoTLS    = "none"     // no encryption; only for a local relay or a development catcher
)

// SMTP is the outgoing mail relay the operator provides.
type SMTP struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string // e.g. "Grounded <rag@example.edu>"
	TLS      string // SMTPStartTLS, SMTPTLS or SMTPNoTLS
}

// Enabled reports whether email notifications are configured.
func (s SMTP) Enabled() bool { return s.Host != "" }

var smtpSettings = []setting{
	{key: "SMTP_HOST", apply: str(func(c *Config) *string { return &c.SMTP.Host })},
	{key: "SMTP_PORT", apply: integer(func(c *Config) *int { return &c.SMTP.Port }, 1, 65535)},
	{key: "SMTP_USERNAME", apply: str(func(c *Config) *string { return &c.SMTP.Username })},
	{key: "SMTP_PASSWORD", secret: true, apply: str(func(c *Config) *string { return &c.SMTP.Password })},
	{key: "SMTP_FROM", apply: str(func(c *Config) *string { return &c.SMTP.From })},
	{key: "SMTP_TLS", apply: func(c *Config, v string) error {
		c.SMTP.TLS = strings.ToLower(strings.TrimSpace(v))
		return nil
	}},
}

// Kept in this file so the settings table in settings.go stays about the
// core process; LoadFrom reads both.
func init() { settings = append(settings, smtpSettings...) }

// validate checks the relay settings when email is enabled. Links in
// emails are built from APP_URL, so the worker needs it too.
func (s SMTP) validate(appURL string) []error {
	if !s.Enabled() {
		return nil
	}
	var errs []error
	if strings.ContainsAny(s.Host, " /:\r\n") {
		errs = append(errs, errors.New("SMTP_HOST must be a host name or IP address without a port (set SMTP_PORT)"))
	}
	if !slices.Contains([]string{SMTPStartTLS, SMTPTLS, SMTPNoTLS}, s.TLS) {
		errs = append(errs, errors.New("SMTP_TLS must be starttls, tls or none"))
	}
	if a, err := mail.ParseAddress(s.From); s.From == "" || err != nil || hasControl(s.From) || a.Address == "" {
		errs = append(errs, errors.New(`SMTP_FROM must be an address such as "Grounded <rag@example.edu>"`))
	}
	if (s.Username == "") != (s.Password == "") {
		errs = append(errs, errors.New("SMTP_USERNAME and SMTP_PASSWORD must be set together"))
	}
	if s.Username != "" && s.TLS == SMTPNoTLS && !isLoopbackHost(s.Host) {
		errs = append(errs, errors.New("SMTP_TLS=none cannot send a password to a remote relay; use starttls or tls"))
	}
	if appURL == "" {
		errs = append(errs, errors.New("APP_URL is required when SMTP_HOST is set (email links point to it)"))
	}
	return errs
}
