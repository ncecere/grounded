// Package config resolves runtime configuration.
//
// Precedence: built-in defaults, then the optional YAML file named by
// GROUNDED_CONFIG_FILE, then environment variables. Secret-bearing settings can
// also be read from a file named by the matching *_FILE variable (or
// *_file YAML key), which is how Kubernetes Secrets are mounted.
//
// The YAML file is flat: keys are the lower-case environment variable names,
// for example `app_url: https://rag.example.edu`. Unknown keys are rejected.
package config

import (
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/boilerplate"
)

type Config struct {
	// AppURL is the public origin (scheme://host[:port]) used for cookies,
	// OIDC redirects and Origin checks.
	AppURL         string
	HTTPAddr       string // api / serve listener
	WorkerHTTPAddr string // worker-only health and metrics listener
	// MetricsAddr, when set, moves the api/serve process's /metrics off
	// HTTPAddr onto this internal listener (with /healthz and /readyz), so the
	// public ingress never serves it. Empty keeps /metrics on HTTPAddr.
	MetricsAddr    string
	DatabaseURL    string
	ValkeyURL      string
	ValkeyPrefix   string
	MigrateOnStart bool

	// EncryptionKey (32 bytes, base64) encrypts secrets stored in the
	// database, such as model proxy API keys. EncryptionKeyPrevious is
	// still accepted for decryption during key rotation, until
	// `grounded rotate-keys` has re-encrypted every value
	// (docs/operations/rotate-keys.md).
	EncryptionKey         string
	EncryptionKeyPrevious string

	// APIKeyPepper (32 bytes, base64) keys the HMAC of stored API key
	// hashes. Required for api/serve. APIKeyPepperPrevious keeps keys
	// hashed with the previous pepper working during a rotation; each is
	// re-hashed with the new pepper when next used. Changing the pepper
	// without it invalidates every API key.
	APIKeyPepper         string
	APIKeyPepperPrevious string

	// Object storage for uploaded originals and parsed Markdown.
	BlobBackend string // "fs" (default, single node) or "s3"
	BlobDir     string
	S3          S3

	// Ingestion.
	MaxUploadBytes        int64
	IngestMaxInflight     int           // documents queued/processing platform-wide
	IngestMaxInflightTeam int           // built-in default of the concurrent_ingest_jobs team limit (internal/limits)
	IngestConcurrency     int           // document jobs per worker process
	EmbedBatchSize        int           // inputs per embedding request, shared across documents
	EmbedBatchTokens      int           // counted tokens per embedding request (0 = no limit)
	EmbedBatchWait        time.Duration // how long a partial request waits for more documents' chunks
	VectorEfSearch        int           // HNSW ef_search for retrieval (recall vs latency)
	VectorExactThreshold  int64         // largest filtered set searched exactly
	// ProfileMigrationGraceDays is how long a KB's old vectors are kept after
	// a profile migration switches, so it can switch back (docs/phase5-deploy.md
	// §5 P2); each migration may set its own.
	ProfileMigrationGraceDays int
	// EvaluationConcurrency is how many questions an evaluation run checks
	// at once (docs/evaluations.md §4).
	EvaluationConcurrency int
	// HealthCheckInterval is how often the health job re-tests enabled
	// connections and models (docs/operations/health.md); 0 turns the
	// scheduled re-test off (Test buttons still store their results).
	HealthCheckInterval time.Duration

	// Boilerplate are the platform defaults of repeated-block suppression
	// (ADR-0021); sources may override them.
	Boilerplate boilerplate.Defaults

	// Hybrid retrieval: platform-default weights of weighted reciprocal rank
	// fusion (DESIGN.md §6). Knowledge bases may override both.
	RetrievalVectorWeight  float64
	RetrievalKeywordWeight float64

	// ModerationTimeout bounds each moderation check (ADR-0019), besides
	// the connection's own timeout.
	ModerationTimeout time.Duration

	// Document parsing (ADR-0008). Built-in parsers need no configuration;
	// TikaURL enables Apache Tika as a fallback.
	TikaURL         string
	TikaTimeout     time.Duration
	TikaPreferKinds []string // kinds sent to Tika first, e.g. "pdf"
	PDFWorkers      int      // concurrent PDFium instances per process

	// OCR (docs/ocr.md): the backends Admin -> Parsing may choose. OCR is
	// off until an admin turns it on there.
	OCR OCR

	// Web crawling (ADR-0008, DESIGN.md §5.3).
	Crawl Crawl

	LogLevel  string
	LogFormat string

	// Instance is this deployment's identity: names, theme and links shown
	// in the UI and used in the agent preamble (ADR-0018).
	Instance Instance

	// TeamRequestURL links users to the team request form (for example a
	// service desk request). Optional.
	TeamRequestURL string

	// SMTP sends notification email; off while SMTP.Host is empty.
	SMTP SMTP

	// Public configures anonymous sessions and CAPTCHA for public agents.
	Public Public

	// Retention holds the retention period defaults (platform settings
	// override them) and the retention job's batch bounds.
	Retention Retention

	DevAuth bool
	// DevAuthGroups gives development personas fake IdP groups, for trying
	// SSO group mapping without an identity provider (DEV_AUTH_GROUPS).
	DevAuthGroups map[string][]string
	OIDC          OIDC
	SessionTTL    time.Duration

	// TrustedProxies are the ingress CIDRs allowed to set X-Forwarded-For.
	TrustedProxies []netip.Prefix

	RequestsPerMinute      int
	LoginAttemptsPerMinute int
	WorkerConcurrency      int
	ShutdownDelay          time.Duration
	ShutdownTimeout        time.Duration
}

// Crawl configures the web crawler.
type Crawl struct {
	MaxPages       int           // ceiling for a source's maxPages
	OriginInterval time.Duration // minimum spacing between requests to one origin, across all workers
	UserAgent      string        // default "grounded/1.0 (+APP_URL/bot)"
	Timeout        time.Duration // per HTTP exchange
	MaxBodyBytes   int64         // larger pages are skipped
	Concurrency    int           // crawl jobs per worker process (River queue "web")

	// AllowlistSeed are host patterns (normalised) added to the platform
	// allowlist once, on the first start that finds it never seeded.
	AllowlistSeed []string

	// AllowPrivateAddressesForTests lifts SSRF address and port checks so
	// tests can crawl httptest servers on 127.0.0.1. It has no environment
	// variable or YAML key: only test code can set it.
	AllowPrivateAddressesForTests bool
}

// Themes are the UI themes (bitop-ui themes in web/src/components/ui/themes).
// Only the neutral theme ships; branding comes from INSTANCE_NAME, ORG_NAME
// and UI_LOGO_URL. The setting stays so later generic themes can be added.
var Themes = []string{"neutral"}

// Instance is the identity of one deployment. Nothing in the product names
// an institution; each install configures its own.
type Instance struct {
	Name       string // product name in the UI and page titles
	OrgName    string // optional organisation name (agent preamble, UI copy)
	Theme      string // one of Themes; applied as <html data-brand>
	LogoURL    string // optional https URL or same-origin path
	SupportURL string // optional help link (http(s) or mailto:)
}

// DefaultInstanceName is the product name used when INSTANCE_NAME is unset.
const DefaultInstanceName = "Grounded"

type S3 struct {
	Endpoint, Region, Bucket, AccessKey, SecretKey, CAFile, Prefix string
	ForcePathStyle                                                 bool
}

type OIDC struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	Scopes       []string
	EmailClaim   string
	// GroupsClaim is the claim holding the person's IdP groups, read for
	// SSO group mapping (a list of strings; a single string is one group).
	GroupsClaim           string
	RequireVerifiedEmail  bool
	AllowedEmailDomains   []string
	BootstrapAdminSubject string
}

// Enabled reports whether an OIDC provider is configured.
func (o OIDC) Enabled() bool { return o.Issuer != "" }

// SecureCookies reports whether the app is served over HTTPS.
func (c Config) SecureCookies() bool { return strings.HasPrefix(c.AppURL, "https://") }

// Defaults returns the built-in configuration.
func Defaults() Config {
	c := Config{
		HTTPAddr:       ":8080",
		WorkerHTTPAddr: ":9090",
		ValkeyPrefix:   "grounded:",
		LogLevel:       "info",
		LogFormat:      "json",
		Instance:       Instance{Name: DefaultInstanceName, Theme: "neutral"},
		OIDC: OIDC{
			Scopes:               []string{"openid", "profile", "email"},
			EmailClaim:           "email",
			GroupsClaim:          "groups",
			RequireVerifiedEmail: true,
		},
		SMTP:                   SMTP{Port: 587, TLS: SMTPStartTLS},
		Public:                 Public{AnonSessionTTL: 24 * time.Hour, CaptchaProvider: CaptchaNone},
		Retention:              RetentionDefaults(),
		SessionTTL:             12 * time.Hour,
		RequestsPerMinute:      600,
		LoginAttemptsPerMinute: 20,
		WorkerConcurrency:      10,
		TikaTimeout:            2 * time.Minute,
		BlobBackend:            "fs",
		BlobDir:                "data/blobs",
		S3:                     S3{Region: "us-east-1", ForcePathStyle: true},
		MaxUploadBytes:         100 << 20,
		IngestMaxInflight:      32,
		IngestMaxInflightTeam:  8,
		IngestConcurrency:      4,
		EmbedBatchSize:         64,
		EmbedBatchTokens:       32768,
		EmbedBatchWait:         100 * time.Millisecond,
		VectorEfSearch:         400,
		VectorExactThreshold:   100_000,
		Boilerplate:            boilerplate.DefaultDefaults,
		RetrievalVectorWeight:  1,
		RetrievalKeywordWeight: 0.1,
		ModerationTimeout:      10 * time.Second,
		PDFWorkers:             2,
		OCR:                    OCR{Timeout: 2 * time.Minute, MaxPagesPerDocument: 200, Concurrency: 2},
		Crawl: Crawl{
			MaxPages: 10000, OriginInterval: time.Second, Timeout: 30 * time.Second,
			MaxBodyBytes: 20 << 20, Concurrency: 4,
		},
		ShutdownDelay:   5 * time.Second,
		ShutdownTimeout: 60 * time.Second,
	}
	c.ProfileMigrationGraceDays = 7
	c.EvaluationConcurrency = 2
	c.HealthCheckInterval = 15 * time.Minute
	return c
}

// LogoOrigin is the origin of an absolute UI_LOGO_URL (for the Content
// Security Policy's img-src), or "" for a same-origin path or no logo.
func (in Instance) LogoOrigin() string {
	if in.LogoURL == "" || strings.HasPrefix(in.LogoURL, "/") {
		return ""
	}
	u, err := url.Parse(in.LogoURL)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// CrawlUserAgent is the User-Agent sent by the crawler.
func (c Config) CrawlUserAgent() string {
	if c.Crawl.UserAgent != "" {
		return c.Crawl.UserAgent
	}
	if c.AppURL != "" {
		return "grounded/1.0 (+" + c.AppURL + "/bot)"
	}
	return "grounded/1.0"
}

// OCR configures OCR for scanned pages (docs/ocr.md §2, §4).
type OCR struct {
	// TesseractURL is the grounded-ocr sidecar (OCR_TESSERACT_URL); empty:
	// the Tesseract backend can't be chosen. Tika's URL is TIKA_URL.
	TesseractURL string
	// Timeout bounds one page's OCR request (OCR_TIMEOUT).
	Timeout time.Duration
	// MaxPagesPerDocument caps the pages read per document
	// (OCR_MAX_PAGES_PER_DOCUMENT); pages beyond it are skipped with a warning.
	MaxPagesPerDocument int
	// Concurrency bounds the pages read at once per worker process
	// (OCR_CONCURRENCY), so OCR can't starve other ingestion.
	Concurrency int
}
