package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"

	"github.com/ncecere/grounded/internal/httpx"
)

// The browser's sign-in epoch (v0.4.2 US-06): a random cookie replaced at
// every sign-in and sign-out. An anonymous public chat is bound to the epoch
// it started in (internal/httpapi/public.go), so the visitor's conversation
// on a shared or kiosk computer doesn't survive someone signing in or out on
// the same browser. The anonymous cookies themselves can't be cleared here:
// their path (/v1/public) keeps them from reaching the sign-in endpoints.

// visitMaxAge outlives any anonymous session (they last hours).
const visitMaxAge = 400 * 24 * 60 * 60

// VisitCookieName is the epoch cookie's name (__Host- on HTTPS, like the session's).
func VisitCookieName(secure bool) string {
	if secure {
		return "__Host-grounded_visit"
	}
	return "grounded_visit"
}

// rotateVisit starts a new epoch: anonymous chats of the previous one end.
func (s *Service) rotateVisit(w http.ResponseWriter) {
	s.setCookie(w, VisitCookieName(s.cfg.SecureCookies()), httpx.NewID(16), visitMaxAge)
}

// VisitBinding is a short digest of the request's epoch cookie, "" without
// one (a browser that never signed in, or the widget's third-party frame,
// where the first-party cookie isn't sent).
func VisitBinding(r *http.Request, secure bool) string {
	c, err := r.Cookie(VisitCookieName(secure))
	if err != nil || c.Value == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(c.Value))
	return hex.EncodeToString(sum[:8])
}
