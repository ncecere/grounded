package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/secrets"
)

func testService(t *testing.T) *Service {
	t.Helper()
	return New(nil, secrets.NewPeppers([]byte("0123456789abcdef0123456789abcdef"), nil), Config{Issuer: "https://rag.example.edu/"})
}

func TestRedirectURIs(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://app.example.com/callback":      true,
		"http://127.0.0.1:33418/callback":       true,
		"http://localhost/cb":                   true,
		"http://[::1]:8000/cb":                  true,
		"http://app.example.com/callback":       false, // http only on loopback
		"https://app.example.com/cb#frag":       false,
		"https://user@app.example.com/cb":       false,
		"cursor://anysphere.cursor-mcp/oauth":   false, // private-use schemes aren't supported
		"javascript:alert(1)":                   false,
		"/relative":                             false,
		"https://" + strings.Repeat("a", 600):   false,
		"https://app.example.com/cb?client=one": true,
	} {
		if got := validRedirectURI(raw); got != want {
			t.Errorf("validRedirectURI(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestMatchRedirect(t *testing.T) {
	reg := []string{"https://app.example.com/callback", "http://127.0.0.1/cb", "http://localhost:9000/cb?x=1"}
	for req, want := range map[string]bool{
		"https://app.example.com/callback":     true,
		"https://app.example.com/callback/":    false, // exact
		"https://app.example.com/Callback":     false,
		"https://app.example.com/callback?x=1": false,
		"https://evil.example.com/callback":    false,
		"http://127.0.0.1:53211/cb":            true, // any port on loopback (RFC 8252 §7.3)
		"http://127.0.0.1/cb":                  true,
		"http://127.0.0.1:53211/other":         false,
		"http://localhost:1234/cb?x=1":         true,
		"http://localhost:1234/cb":             false, // the query must match
		"https://127.0.0.1:53211/cb":           false, // the port rule is for http loopback only
		"http://localhost:1234/cb?x=1#f":       false,
	} {
		if got := matchRedirect(reg, req); got != want {
			t.Errorf("matchRedirect(%q) = %v, want %v", req, got, want)
		}
	}
}

func challengeOf(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func TestVerifyPKCE(t *testing.T) {
	v := strings.Repeat("a1-._~", 8) // 48 characters
	c := challengeOf(v)
	if !verifyPKCE(v, c) {
		t.Fatal("the right verifier was refused")
	}
	for _, bad := range []string{"", v + "x", strings.Repeat("a", 42), c, v[:43] + "!"} {
		if verifyPKCE(bad, c) {
			t.Errorf("verifier %q was accepted", bad)
		}
	}
	if verifyPKCE(v, v) { // plain: the challenge equals the verifier
		t.Error("a plain challenge was accepted")
	}
}

// checked is a service with a cached metadata-document client.
func checked(t *testing.T) (*Service, AuthorizeRequest) {
	s := testService(t)
	id := "https://app.example.com/oauth/client.json"
	s.docs.store(id, Client{ID: id, Kind: KindMetadata, Name: "App", RedirectURIs: []string{"http://127.0.0.1/callback"}}, time.Minute)
	return s, AuthorizeRequest{
		ClientID: id, RedirectURI: "http://127.0.0.1:4000/callback", ResponseType: "code",
		CodeChallenge: challengeOf(strings.Repeat("v", 50)), CodeChallengeMethod: "S256",
		Resource: "https://rag.example.edu/mcp", State: "xyz",
	}
}

func TestCheckAuthorizeRequest(t *testing.T) {
	s, good := checked(t)
	if _, err := s.Check(context.Background(), good); err != nil {
		t.Fatalf("a good request was refused: %v", err)
	}
	cases := []struct {
		name   string
		mutate func(*AuthorizeRequest)
		code   string
		page   bool
	}{
		{"unknown client", func(r *AuthorizeRequest) { r.ClientID = "someone" }, "invalid_client", true},
		{"no redirect", func(r *AuthorizeRequest) { r.RedirectURI = "" }, "invalid_request", true},
		{"other redirect", func(r *AuthorizeRequest) { r.RedirectURI = "https://evil.example.com/cb" }, "invalid_request", true},
		{"token flow", func(r *AuthorizeRequest) { r.ResponseType = "token" }, "unsupported_response_type", false},
		{"no PKCE", func(r *AuthorizeRequest) { r.CodeChallenge, r.CodeChallengeMethod = "", "" }, "invalid_request", false},
		{"plain PKCE", func(r *AuthorizeRequest) { r.CodeChallengeMethod = "plain" }, "invalid_request", false},
		{"method omitted", func(r *AuthorizeRequest) { r.CodeChallengeMethod = "" }, "invalid_request", false},
		{"bad challenge", func(r *AuthorizeRequest) { r.CodeChallenge = "short" }, "invalid_request", false},
		{"no resource", func(r *AuthorizeRequest) { r.Resource = "" }, "invalid_target", false},
		{"other resource", func(r *AuthorizeRequest) { r.Resource = "https://other.example.com/mcp" }, "invalid_target", false},
		{"root resource", func(r *AuthorizeRequest) { r.Resource = "https://rag.example.edu" }, "invalid_target", false},
	}
	for _, tc := range cases {
		r := good
		tc.mutate(&r)
		_, err := s.Check(context.Background(), r)
		var oe *Error
		if !errors.As(err, &oe) || oe.Code != tc.code || oe.ShowPage() != tc.page {
			t.Errorf("%s: err = %v (page %v), want %s (page %v)", tc.name, err, oe != nil && oe.ShowPage(), tc.code, tc.page)
		}
	}
}

func TestRequestFromQueryRefusesRepeats(t *testing.T) {
	_, err := RequestFromQuery(url.Values{"client_id": {"a", "b"}})
	var oe *Error
	if !errors.As(err, &oe) || !oe.ShowPage() {
		t.Fatalf("repeated parameter: %v", err)
	}
}

func TestRedirectCarriesStateAndIssuer(t *testing.T) {
	s, r := checked(t)
	u, err := url.Parse(s.DenyRedirect(r))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if u.Host != "127.0.0.1:4000" || q.Get("error") != "access_denied" || q.Get("state") != "xyz" || q.Get("iss") != "https://rag.example.edu" {
		t.Fatalf("deny redirect = %s", u)
	}
}

func TestTokenShapes(t *testing.T) {
	tok := newToken(AccessPrefix)
	if !IsAccessToken(tok) || IsAccessToken(newToken(refreshPrefix)) || IsAccessToken("rag_abc") || IsAccessToken(tok+"x") {
		t.Fatal("token shapes")
	}
	a, b := digest(tok, []byte("one")), digest(tok, []byte("two"))
	if string(a) == string(b) || strings.Contains(string(a), tok) {
		t.Fatal("digests must depend on the pepper and not contain the token")
	}
}

func TestClientMetadataCheck(t *testing.T) {
	good := ClientMetadata{ClientName: "  My   App ", RedirectURIs: []string{"https://app.example.com/cb"}, LogoURI: "http://app.example.com/logo.png",
		ClientURI: "https://app.example.com", TokenEndpointAuthMethod: "none", GrantTypes: []string{"authorization_code", "refresh_token"}}
	c, bad := good.check()
	if bad != nil || c.Name != "My App" || c.LogoURI != "" || c.URI != "https://app.example.com" {
		t.Fatalf("check = %+v %v (the http logo must be dropped)", c, bad)
	}
	for name, m := range map[string]ClientMetadata{
		"no redirects":  {},
		"eleven":        {RedirectURIs: strings.Split(strings.Repeat("https://a.example.com/cb ", 11), " ")[:11]},
		"secret client": {RedirectURIs: good.RedirectURIs, TokenEndpointAuthMethod: "client_secret_basic"},
		"implicit":      {RedirectURIs: good.RedirectURIs, ResponseTypes: []string{"token"}},
		"credentials":   {RedirectURIs: good.RedirectURIs, GrantTypes: []string{"client_credentials"}},
		"http redirect": {RedirectURIs: []string{"http://app.example.com/cb"}},
	} {
		if _, bad := m.check(); bad == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestCacheFor(t *testing.T) {
	for cc, want := range map[string]time.Duration{
		"":                    docCacheDefault,
		"max-age=5":           docCacheMin,
		"public, max-age=600": 10 * time.Minute,
		"max-age=999999":      docCacheMax,
		"no-store":            docCacheMin,
	} {
		if got := cacheFor(cc); got != want {
			t.Errorf("cacheFor(%q) = %v, want %v", cc, got, want)
		}
	}
}

func TestMetadataURL(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://app.example.com/client.json":   true,
		"https://app.example.com":               false,
		"https://app.example.com/":              false,
		"http://app.example.com/client.json":    false,
		"https://app.example.com/c.json?x=1":    false,
		"https://app.example.com/a/../c.json":   false,
		"https://u@app.example.com/client.json": false,
	} {
		if got := validMetadataURL(raw); got != want {
			t.Errorf("validMetadataURL(%q) = %v, want %v", raw, got, want)
		}
	}
}

// docServer serves metadata documents over TLS on loopback.
func docServer(t *testing.T, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	return srv
}

func testDocs(srv *httptest.Server) *metadataDocs {
	d := newMetadataDocs(false)
	c := srv.Client()
	c.CheckRedirect = noRedirect
	d.client = c
	return d
}

func TestMetadataDocuments(t *testing.T) {
	var body, contentType string
	status := http.StatusOK
	srv := docServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/moved.json" {
			http.Redirect(w, r, "/client.json", http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	})
	id := srv.URL + "/client.json"
	good := `{"client_id":"` + id + `","client_name":"Doc App","redirect_uris":["http://127.0.0.1/cb"],"logo_uri":"https://cdn.example.com/l.png"}`
	cases := []struct {
		name, body, contentType, want string
		status                        int
		id                            string
	}{
		{"good", good, "application/json; charset=utf-8", "", 200, id},
		{"not json type", good, "text/html", "isn't JSON", 200, id},
		{"not json body", "<html>", "application/json", "isn't valid JSON", 200, id},
		{"oversized", `{"client_name":"` + strings.Repeat("x", maxDocBytes) + `"}`, "application/json", "larger than 16 KiB", 200, id},
		{"other client_id", strings.Replace(good, `"client_id":"`+id, `"client_id":"https://evil.example.com/c.json`, 1), "application/json", "must equal", 200, id},
		{"error status", good, "application/json", "HTTP 404", 404, id},
		{"redirect", good, "application/json", "redirects", 200, srv.URL + "/moved.json"},
	}
	for _, tc := range cases {
		body, contentType, status = tc.body, tc.contentType, tc.status
		d := testDocs(srv)
		c, err := d.get(context.Background(), tc.id)
		if tc.want == "" {
			if err != nil || c.Name != "Doc App" || c.Kind != KindMetadata || c.LogoURI == "" {
				t.Errorf("%s: %+v %v", tc.name, c, err)
			}
			continue
		}
		var oe *Error
		if !errors.As(err, &oe) || !oe.ShowPage() || !strings.Contains(oe.Description, tc.want) {
			t.Errorf("%s: err = %v, want %q", tc.name, err, tc.want)
		}
	}
}

func TestMetadataDocumentsCached(t *testing.T) {
	hits := 0
	var id string
	srv := docServer(t, func(w http.ResponseWriter, _ *http.Request) {
		hits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"client_id":"` + id + `","redirect_uris":["http://127.0.0.1/cb"]}`))
	})
	id = srv.URL + "/c.json"
	d := testDocs(srv)
	for range 3 {
		if _, err := d.get(context.Background(), id); err != nil {
			t.Fatal(err)
		}
	}
	if hits != 1 {
		t.Fatalf("fetched %d times, want once (cached)", hits)
	}
}

// The address guard: with the real dialer, a document on a loopback
// (private) address is refused before any request is sent.
func TestMetadataDocumentsPrivateAddressRefused(t *testing.T) {
	hit := false
	srv := docServer(t, func(http.ResponseWriter, *http.Request) { hit = true })
	d := newMetadataDocs(false)
	_, err := d.get(context.Background(), srv.URL+"/client.json")
	var oe *Error
	if !errors.As(err, &oe) || !strings.Contains(oe.Description, "private address") || hit {
		t.Fatalf("err = %v, hit = %v", err, hit)
	}
}
