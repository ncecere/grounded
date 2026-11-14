package httpapi

import (
	"net/http"
	"net/mail"
	"net/url"
	"strings"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/displaytext"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func (a *api) accessibilityRoutes() []route {
	return []route{
		{"GET", "/v1/accessibility", a.anonymous(a.getAccessibilitySettings)},
		{"GET", "/v1/admin/settings/accessibility", a.admin(a.getAccessibilitySettings)},
		{"PUT", "/v1/admin/settings/accessibility", a.admin(a.putAccessibilitySettings)},
	}
}

func accessibilityView(row dbgen.AccessibilitySetting) apitypes.AccessibilitySettings {
	return apitypes.AccessibilitySettings{ContactUrl: row.ContactUrl, InstitutionUrl: row.InstitutionUrl, Revision: row.Revision}
}

func (a *api) getAccessibilitySettings(w http.ResponseWriter, r *http.Request) {
	row, err := a.Platform.Accessibility(r.Context())
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, row.Revision, accessibilityView(row))
}

// statementLink accepts only explicit display links, never fetches them, and
// rejects mail headers and credential-bearing URLs (ADR0030).
func statementLink(value string, contact bool) bool {
	if value == "" {
		return true
	}
	if len(value) > 2048 || displaytext.Validate(value, "invalid_link", "Link") != nil || strings.ContainsAny(value, "<>") {
		return false
	}
	decoded, err := url.PathUnescape(value)
	if err != nil || displaytext.Validate(decoded, "invalid_link", "Link") != nil {
		return false
	}
	u, err := url.Parse(value)
	if err != nil || u.User != nil {
		return false
	}
	if u.Scheme == "https" {
		return u.Hostname() != "" && u.Opaque == ""
	}
	if !contact || u.Scheme != "mailto" || u.RawQuery != "" || u.Fragment != "" || u.Host != "" {
		return false
	}
	address, err := mail.ParseAddress(u.Opaque)
	return err == nil && address.Address == u.Opaque && !strings.ContainsAny(u.Opaque, "%<>")
}

func (a *api) putAccessibilitySettings(w http.ResponseWriter, r *http.Request) {
	actor := a.actor(r)
	if actor.Delegated() || !actor.IsPlatformAdmin() {
		failed(w, r, apperr.Forbidden("Only platform admins can edit the accessibility statement"))
		return
	}
	wire, rev, ok := decodeRevised[struct {
		ContactUrl     *string `json:"contactUrl"`
		InstitutionUrl *string `json:"institutionUrl"`
	}](w, r)
	if !ok {
		return
	}
	if wire.ContactUrl == nil || wire.InstitutionUrl == nil {
		failed(w, r, apperr.Invalid("invalid_link", "Supply both link fields explicitly; use empty text to clear them"))
		return
	}
	in := apitypes.AccessibilitySettingsInput{ContactUrl: *wire.ContactUrl, InstitutionUrl: *wire.InstitutionUrl}
	if !statementLink(in.ContactUrl, true) || !statementLink(in.InstitutionUrl, false) {
		failed(w, r, apperr.Invalid("invalid_link", "Use HTTPS links or a simple mailto reporting contact, without credentials, HTML, headers or controls"))
		return
	}
	out, err := a.Platform.UpdateAccessibility(r.Context(), actor, in.ContactUrl, in.InstitutionUrl, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, out.Revision, accessibilityView(out))
}
