// The settings table: every environment variable (and YAML key) with its
// parser and bounds.

package config

import (
	"cmp"
	"fmt"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/crawl"
)

type setting struct {
	key    string // environment variable name; YAML key is strings.ToLower(key)
	secret bool   // may also be supplied via KEY_FILE
	apply  func(*Config, string) error
}

func str(dst func(*Config) *string) func(*Config, string) error {
	return func(c *Config, v string) error { *dst(c) = strings.TrimSpace(v); return nil }
}

func boolean(dst func(*Config) *bool) func(*Config, string) error {
	return func(c *Config, v string) error {
		b, err := strconv.ParseBool(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("must be true or false")
		}
		*dst(c) = b
		return nil
	}
}

func integer(dst func(*Config) *int, min, max int) func(*Config, string) error {
	return func(c *Config, v string) error {
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil || n < min || n > max {
			return fmt.Errorf("must be an integer from %d to %d", min, max)
		}
		*dst(c) = n
		return nil
	}
}

func float(dst func(*Config) *float64, min, max float64) func(*Config, string) error {
	return func(c *Config, v string) error {
		f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil || f < min || f > max {
			return fmt.Errorf("must be a number from %g to %g", min, max)
		}
		*dst(c) = f
		return nil
	}
}

func duration(dst func(*Config) *time.Duration, min, max time.Duration) func(*Config, string) error {
	return func(c *Config, v string) error {
		d, err := time.ParseDuration(strings.TrimSpace(v))
		if err != nil || d < min || d > max {
			return fmt.Errorf("must be a duration from %s to %s", min, max)
		}
		*dst(c) = d
		return nil
	}
}

// Bounds of HEALTH_CHECK_INTERVAL: more often than every 5 minutes would
// only load the gateways; less often than daily isn't a health check.
const (
	minHealthInterval = 5 * time.Minute
	maxHealthInterval = 24 * time.Hour
)

// healthInterval parses HEALTH_CHECK_INTERVAL: a duration, or 0 or "off"
// to turn the scheduled re-test off.
func healthInterval(c *Config, v string) error {
	v = strings.ToLower(strings.TrimSpace(v))
	if v == "0" || v == "off" {
		c.HealthCheckInterval = 0
		return nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || (d != 0 && (d < minHealthInterval || d > maxHealthInterval)) {
		return fmt.Errorf("must be 0 or \"off\", or a duration from %s to %s", minHealthInterval, maxHealthInterval)
	}
	c.HealthCheckInterval = d
	return nil
}

func list(dst func(*Config) *[]string, lower bool) func(*Config, string) error {
	return func(c *Config, v string) error {
		var out []string
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if lower {
				part = strings.ToLower(part)
			}
			if part != "" {
				out = append(out, part)
			}
		}
		*dst(c) = out
		return nil
	}
}

var settings = append([]setting{
	{key: "APP_URL", apply: str(func(c *Config) *string { return &c.AppURL })},
	{key: "HTTP_ADDR", apply: str(func(c *Config) *string { return &c.HTTPAddr })},
	{key: "WORKER_HTTP_ADDR", apply: str(func(c *Config) *string { return &c.WorkerHTTPAddr })},
	{key: "METRICS_ADDR", apply: str(func(c *Config) *string { return &c.MetricsAddr })},
	{key: "DATABASE_URL", secret: true, apply: str(func(c *Config) *string { return &c.DatabaseURL })},
	{key: "VALKEY_URL", secret: true, apply: str(func(c *Config) *string { return &c.ValkeyURL })},
	{key: "VALKEY_PREFIX", apply: str(func(c *Config) *string { return &c.ValkeyPrefix })},
	{key: "ENCRYPTION_KEY", secret: true, apply: str(func(c *Config) *string { return &c.EncryptionKey })},
	{key: "ENCRYPTION_KEY_PREVIOUS", secret: true, apply: str(func(c *Config) *string { return &c.EncryptionKeyPrevious })},
	{key: "MIGRATE_ON_START", apply: boolean(func(c *Config) *bool { return &c.MigrateOnStart })},
	{key: "API_KEY_PEPPER", secret: true, apply: str(func(c *Config) *string { return &c.APIKeyPepper })},
	{key: "API_KEY_PEPPER_PREVIOUS", secret: true, apply: str(func(c *Config) *string { return &c.APIKeyPepperPrevious })},
	{key: "BLOB_BACKEND", apply: str(func(c *Config) *string { return &c.BlobBackend })},
	{key: "BLOB_DIR", apply: str(func(c *Config) *string { return &c.BlobDir })},
	{key: "S3_ENDPOINT", apply: str(func(c *Config) *string { return &c.S3.Endpoint })},
	{key: "S3_REGION", apply: str(func(c *Config) *string { return &c.S3.Region })},
	{key: "S3_BUCKET", apply: str(func(c *Config) *string { return &c.S3.Bucket })},
	{key: "S3_ACCESS_KEY", secret: true, apply: str(func(c *Config) *string { return &c.S3.AccessKey })},
	{key: "S3_SECRET_KEY", secret: true, apply: str(func(c *Config) *string { return &c.S3.SecretKey })},
	{key: "S3_CA_FILE", apply: str(func(c *Config) *string { return &c.S3.CAFile })},
	{key: "S3_PREFIX", apply: str(func(c *Config) *string { return &c.S3.Prefix })},
	{key: "S3_FORCE_PATH_STYLE", apply: boolean(func(c *Config) *bool { return &c.S3.ForcePathStyle })},
	{key: "MAX_UPLOAD_BYTES", apply: func(c *Config, v string) error {
		n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		if err != nil || n < 1<<10 || n > 10<<30 {
			return fmt.Errorf("must be between 1024 and 10737418240")
		}
		c.MaxUploadBytes = n
		return nil
	}},
	{key: "INGEST_MAX_INFLIGHT", apply: integer(func(c *Config) *int { return &c.IngestMaxInflight }, 1, 10000)},
	{key: "INGEST_MAX_INFLIGHT_PER_TEAM", apply: integer(func(c *Config) *int { return &c.IngestMaxInflightTeam }, 1, 10000)},
	{key: "INGEST_CONCURRENCY", apply: integer(func(c *Config) *int { return &c.IngestConcurrency }, 1, 256)},
	{key: "EMBED_BATCH_SIZE", apply: integer(func(c *Config) *int { return &c.EmbedBatchSize }, 1, 2048)},
	{key: "EMBED_BATCH_TOKENS", apply: integer(func(c *Config) *int { return &c.EmbedBatchTokens }, 0, 10_000_000)},
	{key: "EMBED_BATCH_WAIT", apply: duration(func(c *Config) *time.Duration { return &c.EmbedBatchWait }, 0, 10*time.Second)},
	{key: "PROFILE_MIGRATION_GRACE_DAYS", apply: integer(func(c *Config) *int { return &c.ProfileMigrationGraceDays }, 0, 90)},
	{key: "EVALUATION_CONCURRENCY", apply: integer(func(c *Config) *int { return &c.EvaluationConcurrency }, 1, 8)},
	{key: "HEALTH_CHECK_INTERVAL", apply: healthInterval},
	{key: "VECTOR_EXACT_THRESHOLD", apply: func(c *Config, v string) error {
		n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		if err != nil || n < 0 || n > 100_000_000 {
			return fmt.Errorf("must be between 0 and 100000000")
		}
		c.VectorExactThreshold = n
		return nil
	}},
	{key: "BOILERPLATE_WEB", apply: boolean(func(c *Config) *bool { return &c.Boilerplate.Web })},
	{key: "BOILERPLATE_UPLOAD", apply: boolean(func(c *Config) *bool { return &c.Boilerplate.Upload })},
	{key: "BOILERPLATE_MIN_DOCS", apply: integer(func(c *Config) *int { return &c.Boilerplate.MinDocs }, 2, 100000)},
	{key: "BOILERPLATE_RATIO", apply: float(func(c *Config) *float64 { return &c.Boilerplate.Ratio }, 0.05, 1)},
	{key: "VECTOR_EF_SEARCH", apply: integer(func(c *Config) *int { return &c.VectorEfSearch }, 10, 1000)},
	{key: "RETRIEVAL_VECTOR_WEIGHT", apply: float(func(c *Config) *float64 { return &c.RetrievalVectorWeight }, 0, 1)},
	{key: "RETRIEVAL_KEYWORD_WEIGHT", apply: float(func(c *Config) *float64 { return &c.RetrievalKeywordWeight }, 0, 1)},
	{key: "MODERATION_TIMEOUT", apply: duration(func(c *Config) *time.Duration { return &c.ModerationTimeout }, time.Second, 2*time.Minute)},
	{key: "TIKA_URL", apply: str(func(c *Config) *string { return &c.TikaURL })},
	{key: "TIKA_TIMEOUT", apply: duration(func(c *Config) *time.Duration { return &c.TikaTimeout }, time.Second, time.Hour)},
	{key: "TIKA_PREFER_KINDS", apply: list(func(c *Config) *[]string { return &c.TikaPreferKinds }, true)},
	{key: "PDF_WORKERS", apply: integer(func(c *Config) *int { return &c.PDFWorkers }, 1, 64)},
	{key: "OCR_TESSERACT_URL", apply: str(func(c *Config) *string { return &c.OCR.TesseractURL })},
	{key: "OCR_TIMEOUT", apply: duration(func(c *Config) *time.Duration { return &c.OCR.Timeout }, time.Second, time.Hour)},
	{key: "OCR_MAX_PAGES_PER_DOCUMENT", apply: integer(func(c *Config) *int { return &c.OCR.MaxPagesPerDocument }, 1, 5000)},
	{key: "OCR_CONCURRENCY", apply: integer(func(c *Config) *int { return &c.OCR.Concurrency }, 1, 64)},
	{key: "CRAWL_MAX_PAGES", apply: integer(func(c *Config) *int { return &c.Crawl.MaxPages }, 1, 1_000_000)},
	{key: "CRAWL_ORIGIN_INTERVAL", apply: duration(func(c *Config) *time.Duration { return &c.Crawl.OriginInterval }, 100*time.Millisecond, time.Minute)},
	{key: "CRAWL_USER_AGENT", apply: str(func(c *Config) *string { return &c.Crawl.UserAgent })},
	{key: "CRAWL_TIMEOUT", apply: duration(func(c *Config) *time.Duration { return &c.Crawl.Timeout }, time.Second, 5*time.Minute)},
	{key: "CRAWL_MAX_BODY_BYTES", apply: func(c *Config, v string) error {
		n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		if err != nil || n < 64<<10 || n > 1<<30 {
			return fmt.Errorf("must be between 65536 and 1073741824")
		}
		c.Crawl.MaxBodyBytes = n
		return nil
	}},
	{key: "CRAWL_CONCURRENCY", apply: integer(func(c *Config) *int { return &c.Crawl.Concurrency }, 1, 256)},
	{key: "CRAWL_ALLOWLIST_SEED", apply: func(c *Config, v string) error {
		var out []string
		for _, part := range strings.Split(v, ",") {
			if strings.TrimSpace(part) == "" {
				continue
			}
			p, err := crawl.NormalizeHostPattern(part, true)
			if err != nil {
				return fmt.Errorf("invalid pattern %q: %w", strings.TrimSpace(part), err)
			}
			if !slices.Contains(out, p) {
				out = append(out, p)
			}
		}
		c.Crawl.AllowlistSeed = out
		return nil
	}},
	{key: "INSTANCE_NAME", apply: func(c *Config, v string) error {
		c.Instance.Name = cmp.Or(strings.TrimSpace(v), DefaultInstanceName)
		return nil
	}},
	{key: "ORG_NAME", apply: str(func(c *Config) *string { return &c.Instance.OrgName })},
	{key: "UI_THEME", apply: func(c *Config, v string) error {
		c.Instance.Theme = cmp.Or(strings.ToLower(strings.TrimSpace(v)), "neutral")
		return nil
	}},
	{key: "UI_LOGO_URL", apply: str(func(c *Config) *string { return &c.Instance.LogoURL })},
	{key: "SUPPORT_URL", apply: str(func(c *Config) *string { return &c.Instance.SupportURL })},
	{key: "LOG_LEVEL", apply: str(func(c *Config) *string { return &c.LogLevel })},
	{key: "LOG_FORMAT", apply: str(func(c *Config) *string { return &c.LogFormat })},
	{key: "TEAM_REQUEST_URL", apply: str(func(c *Config) *string { return &c.TeamRequestURL })},
	{key: "DEV_AUTH", apply: boolean(func(c *Config) *bool { return &c.DevAuth })},
	{key: "DEV_AUTH_GROUPS", apply: devGroups},
	{key: "OIDC_ISSUER", apply: str(func(c *Config) *string { return &c.OIDC.Issuer })},
	{key: "OIDC_CLIENT_ID", apply: str(func(c *Config) *string { return &c.OIDC.ClientID })},
	{key: "OIDC_CLIENT_SECRET", secret: true, apply: str(func(c *Config) *string { return &c.OIDC.ClientSecret })},
	{key: "OIDC_SCOPES", apply: list(func(c *Config) *[]string { return &c.OIDC.Scopes }, false)},
	{key: "OIDC_EMAIL_CLAIM", apply: str(func(c *Config) *string { return &c.OIDC.EmailClaim })},
	{key: "OIDC_GROUPS_CLAIM", apply: str(func(c *Config) *string { return &c.OIDC.GroupsClaim })},
	{key: "OIDC_REQUIRE_VERIFIED_EMAIL", apply: boolean(func(c *Config) *bool { return &c.OIDC.RequireVerifiedEmail })},
	{key: "OIDC_ALLOWED_EMAIL_DOMAINS", apply: list(func(c *Config) *[]string { return &c.OIDC.AllowedEmailDomains }, true)},
	{key: "BOOTSTRAP_ADMIN_SUBJECT", apply: str(func(c *Config) *string { return &c.OIDC.BootstrapAdminSubject })},
	{key: "SESSION_TTL", apply: duration(func(c *Config) *time.Duration { return &c.SessionTTL }, 5*time.Minute, 30*24*time.Hour)},
	{key: "TRUSTED_PROXIES", apply: func(c *Config, v string) error {
		var out []netip.Prefix
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			p, err := netip.ParsePrefix(part)
			if err != nil {
				return fmt.Errorf("invalid CIDR %q", part)
			}
			out = append(out, p.Masked())
		}
		c.TrustedProxies = out
		return nil
	}},
	{key: "REQUESTS_PER_MINUTE", apply: integer(func(c *Config) *int { return &c.RequestsPerMinute }, 1, 1_000_000)},
	{key: "LOGIN_ATTEMPTS_PER_MINUTE", apply: integer(func(c *Config) *int { return &c.LoginAttemptsPerMinute }, 1, 10_000)},
	{key: "WORKER_CONCURRENCY", apply: integer(func(c *Config) *int { return &c.WorkerConcurrency }, 1, 1000)},
	{key: "SHUTDOWN_DELAY", apply: duration(func(c *Config) *time.Duration { return &c.ShutdownDelay }, 0, 5*time.Minute)},
	{key: "SHUTDOWN_TIMEOUT", apply: duration(func(c *Config) *time.Duration { return &c.ShutdownTimeout }, time.Second, 30*time.Minute)},
}, tracingSettings...)

// devGroups parses DEV_AUTH_GROUPS: "alex=registrar-staff,library;blair=library"
// (persona ID, then its groups; personas separated by semicolons).
func devGroups(c *Config, v string) error {
	out := map[string][]string{}
	for _, entry := range strings.Split(v, ";") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		persona, groups, ok := strings.Cut(entry, "=")
		persona = strings.ToLower(strings.TrimSpace(persona))
		if !ok || persona == "" {
			return fmt.Errorf(`must look like "alex=group-a,group-b;blair=group-c"`)
		}
		for _, g := range strings.Split(groups, ",") {
			if g = strings.TrimSpace(g); g != "" {
				out[persona] = append(out[persona], g)
			}
		}
		if _, seen := out[persona]; !seen {
			out[persona] = []string{}
		}
	}
	c.DevAuthGroups = out
	return nil
}
