package doctor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// A provider that serves its JWKS only with a trailing slash (Authentik)
// must pass: the published jwks_uri is fetched exactly as written.
func TestJWKSKeepsTrailingSlash(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/application/o/app/jwks/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":[{"use":"sig"}]}`))
	}))
	defer srv.Close()
	r := &runner{opts: Options{Timeout: 5 * time.Second}}
	r.jwks(context.Background(), srv.URL+"/application/o/app/jwks/")
	if len(r.checks) != 1 || r.checks[0].Status == Fail {
		t.Fatalf("checks = %+v", r.checks)
	}
}
