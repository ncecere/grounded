package httpapi

import (
	"net/http"
	"slices"
	"strings"

	"github.com/ncecere/grounded/internal/httpx"
)

// restMethodFallback restores the 405 that the SPA catch-all masks (#116,
// #119). Probe the actual mux without running a handler: a path may match a
// different pattern for each method, so a separate path-only mux would omit
// valid methods where literal and wildcard routes overlap.
func restMethodFallback(mux *http.ServeMux, routes []route, next http.Handler) http.Handler {
	set := make(map[string]bool)
	for _, rt := range routes {
		if strings.HasPrefix(rt.Path, "/v1/") {
			set[rt.Method] = true
			if rt.Method == http.MethodGet {
				set[http.MethodHead] = true
			}
		}
	}
	methods := make([]string, 0, len(set))
	for method := range set {
		methods = append(methods, method)
	}
	slices.Sort(methods)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/v1/") {
			next.ServeHTTP(w, r)
			return
		}
		var allowed []string
		for _, method := range methods {
			probe := *r // Handler only inspects; do not clone headers per method.
			probe.Method = method
			if _, pattern := mux.Handler(&probe); pattern != "" && pattern != "/" {
				allowed = append(allowed, method)
			}
		}
		if len(allowed) == 0 {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Allow", strings.Join(allowed, ", "))
		fail := httpx.Error
		if isOpenAIPath(r.URL.Path) {
			fail = openaiError
		}
		fail(w, http.StatusMethodNotAllowed, "method_not_allowed", "This HTTP method is not supported for this endpoint.")
	})
}
