package httpapi

import (
	"net/http"
	"strings"
)

// openaiMethodFallback keeps wrong-method errors in the OpenAI error shape
// (#116). The SPA's catch-all otherwise masks ServeMux's automatic 405. Derive
// Allow from the route table so it cannot drift from the methods we serve.
// This is not a CORS/preflight grant: these endpoints use authenticated clients.
func openaiMethodFallback(routes []route, next http.Handler) http.Handler {
	allowed := make(map[string][]string)
	for _, rt := range routes {
		if rt.Path != "/v1/models" && rt.Path != "/v1/chat/completions" {
			continue
		}
		allowed[rt.Path] = append(allowed[rt.Path], rt.Method)
		if rt.Method == http.MethodGet {
			allowed[rt.Path] = append(allowed[rt.Path], http.MethodHead)
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if methods := allowed[r.URL.Path]; len(methods) > 0 {
			w.Header().Set("Allow", strings.Join(methods, ", "))
			openaiError(w, http.StatusMethodNotAllowed, "method_not_allowed", "This HTTP method is not supported for this endpoint.")
			return
		}
		next.ServeHTTP(w, r)
	})
}
