package httpapi

import (
	"bytes"
	"html"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/httpx"
)

// contentSecurityPolicy applies to the web app. Styles allow 'unsafe-inline'
// because the dialog and menu primitives position themselves with inline
// style attributes; scripts are same-origin only. %IMG% is replaced with the
// image sources (the logo's origin is added when UI_LOGO_URL is absolute).
// %SCRIPT% and %FRAME% add the CAPTCHA widget's origin when one is
// configured; %ANCESTORS% is 'none' except on the embed page.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'%SCRIPT%; style-src 'self' 'unsafe-inline'; " +
	"img-src %IMG%; font-src 'self'; connect-src 'self'; frame-src 'self'%FRAME%; frame-ancestors %ANCESTORS%; base-uri 'self'; form-action 'self'"

// oauthConsentPath is the app's OAuth consent page.
const oauthConsentPath = "/oauth/consent"

// apiPrefixes never fall back to the app: unknown API paths are JSON 404s.
var apiPrefixes = []string{"/v1/", "/auth/", "/healthz", "/readyz", "/metrics"}

// spaOptions personalise index.html for this instance (ADR-0018).
type spaOptions struct {
	Title      string // INSTANCE_NAME, the <title>
	Theme      string // UI_THEME, <html data-brand>
	LogoOrigin string // https origin of UI_LOGO_URL, allowed in img-src
	// CaptchaOrigin serves the CAPTCHA widget's script and frame ("" when
	// CAPTCHA is off).
	CaptchaOrigin string
}

var (
	titleRE       = regexp.MustCompile(`(?is)<title>.*?</title>`)
	htmlTagRE     = regexp.MustCompile(`(?i)<html\b[^>]*>`)
	dataBrandRE   = regexp.MustCompile(`(?i)\sdata-brand\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)`)
	httpsOriginRE = regexp.MustCompile(`^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$`)
)

// renderIndex sets the page title and the theme on <html> server-side, so
// the first paint already has the right brand (no flash). Values are
// HTML-escaped.
func renderIndex(page []byte, o spaOptions) []byte {
	out := page
	if loc := titleRE.FindIndex(out); o.Title != "" && loc != nil {
		out = splice(out, loc, []byte("<title>"+html.EscapeString(o.Title)+"</title>"))
	}
	if loc := htmlTagRE.FindIndex(out); o.Theme != "" && loc != nil {
		// Drop any data-brand the build left, then add ours right after <html.
		rest := dataBrandRE.ReplaceAllLiteral(out[loc[0]+len("<html"):loc[1]], nil)
		tag := append([]byte(`<html data-brand="`+html.EscapeString(o.Theme)+`"`), rest...)
		out = splice(out, loc, tag)
	}
	return out
}

// splice returns b with b[loc[0]:loc[1]] replaced by with (b is not modified).
func splice(b []byte, loc []int, with []byte) []byte {
	out := make([]byte, 0, len(b)-(loc[1]-loc[0])+len(with))
	out = append(out, b[:loc[0]]...)
	out = append(out, with...)
	return append(out, b[loc[1]:]...)
}

func cspFor(o spaOptions) string { return cspWithAncestors(o, "'none'") }

// cspWithAncestors is the app's policy with a frame-ancestors source list
// (the embed page's allowed origins).
func cspWithAncestors(o spaOptions, ancestors string) string {
	img := "'self' data:"
	if httpsOriginRE.MatchString(o.LogoOrigin) {
		img += " " + o.LogoOrigin
	}
	extra := ""
	if httpsOriginRE.MatchString(o.CaptchaOrigin) {
		extra = " " + o.CaptchaOrigin
	}
	return strings.NewReplacer("%IMG%", img, "%SCRIPT%", extra, "%FRAME%", extra, "%ANCESTORS%", ancestors).Replace(contentSecurityPolicy)
}

// loadIndex reads and personalises index.html (nil when the UI is not built).
func loadIndex(assets fs.FS, built bool, opts spaOptions) []byte {
	if !built || assets == nil {
		return nil
	}
	page, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		return nil
	}
	return renderIndex(page, opts)
}

// spaHandler serves the embedded single-page app. Existing files are served
// directly (hashed assets are cached for a year); a missing file (a path
// whose last segment has an extension, such as /favicon.ico) is a plain
// 404; any other GET path returns index.html, personalised by opts, so
// client-side routes work on reload. App routes never end in an extension.
func spaHandler(assets fs.FS, built bool, opts spaOptions) http.Handler {
	files := http.FileServer(http.FS(assets))
	csp := cspFor(opts)
	// The OAuth consent page (docs/mcp.md) shows the client's logo, from any
	// https address; no other page loads outside images.
	consentCSP := strings.Replace(csp, "img-src 'self' data:", "img-src 'self' data: https:", 1)
	index := loadIndex(assets, built, opts)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, p := range apiPrefixes {
			if strings.HasPrefix(r.URL.Path, p) || r.URL.Path == strings.TrimSuffix(p, "/") {
				httpx.Error(w, http.StatusNotFound, "not_found", "Not found")
				return
			}
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			httpx.Error(w, http.StatusNotFound, "not_found", "Not found")
			return
		}
		h := w.Header()
		if r.URL.Path == oauthConsentPath {
			h.Set("Content-Security-Policy", consentCSP)
		} else {
			h.Set("Content-Security-Policy", csp)
		}
		if !built || index == nil {
			h.Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("The web UI has not been built. Run `make web`, then rebuild Grounded.\n"))
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" && name != "index.html" {
			if st, err := fs.Stat(assets, name); err == nil && !st.IsDir() {
				if strings.HasPrefix(name, "assets/") {
					h.Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		if name != "index.html" && path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		h.Set("Cache-Control", "no-cache")
		h.Set("Content-Type", "text/html; charset=utf-8")
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
	})
}
