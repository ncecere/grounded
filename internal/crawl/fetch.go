package crawl

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/ncecere/grounded/internal/tracing"
)

// Sentinel errors. Fetch wraps them (possibly inside *url.Error); test with
// errors.Is.
var (
	ErrBlockedAddress     = errors.New("crawl: destination is not a public address")
	ErrHostNotAllowed     = errors.New("crawl: host not allowed by policy")
	ErrRobotsDisallowed   = errors.New("crawl: disallowed by robots.txt")
	ErrTooManyRedirects   = errors.New("crawl: too many redirects")
	ErrUnsupportedContent = errors.New("crawl: unsupported content type")
)

// DefaultUserAgent is used when FetcherConfig.UserAgent is empty. Production
// should set a UA with a contact URL.
const DefaultUserAgent = "grounded/1.0"

// Content types accepted by Fetch.
const (
	TypeHTML     = "text/html"
	TypeXHTML    = "application/xhtml+xml"
	TypePDF      = "application/pdf"
	TypeDOCX     = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	TypePPTX     = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	TypePlain    = "text/plain"
	TypeMarkdown = "text/markdown"
)

var acceptedTypes = map[string]bool{TypeHTML: true, TypeXHTML: true, TypePDF: true, TypeDOCX: true, TypePPTX: true, TypePlain: true, TypeMarkdown: true}

const pageAccept = "text/html, application/xhtml+xml, application/pdf, " + TypeDOCX + ", " + TypePPTX + ", text/markdown, text/plain;q=0.9, */*;q=0.1"

// HostPolicy is consulted for every request, including each redirect hop (the
// platform's domain allowlist). host is the lower-case ASCII hostname without
// port; IPv6 literals have no brackets.
type HostPolicy interface{ AllowHost(host string) bool }

// FetcherConfig configures a Fetcher. Zero values take the documented defaults.
type FetcherConfig struct {
	UserAgent     string        // e.g. "grounded/1.0 (+https://rag.example.edu/bot)"; default DefaultUserAgent
	Timeout       time.Duration // per HTTP exchange incl. body read, excluding pacing waits; default 30s
	MaxBodyBytes  int64         // default 20 MiB; larger bodies are truncated and flagged
	MaxRedirects  int           // default 5; each hop re-checked (HostPolicy, SSRF, scheme, port, robots)
	HostPolicy    HostPolicy    // nil allows every host (SSRF rules still apply)
	Pacer         Pacer         // nil disables pacing
	RespectRobots bool          // default true in production
	Resolver      *net.Resolver // optional; tests inject
	// AllowPrivateForTests disables the non-public address and port 80/443
	// checks. ONLY for tests using httptest on 127.0.0.1; never set in
	// production code paths.
	AllowPrivateForTests bool
}

// Page is the result of a fetch.
type Page struct {
	RequestedURL       string // normalised requested URL
	FinalURL           string // after redirects, normalised
	Status             int
	ContentType        string // media type without params, lower-case
	Body               []byte
	Truncated          bool
	ETag, LastModified string
	FetchedAt          time.Time
}

// Fetcher is safe for concurrent use.
type Fetcher struct {
	cfg       FetcherConfig
	ua        string
	robotsTok string
	client    *http.Client
	transport *http.Transport

	// Test seams (unexported; production has no way to set them).
	lookup func(ctx context.Context, host string) ([]netip.Addr, error)
	dial   func(ctx context.Context, network, addr string) (net.Conn, error)
	now    func() time.Time

	robotsMu sync.Mutex
	robots   map[string]*robotsEntry
}

// NewFetcher builds a Fetcher. It never uses proxy environment variables.
func NewFetcher(cfg FetcherConfig) *Fetcher {
	if cfg.UserAgent == "" {
		cfg.UserAgent = DefaultUserAgent
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.MaxBodyBytes <= 0 {
		cfg.MaxBodyBytes = 20 << 20
	}
	if cfg.MaxRedirects <= 0 {
		cfg.MaxRedirects = 5
	}
	f := &Fetcher{cfg: cfg, ua: cfg.UserAgent, robotsTok: productToken(cfg.UserAgent), now: time.Now, robots: map[string]*robotsEntry{}}
	resolver := cfg.Resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	f.lookup = func(ctx context.Context, host string) ([]netip.Addr, error) {
		// Absolute name: never expand through the worker's DNS search list.
		return resolver.LookupNetIP(ctx, "ip", strings.TrimSuffix(host, ".")+".")
	}
	d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	f.dial = d.DialContext
	f.transport = &http.Transport{
		Proxy:                  nil,
		DialContext:            f.safeDial,
		TLSClientConfig:        &tls.Config{MinVersion: tls.VersionTLS12},
		ForceAttemptHTTP2:      true,
		TLSHandshakeTimeout:    10 * time.Second,
		ResponseHeaderTimeout:  cfg.Timeout,
		MaxResponseHeaderBytes: 64 << 10,
		DisableCompression:     true,
		MaxIdleConns:           100,
		MaxIdleConnsPerHost:    2,
		IdleConnTimeout:        30 * time.Second,
	}
	// A client span per request (method, host, status), outside the guard;
	// no traceparent: web sites don't get Grounded's trace IDs.
	f.client = &http.Client{Transport: tracing.Transport(guardTransport{f: f, next: f.transport}, false), CheckRedirect: f.checkRedirect}
	return f
}

// productToken extracts the robots.txt product token ("grounded" from
// "grounded/1.0 (+https://...)").
func productToken(ua string) string {
	tok := ua
	if i := strings.IndexAny(tok, "/ "); i >= 0 {
		tok = tok[:i]
	}
	if tok == "" {
		tok = "grounded"
	}
	return strings.ToLower(tok)
}

type pageRequestKey struct{}

func (f *Fetcher) checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) > f.cfg.MaxRedirects {
		return fmt.Errorf("%w (maximum %d)", ErrTooManyRedirects, f.cfg.MaxRedirects)
	}
	normalized, err := Normalize(req.URL.String())
	if err != nil {
		return fmt.Errorf("crawl: redirect to invalid URL: %w", err)
	}
	u, _ := url.Parse(normalized)
	if err := f.checkDestination(req.Context(), u); err != nil {
		return err
	}
	req.URL = u
	req.Host = ""
	if page, _ := req.Context().Value(pageRequestKey{}).(bool); page && f.cfg.RespectRobots {
		if err := f.robotsCheck(req.Context(), normalized); err != nil {
			return err
		}
	}
	return nil
}

type response struct {
	finalURL    string
	status      int
	header      http.Header
	body        []byte
	truncated   bool
	contentType string
}

// get performs a guarded GET of an already-normalised URL. When accept is
// non-nil the body is only read if accept(contentType) returns true.
func (f *Fetcher) get(ctx context.Context, normalized string, page bool, header http.Header, limit int64, accept func(string) bool) (response, error) {
	ctx = context.WithValue(ctx, pageRequestKey{}, page)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, normalized, nil)
	if err != nil {
		return response{}, err
	}
	for k, v := range header {
		req.Header[k] = v
	}
	req.Header.Set("User-Agent", f.ua)
	req.Header.Set("Accept-Encoding", "gzip")
	res, err := f.client.Do(req)
	if err != nil {
		return response{}, err
	}
	defer res.Body.Close()
	r := response{finalURL: res.Request.URL.String(), status: res.StatusCode, header: res.Header}
	if n, err := Normalize(r.finalURL); err == nil {
		r.finalURL = n
	}
	if mt, _, err := mime.ParseMediaType(res.Header.Get("Content-Type")); err == nil {
		r.contentType = strings.ToLower(mt)
		if r.contentType == "text/x-markdown" {
			r.contentType = TypeMarkdown
		}
	}
	// Never decode or inspect non-2xx bodies; drain a little for connection reuse.
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		_, _ = io.CopyN(io.Discard, res.Body, 4<<10)
		return r, nil
	}
	if accept != nil && r.contentType != "" && r.contentType != "application/octet-stream" && !accept(r.contentType) {
		return r, nil
	}
	r.body, r.truncated, err = readBody(res, limit)
	if err != nil {
		return r, err
	}
	return r, nil
}

// readBody reads at most limit decoded bytes. For gzip the compressed stream is
// bounded by the same limit, so padding or concatenated members can't force
// unbounded transfer; hitting either bound marks the result truncated.
func readBody(res *http.Response, limit int64) ([]byte, bool, error) {
	compressed := &io.LimitedReader{R: res.Body, N: limit + 1}
	var reader io.Reader = compressed
	switch enc := strings.ToLower(strings.TrimSpace(res.Header.Get("Content-Encoding"))); enc {
	case "", "identity":
	case "gzip", "x-gzip":
		gz, err := gzip.NewReader(compressed)
		if err != nil {
			if compressed.N <= 0 {
				return nil, true, nil
			}
			return nil, false, fmt.Errorf("crawl: invalid gzip body: %w", err)
		}
		defer gz.Close()
		reader = gz
	default:
		return nil, false, fmt.Errorf("crawl: unsupported content encoding %q", enc)
	}
	body, err := io.ReadAll(io.LimitReader(reader, limit+1))
	truncated := int64(len(body)) > limit || compressed.N <= 0
	if int64(len(body)) > limit {
		body = body[:limit]
	}
	if err != nil && !(truncated && (errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF))) {
		return nil, false, fmt.Errorf("crawl: read body: %w", err)
	}
	return body, truncated, nil
}

// Fetch GETs a URL honouring robots (cached per origin for 1h in-process),
// pacing, HostPolicy and SSRF rules. See FetchIf.
func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (Page, error) {
	return f.FetchIf(ctx, rawURL, "", "")
}

// FetchIf is Fetch with conditional request headers (If-None-Match /
// If-Modified-Since); a 304 is returned as a Page with Status 304 and no error.
//
// Non-2xx statuses return a Page with Status set, no body and no error.
// Unsupported 2xx content returns the Page (without body) together with
// ErrUnsupportedContent. A missing or application/octet-stream Content-Type is
// sniffed from the body (and URL extension for Office files). Network, policy
// and robots failures return an error and a zero Page.
func (f *Fetcher) FetchIf(ctx context.Context, rawURL, etag, lastModified string) (Page, error) {
	normalized, err := Normalize(rawURL)
	if err != nil {
		return Page{}, err
	}
	u, _ := url.Parse(normalized)
	if err := f.checkDestination(ctx, u); err != nil {
		return Page{}, err
	}
	if f.cfg.RespectRobots {
		if err := f.robotsCheck(ctx, normalized); err != nil {
			return Page{}, err
		}
	}
	h := http.Header{}
	h.Set("Accept", pageAccept)
	if etag != "" {
		h.Set("If-None-Match", etag)
	}
	if lastModified != "" {
		h.Set("If-Modified-Since", lastModified)
	}
	r, err := f.get(ctx, normalized, true, h, f.cfg.MaxBodyBytes, func(ct string) bool { return acceptedTypes[ct] })
	if err != nil {
		return Page{}, err
	}
	p := Page{
		RequestedURL: normalized, FinalURL: r.finalURL, Status: r.status, ContentType: r.contentType,
		ETag: r.header.Get("ETag"), LastModified: r.header.Get("Last-Modified"), FetchedAt: f.now().UTC(),
	}
	if r.status < 200 || r.status >= 300 {
		return p, nil
	}
	if p.ContentType == "" || p.ContentType == "application/octet-stream" {
		p.ContentType = sniffType(r.body, r.finalURL)
	}
	if !acceptedTypes[p.ContentType] {
		return p, fmt.Errorf("%w: %q", ErrUnsupportedContent, p.ContentType)
	}
	p.Body, p.Truncated = r.body, r.truncated
	return p, nil
}

func sniffType(body []byte, finalURL string) string {
	if bytes.HasPrefix(body, []byte("%PDF-")) {
		return TypePDF
	}
	if bytes.HasPrefix(body, []byte("PK\x03\x04")) {
		ext := ""
		if u, err := url.Parse(finalURL); err == nil {
			ext = strings.ToLower(path.Ext(u.Path))
		}
		switch ext {
		case ".docx":
			return TypeDOCX
		case ".pptx":
			return TypePPTX
		}
		return "application/zip"
	}
	mt, _, _ := mime.ParseMediaType(http.DetectContentType(body))
	if mt == TypePlain {
		if u, err := url.Parse(finalURL); err == nil {
			if ext := strings.ToLower(path.Ext(u.Path)); ext == ".md" || ext == ".markdown" {
				return TypeMarkdown
			}
		}
	}
	return mt
}
