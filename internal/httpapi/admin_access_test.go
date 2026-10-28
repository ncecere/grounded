package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestPlatformAuthorizationPrecedesHandlerValidation(t *testing.T) {
	a := &api{}
	for _, role := range []string{"", authz.PlatformAuditor, authz.PlatformAdmin} {
		for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"} {
			for _, readOnly := range []bool{false, true} {
				t.Run(role+"/"+method+"/readOnly="+map[bool]string{true: "yes", false: "no"}[readOnly], func(t *testing.T) {
					reached := false
					h := a.requirePlatformAccess(func(w http.ResponseWriter, r *http.Request) {
						reached = true
						// A handler would next check its revision/body. Missing
						// If-Match must never invite an auditor to retry a write.
						ifMatch(w, r)
					}, readOnly)
					r := httptest.NewRequest(method, "/v1/admin/settings/example", strings.NewReader("not json"))
					r = r.WithContext(auth.WithIdentity(r.Context(), auth.Identity{User: dbgen.User{PlatformRole: role}}))
					rec := httptest.NewRecorder()
					h.ServeHTTP(rec, r)
					allowed := role == authz.PlatformAdmin || (role == authz.PlatformAuditor && (readOnly || method == "GET" || method == "HEAD"))
					want := http.StatusForbidden
					if allowed {
						want = http.StatusPreconditionRequired
					}
					if rec.Code != want || reached != allowed {
						t.Fatalf("got %d reached=%v; want %d reached=%v: %s", rec.Code, reached, want, allowed, rec.Body)
					}
				})
			}
		}
	}
}
