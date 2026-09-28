// Package preflight holds the production-readiness warnings
// (docs/phase5-deploy.md §5 E7, DESIGN.md §16): settings that are allowed
// but deserve a platform admin's attention. They are logged when a process
// starts, returned on the admin Overview and printed by `grounded doctor`.
//
// The settings that stop a process from starting at all are
// config.SafetyErrors; these only warn.
package preflight

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Severity of a finding.
type Severity string

const (
	// Warning is something to fix before relying on the install.
	Warning Severity = "warning"
	// Info is worth knowing, and may be intended.
	Info Severity = "info"
)

// Codes are stable identifiers of findings, for the UI and scripts.
const (
	CodeCrawlAllowlistEmpty     = "crawl_allowlist_empty"
	CodePublicWithoutModeration = "public_agents_without_moderation"
	CodeSMTPNotConfigured       = "smtp_not_configured"
	CodeOIDCNoDomainRestriction = "oidc_no_domain_restriction"
)

// Finding is one warning. Message says what is wrong; Fix says what to do.
type Finding struct {
	Code     string   `json:"code"`
	Severity Severity `json:"severity"`
	Message  string   `json:"message"`
	Fix      string   `json:"fix"`
}

// Queries are the reads Check needs (dbgen.Queries implements them).
type Queries interface {
	ListAllowlist(ctx context.Context) ([]dbgen.CrawlAllowlist, error)
	GetPlatformSettings(ctx context.Context) (dbgen.PlatformSetting, error)
	GetModerationPolicy(ctx context.Context, audience string) (dbgen.ModerationPolicy, error)
}

// Check returns every finding, warnings before information.
func Check(ctx context.Context, cfg config.Config, q Queries) ([]Finding, error) {
	var out []Finding
	allow, err := q.ListAllowlist(ctx)
	if err != nil {
		return nil, fmt.Errorf("crawl allowlist: %w", err)
	}
	if len(allow) == 0 {
		out = append(out, Finding{
			Code: CodeCrawlAllowlistEmpty, Severity: Warning,
			Message: "The crawl allowlist is empty, so no web source can be crawled.",
			Fix:     "Add host patterns under Administration > Crawl domains, or set CRAWL_ALLOWLIST_SEED before the first start.",
		})
	}
	public, err := publicWithoutModeration(ctx, q)
	if err != nil {
		return nil, err
	}
	if public {
		out = append(out, Finding{
			Code: CodePublicWithoutModeration, Severity: Warning,
			Message: "Public agents are turned on, but the public audience has no moderation provider.",
			Fix:     "Choose a provider for the public audience under Administration > Moderation, or turn public agents off.",
		})
	}
	return append(out, ConfigFindings(cfg)...), nil
}

// publicWithoutModeration reports whether the platform's public switch is
// on while the public audience's moderation policy names no provider.
func publicWithoutModeration(ctx context.Context, q Queries) (bool, error) {
	st, err := q.GetPlatformSettings(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	} else if err != nil {
		return false, fmt.Errorf("platform settings: %w", err)
	}
	if !st.PublicAgentsEnabled {
		return false, nil
	}
	pol, err := q.GetModerationPolicy(ctx, authz.AudiencePublic)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil // the default policy names no provider
	} else if err != nil {
		return false, fmt.Errorf("public moderation policy: %w", err)
	}
	return !pol.ModelID.Valid, nil
}

// ConfigFindings are the findings that need only the configuration.
func ConfigFindings(cfg config.Config) []Finding {
	var out []Finding
	if !cfg.SMTP.Enabled() {
		out = append(out, Finding{
			Code: CodeSMTPNotConfigured, Severity: Warning,
			Message: "Email notifications are off: SMTP_HOST is not set. In-app notifications still work.",
			Fix:     "Set SMTP_HOST, SMTP_FROM and the SMTP credentials (on Kubernetes, the grounded-smtp secret) to email invitations and failure alerts.",
		})
	}
	if cfg.OIDC.Enabled() && len(cfg.OIDC.AllowedEmailDomains) == 0 {
		out = append(out, Finding{
			Code: CodeOIDCNoDomainRestriction, Severity: Info,
			Message: "Anyone the OIDC provider signs in can use Grounded: OIDC_ALLOWED_EMAIL_DOMAINS is empty.",
			Fix:     "Set OIDC_ALLOWED_EMAIL_DOMAINS (for example example.edu), or limit who may use the application in the identity provider. Ignore this if the provider already does.",
		})
	}
	return out
}

// Log writes each finding to log: warnings at WARN, information at INFO.
func Log(ctx context.Context, log *slog.Logger, findings []Finding) {
	for _, f := range findings {
		level := slog.LevelWarn
		if f.Severity == Info {
			level = slog.LevelInfo
		}
		log.Log(ctx, level, "preflight: "+f.Message, "code", f.Code, "fix", f.Fix)
	}
}
