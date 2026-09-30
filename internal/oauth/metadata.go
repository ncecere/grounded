package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/ncecere/grounded/internal/mcpclient"
	"github.com/ncecere/grounded/internal/tracing"
)

// Client ID Metadata Documents: a client_id that is an https URL names a
// JSON document describing the client (its name, home page, logo and
// redirect URIs). The URL is someone else's choice, so it is fetched like
// an MCP server's (internal/mcpclient): public addresses only, pinned at
// dial time, no redirects, no proxy from the environment, a short timeout
// and a size cap. Documents are cached in memory for their Cache-Control
// max-age, between a minute and an hour (10 minutes without one).
const (
	maxDocBytes     = 16 << 10
	docTimeout      = 5 * time.Second
	docCacheMin     = time.Minute
	docCacheDefault = 10 * time.Minute
	docCacheMax     = time.Hour
	maxCachedDocs   = 1000
)

var errDocRedirect = errors.New("oauth: metadata documents may not redirect")

func noRedirect(*http.Request, []*http.Request) error { return errDocRedirect }

type cachedDoc struct {
	client Client
	until  time.Time
}

// metadataDocs fetches and caches metadata documents.
type metadataDocs struct {
	client *http.Client
	mu     sync.Mutex
	cache  map[string]cachedDoc
}

func newMetadataDocs(allowPrivate bool) *metadataDocs {
	tr := &http.Transport{
		DialContext:           mcpclient.GuardedDial(allowPrivate),
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   docTimeout,
		ResponseHeaderTimeout: docTimeout,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
	}
	return &metadataDocs{
		client: &http.Client{
			// A client span per fetch, without traceparent (a third party).
			Transport:     tracing.Transport(tr, false),
			Timeout:       docTimeout,
			CheckRedirect: noRedirect,
		},
		cache: map[string]cachedDoc{},
	}
}

// validMetadataURL: an https URL with a path (not just "/"), no user info,
// query or fragment, and no dot segments.
func validMetadataURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.Contains(raw, "#") {
		return false
	}
	if u.Path == "" || u.Path == "/" {
		return false
	}
	for _, seg := range strings.Split(u.Path, "/") {
		if seg == "." || seg == ".." {
			return false
		}
	}
	return true
}

func docError(msg string) *Error { return pageError("invalid_client", msg) }

// get returns the client a metadata document describes.
func (d *metadataDocs) get(ctx context.Context, id string) (Client, error) {
	d.mu.Lock()
	hit, ok := d.cache[id]
	d.mu.Unlock()
	if ok && time.Now().Before(hit.until) {
		return hit.client, nil
	}
	if !validMetadataURL(id) {
		return Client{}, docError("The client_id must be an https URL with a path, without a query or fragment.")
	}
	ctx, span := tracing.Start(ctx, "oauth.client_metadata", attribute.String("server.address", hostOf(id)))
	c, ttl, err := d.fetch(ctx, id)
	tracing.End(span, err)
	if err != nil {
		return Client{}, err
	}
	d.store(id, c, ttl)
	return c, nil
}

func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Host
}

// fetch reads and checks a document.
func (d *metadataDocs) fetch(ctx context.Context, id string) (Client, time.Duration, error) {
	ctx, cancel := context.WithTimeout(ctx, docTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, id, nil)
	if err != nil {
		return Client{}, 0, docError("The client_id isn't a URL Grounded can fetch.")
	}
	req.Header.Set("Accept", "application/json")
	res, err := d.client.Do(req)
	if err != nil {
		if errors.Is(err, mcpclient.ErrBlockedAddress) {
			return Client{}, 0, docError("The client's metadata document is on a private address, which Grounded doesn't fetch.")
		}
		if errors.Is(err, errDocRedirect) {
			return Client{}, 0, docError("The client's metadata document redirects, which Grounded doesn't follow.")
		}
		return Client{}, 0, docError("Grounded couldn't fetch the client's metadata document at " + hostOf(id) + ".")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Client{}, 0, docError("The client's metadata document answered HTTP " + strconv.Itoa(res.StatusCode) + ".")
	}
	if mt, _, err := mime.ParseMediaType(res.Header.Get("Content-Type")); err != nil || (mt != "application/json" && !strings.HasSuffix(mt, "+json")) {
		return Client{}, 0, docError("The client's metadata document isn't JSON (Content-Type application/json).")
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxDocBytes+1))
	if err != nil {
		return Client{}, 0, docError("Grounded couldn't read the client's metadata document.")
	}
	if len(body) > maxDocBytes {
		return Client{}, 0, docError("The client's metadata document is larger than 16 KiB.")
	}
	var m ClientMetadata
	if err := json.Unmarshal(body, &m); err != nil {
		return Client{}, 0, docError("The client's metadata document isn't valid JSON.")
	}
	if m.ClientID != id {
		return Client{}, 0, docError("The client_id in the client's metadata document must equal the document's URL.")
	}
	c, bad := m.check()
	if bad != nil {
		return Client{}, 0, docError("The client's metadata document is invalid: " + bad.Description)
	}
	c.ID, c.Kind = id, KindMetadata
	return c, cacheFor(res.Header.Get("Cache-Control")), nil
}

// cacheFor is how long to keep a document: its max-age, clamped.
func cacheFor(cacheControl string) time.Duration {
	ttl := docCacheDefault
	for _, part := range strings.Split(cacheControl, ",") {
		k, v, _ := strings.Cut(strings.TrimSpace(strings.ToLower(part)), "=")
		switch k {
		case "no-store", "no-cache":
			return docCacheMin
		case "max-age":
			if n, err := strconv.Atoi(strings.Trim(v, `"`)); err == nil {
				ttl = time.Duration(n) * time.Second
			}
		}
	}
	return min(max(ttl, docCacheMin), docCacheMax)
}

// store caches a document, dropping expired entries (and, when still full,
// one other) to stay bounded.
func (d *metadataDocs) store(id string, c Client, ttl time.Duration) {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := time.Now()
	if len(d.cache) >= maxCachedDocs {
		for k, v := range d.cache {
			if now.After(v.until) {
				delete(d.cache, k)
			}
		}
		for k := range d.cache {
			if len(d.cache) < maxCachedDocs {
				break
			}
			delete(d.cache, k)
		}
	}
	d.cache[id] = cachedDoc{client: c, until: now.Add(ttl)}
}
