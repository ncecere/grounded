// The widget (docs/phase4-publishing.md §6): GET /widget.js, the loader
// built separately from the app (web/widget), and GET /embed/{agentId},
// the chat page the loader frames. The embed page is the app's index.html
// with a Content-Security-Policy whose frame-ancestors are the key's
// allowed origins; X-Frame-Options (DENY everywhere else) is dropped here.

package httpapi

import (
	"bytes"
	"crypto/sha512"
	"encoding/base64"
	"errors"
	"html"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/public"
)

// widgetAssets are loaded once from the embedded build.
type widgetAssets struct {
	once      sync.Once
	index     []byte // index.html, personalised
	script    []byte // widget.js
	integrity string // sha384-… of widget.js
}

func (a *api) assets() *widgetAssets {
	w := a.widget
	w.once.Do(func() {
		w.index = loadIndex(a.Web, a.WebBuilt, a.spaOptions())
		if a.Web == nil {
			return
		}
		if b, err := fs.ReadFile(a.Web, "widget.js"); err == nil {
			sum := sha512.Sum384(b)
			w.script, w.integrity = b, "sha384-"+base64.StdEncoding.EncodeToString(sum[:])
		}
	})
	return w
}

// widgetScript serves the loader to any site (it is public by design).
func (a *api) widgetScript(w http.ResponseWriter, r *http.Request) {
	js := a.assets().script
	if js == nil {
		httpx.Error(w, http.StatusNotFound, "not_found", "The widget has not been built. Run `make web`, then rebuild Grounded.")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/javascript; charset=utf-8")
	h.Set("Cache-Control", "public, max-age=300")
	// Pages may load it with integrity= and crossorigin="anonymous".
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	http.ServeContent(w, r, "widget.js", time.Time{}, bytes.NewReader(js))
}

// embedPage checks the key, the embedding page's origin (Referer), the
// agent (public, live, not disabled) and the public switch, then serves the
// app with frame-ancestors set to the key's allowed origins. Failures are
// the same page with an error code the app shows (and the HTTP status);
// without a valid key only such an error page is served, and any site may
// frame it so the visitor sees why.
func (a *api) embedPage(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Del("X-Frame-Options") // frame-ancestors decides who may frame this page
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")
	id, err := uuid.Parse(r.PathValue("agentId"))
	if err != nil {
		a.writeEmbed(w, "*", apperr.NotFound("agent_not_found", "Agent not found"))
		return
	}
	if r.URL.Query().Get("preview") == "1" {
		// The editor's preview: same origin only; the app chats as the
		// signed-in member.
		a.writeEmbed(w, "'self'", nil)
		return
	}
	if a.Public == nil {
		a.writeEmbed(w, "*", errPublicUnavailable)
		return
	}
	k, err := a.Public.EmbedKey(r.Context(), r.URL.Query().Get("key"), id)
	if err != nil {
		// Only an error message can be framed without a valid key.
		a.writeEmbed(w, "*", err)
		return
	}
	ancestors := public.FrameAncestors(k.AllowedOrigins)
	if ref := public.OriginOf(r.Referer()); ref != "" && ref != a.Config.AppURL && !public.MatchOrigin(ref, k.AllowedOrigins) {
		a.writeEmbed(w, ancestors, apperr.New(http.StatusForbidden, "origin_not_allowed", "This site is not allowed to embed this assistant."))
		return
	}
	t, err := a.Agents.PublicProfile(r.Context(), id.String())
	if err == nil && t.Agent.Status != agents.StatusActive {
		err = apperr.New(http.StatusForbidden, "agent_disabled", "This assistant has been turned off.")
	}
	a.writeEmbed(w, ancestors, err)
}

// writeEmbed writes the embed page. An error sets the status and adds
// <meta name="grounded-embed-error" content="code"> for the app.
func (a *api) writeEmbed(w http.ResponseWriter, ancestors string, fail error) {
	status, code := http.StatusOK, ""
	if fail != nil {
		status, code = http.StatusInternalServerError, "internal"
		var e *apperr.Error
		if errors.As(fail, &e) {
			status, code = e.Status, e.Code
		}
	}
	h := w.Header()
	h.Set("Content-Security-Policy", cspWithAncestors(a.spaOptions(), ancestors))
	index := a.assets().index
	if index == nil {
		h.Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("The web UI has not been built. Run `make web`, then rebuild Grounded.\n"))
		return
	}
	page := index
	if code != "" {
		meta := `<meta name="grounded-embed-error" content="` + html.EscapeString(code) + `">`
		page = []byte(strings.Replace(string(index), "</head>", meta+"</head>", 1))
	}
	h.Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(page)
}
