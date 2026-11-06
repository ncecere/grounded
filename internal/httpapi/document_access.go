package httpapi

import (
	"net/http"
	"strings"

	"github.com/ncecere/grounded/internal/access"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Document permissions (B6, #41; docs/document-permissions.md): the platform switch (signed-in platform admins write,
// auditors read), a source's restriction set by hand (team editors and up), and the group names to choose from.
func (a *api) documentAccessRoutes() []route {
	return []route{
		{"GET", "/v1/admin/document-access", a.admin(a.adminGetDocumentAccess)},
		{"PUT", "/v1/admin/document-access", a.admin(a.adminPutDocumentAccess)},
		{"PUT", "/v1/teams/{team}/sources/{sourceId}/access", a.session(a.putSourceAccess)},
		{"GET", "/v1/teams/{team}/access/groups", a.session(a.listKnownGroups)},
	}
}

func toAPIDocumentAccess(st access.Settings) apitypes.DocumentAccessSettings {
	return apitypes.DocumentAccessSettings{Enabled: st.Enabled, Revision: st.Revision, RestrictedDocuments: st.RestrictedDocuments}
}

func toAPISourceAccess(src dbgen.DataSource) *apitypes.SourceAccess {
	principals := src.AclPrincipals
	if principals == nil {
		principals = []string{}
	}
	return &apitypes.SourceAccess{Restricted: src.AclPrincipals != nil, Principals: principals}
}

func (a *api) adminGetDocumentAccess(w http.ResponseWriter, r *http.Request) {
	st, err := a.DocumentAccess.Get(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIDocumentAccess(st))
}

func (a *api) adminPutDocumentAccess(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.DocumentAccessSettingsInput](w, r)
	if !ok {
		return
	}
	st, err := a.DocumentAccess.SetEnabled(r.Context(), a.actor(r), in.Enabled, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIDocumentAccess(st))
}

func (a *api) putSourceAccess(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.SourceAccessInput](w, r)
	if !ok {
		return
	}
	var principals []string
	if in.Principals != nil {
		principals = *in.Principals
		if principals == nil {
			principals = []string{}
		}
	}
	s, err := a.Sources.SetAccess(r.Context(), a.actor(r), teamOwner(r), id, principals, rev)
	if failed(w, r, err) {
		return
	}
	setETag(w, s.Source.Revision)
	httpx.JSON(w, http.StatusOK, a.withOCRState(r, toAPISource(s), s.Source))
}

func (a *api) listKnownGroups(w http.ResponseWriter, r *http.Request) {
	acc, err := a.Teams.Get(r.Context(), a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	if !authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
		httpx.Error(w, http.StatusForbidden, "forbidden", "Only team editors, admins and owners can restrict sources")
		return
	}
	prefix := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("prefix")))
	if len(prefix) > 256 {
		httpx.Error(w, http.StatusBadRequest, "invalid_prefix", "The prefix is at most 256 characters")
		return
	}
	groups, err := a.Sources.KnownGroups(r.Context(), prefix)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, nonNilStrings(groups))
}

// optBool is b for an optional field that is only sent when true.
func optBool(b bool) *bool {
	if !b {
		return nil
	}
	return &b
}
