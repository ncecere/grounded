// Package oauth is Grounded as a small OAuth 2.1 authorization server for
// its MCP endpoint (docs/mcp.md, "Signing in with OAuth (experimental)";
// docs/v0.3.0.md §3). It is experimental and off by default: a platform
// setting turns it on, and it only works while the MCP server is on.
//
// What it does, and nothing more:
//
//   - Clients identify themselves with a Client ID Metadata Document (an
//     https URL whose JSON document is fetched through an SSRF guard,
//     metadata.go) or register with Dynamic Client Registration (RFC 7591,
//     clients.go). All clients are public: no client secrets.
//   - The authorization code flow with PKCE S256 (required), resource
//     indicators (RFC 8707: the only resource is <APP_URL>/mcp) and the iss
//     parameter in authorization responses (RFC 9207), authorize.go.
//   - Consent is a person's grant for a client, remembered until revoked.
//   - Opaque access tokens (one hour) and rotating refresh tokens (30 days,
//     renewed on each use); presenting a rotated refresh token again revokes
//     the grant. Tokens and codes are stored as HMAC-SHA256 digests under the
//     API-key pepper, like API keys, and looked up by digest (token.go).
//
// Sign-in itself is the platform's own (OIDC, or the development login):
// the consent page is a page of the app, behind its session and CSRF token.
package oauth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// The scope an access token carries, the only one there is.
const Scope = "mcp"

// Lifetimes.
const (
	// AccessTokenTTL is an access token's life: short, since a token is
	// only checked against its grant, its person and the setting when used.
	AccessTokenTTL = time.Hour
	// RefreshTokenTTL is a refresh token's life. Each use returns a new one
	// with a new 30 days, so a client used at least monthly stays signed in
	// (idle expiry) until the grant is revoked.
	RefreshTokenTTL = 30 * 24 * time.Hour
	// CodeTTL is an authorization code's life (single use).
	CodeTTL = time.Minute
	// ClientUnusedTTL: a registered client unused this long is deleted.
	ClientUnusedTTL = 30 * 24 * time.Hour
)

// Token prefixes: they tell tokens from API keys (rag_) at a glance and in
// secret scanners.
const (
	AccessPrefix  = "gat_"
	refreshPrefix = "grt_"
	codePrefix    = "gac_"
	clientPrefix  = "gcl_"
	// tokenBytes of randomness in every token and code (256 bits).
	tokenBytes = 32
)

// Token kinds (oauth_tokens.kind).
const (
	kindAccess  = "access"
	kindRefresh = "refresh"
)

// Config configures the service.
type Config struct {
	// Issuer is the authorization server's identifier: APP_URL.
	Issuer string
	// AllowPrivate lets metadata documents live on private and loopback
	// addresses (the development allowance: DEV_AUTH on a loopback APP_URL).
	AllowPrivate bool
}

// Service is the authorization server.
type Service struct {
	pool     *pgxpool.Pool
	q        *dbgen.Queries
	peppers  secrets.Peppers
	issuer   string
	resource string
	docs     *metadataDocs
	Log      *slog.Logger
	now      func() time.Time
}

// New returns the service. peppers are the API-key peppers.
func New(pool *pgxpool.Pool, peppers secrets.Peppers, cfg Config) *Service {
	issuer := strings.TrimRight(cfg.Issuer, "/")
	return &Service{
		pool: pool, q: dbgen.New(pool), peppers: peppers,
		issuer: issuer, resource: issuer + "/mcp",
		docs: newMetadataDocs(cfg.AllowPrivate),
		Log:  slog.Default(), now: time.Now,
	}
}

// Issuer is the authorization server's identifier (APP_URL).
func (s *Service) Issuer() string { return s.issuer }

// Resource is the one protected resource: the MCP endpoint, <APP_URL>/mcp.
func (s *Service) Resource() string { return s.resource }

// SetMetadataClient replaces the HTTP client that fetches metadata
// documents (tests: a TLS test server's client). It bypasses the address
// guard, so production code never calls it; redirects stay refused.
func (s *Service) SetMetadataClient(c *http.Client) {
	c.CheckRedirect = noRedirect
	s.docs.client = c
}

// newToken returns a random token with a prefix.
func newToken(prefix string) string {
	b := make([]byte, tokenBytes)
	_, _ = rand.Read(b) // crypto/rand never fails on supported platforms
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

// validTokenShape reports whether a presented value can be one of ours, so
// junk never reaches the database.
func validTokenShape(token, prefix string) bool {
	body, ok := strings.CutPrefix(token, prefix)
	return ok && len(body) == base64.RawURLEncoding.EncodedLen(tokenBytes)
}

// digest is a token's stored digest under a pepper: HMAC-SHA256(pepper,
// "oauth:" + token). The label keeps it apart from API-key digests.
func digest(token string, pepper []byte) []byte {
	m := hmac.New(sha256.New, pepper)
	m.Write([]byte("oauth:"))
	m.Write([]byte(token))
	return m.Sum(nil)
}

// digests are the digests to look a token up by: under the current pepper,
// then (during a pepper rotation) the previous one.
func (s *Service) digests(token string) [][]byte {
	out := [][]byte{digest(token, s.peppers.Current)}
	if len(s.peppers.Previous) > 0 {
		out = append(out, digest(token, s.peppers.Previous))
	}
	return out
}

// Error is an OAuth error (RFC 6749 §5.2, §4.1.2.1): its code, a
// description for people, and the HTTP status for the token endpoint.
type Error struct {
	Code        string
	Description string
	Status      int
	// page: the error comes before the client and its redirect URI are
	// known to be good, so it is shown as a page and never redirected.
	page bool
}

func (e *Error) Error() string { return e.Code + ": " + e.Description }

// ShowPage reports an authorization error that must be shown to the person
// rather than sent to the client's redirect URI (it could be anyone's).
func (e *Error) ShowPage() bool { return e.page }

func oauthError(code, description string) *Error {
	return &Error{Code: code, Description: description, Status: http.StatusBadRequest}
}

func pageError(code, description string) *Error {
	e := oauthError(code, description)
	e.page = true
	return e
}

// errInvalidGrant is the token endpoint's answer to any bad code or
// refresh token: which check failed isn't told.
func errInvalidGrant() *Error {
	return oauthError("invalid_grant", "The authorization code or refresh token is invalid, expired or revoked.")
}
