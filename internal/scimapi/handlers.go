package scimapi

import (
	"net/http"
	"strings"

	"github.com/ncecere/grounded/internal/scim"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func (a *api) scimBase() string { return strings.TrimRight(a.AppURL, "/") + "/scim/v2" }

func (a *api) scimServiceProviderConfig(w http.ResponseWriter, _ *http.Request, _ scim.Origin) {
	scimJSON(w, http.StatusOK, scim.ServiceProviderConfig(a.scimBase()))
}

func (a *api) scimResourceTypes(w http.ResponseWriter, _ *http.Request, _ scim.Origin) {
	scimJSON(w, http.StatusOK, scim.ResourceTypes(a.scimBase()))
}

func (a *api) scimSchemas(w http.ResponseWriter, _ *http.Request, _ scim.Origin) {
	scimJSON(w, http.StatusOK, scim.Schemas(a.scimBase()))
}

func (a *api) scimUser(w http.ResponseWriter, status int, u dbgen.User) {
	out := scim.ToUser(a.scimBase(), u)
	w.Header().Set("ETag", out.Meta.Version)
	if status == http.StatusCreated {
		w.Header().Set("Location", out.Meta.Location)
	}
	scimJSON(w, status, out)
}

func (a *api) scimListUsers(w http.ResponseWriter, r *http.Request, _ scim.Origin) {
	f, perr := scim.ParseFilter(r.URL.Query().Get("filter"), "username", "externalid", "id", "emails.value")
	if perr != nil {
		scimError(w, perr)
		return
	}
	p := scim.ParsePage(r.URL.Query().Get("startIndex"), r.URL.Query().Get("count"))
	users, total, err := a.SCIM.ListUsers(r.Context(), f, p)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	items := make([]any, len(users))
	for i, u := range users {
		items[i] = scim.ToUser(a.scimBase(), u)
	}
	scimJSON(w, http.StatusOK, scim.List(total, p.Start, items))
}

func (a *api) scimCreateUser(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	u, err := a.SCIM.CreateUser(r.Context(), o, raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimUser(w, http.StatusCreated, u)
}

func (a *api) scimGetUser(w http.ResponseWriter, r *http.Request, _ scim.Origin) {
	u, err := a.SCIM.GetUser(r.Context(), r.PathValue("id"))
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimUser(w, http.StatusOK, u)
}

func (a *api) scimReplaceUser(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	u, err := a.SCIM.ReplaceUser(r.Context(), o, r.PathValue("id"), raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimUser(w, http.StatusOK, u)
}

func (a *api) scimPatchUser(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	u, err := a.SCIM.PatchUser(r.Context(), o, r.PathValue("id"), raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimUser(w, http.StatusOK, u)
}

func (a *api) scimDeleteUser(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	if err := a.SCIM.DeleteUser(r.Context(), o, r.PathValue("id")); err != nil {
		scimFail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// withMembers is false when the client asked to leave members out (Entra: excludedAttributes=members).
func withMembers(r *http.Request) bool {
	for _, a := range strings.Split(r.URL.Query().Get("excludedAttributes"), ",") {
		if strings.EqualFold(strings.TrimSpace(a), "members") {
			return false
		}
	}
	return true
}

func (a *api) scimGroup(w http.ResponseWriter, r *http.Request, status int, id string) {
	g, members, err := a.SCIM.GetGroup(r.Context(), id, withMembers(r))
	if err != nil {
		scimFail(w, r, err)
		return
	}
	out := scim.ToGroup(a.scimBase(), g, members)
	w.Header().Set("ETag", out.Meta.Version)
	if status == http.StatusCreated {
		w.Header().Set("Location", out.Meta.Location)
	}
	scimJSON(w, status, out)
}

func (a *api) scimListGroups(w http.ResponseWriter, r *http.Request, _ scim.Origin) {
	f, perr := scim.ParseFilter(r.URL.Query().Get("filter"), "displayname", "externalid", "id")
	if perr != nil {
		scimError(w, perr)
		return
	}
	p := scim.ParsePage(r.URL.Query().Get("startIndex"), r.URL.Query().Get("count"))
	groups, total, err := a.SCIM.ListGroups(r.Context(), f, p)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	items := make([]any, len(groups))
	for i, g := range groups {
		var members []dbgen.ListSCIMGroupMembersRow
		if withMembers(r) {
			if _, members, err = a.SCIM.GetGroup(r.Context(), g.ID.String(), true); err != nil {
				scimFail(w, r, err)
				return
			}
		}
		items[i] = scim.ToGroup(a.scimBase(), g, members)
	}
	scimJSON(w, http.StatusOK, scim.List(total, p.Start, items))
}

func (a *api) scimCreateGroup(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	g, err := a.SCIM.CreateGroup(r.Context(), o, raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimGroup(w, r, http.StatusCreated, g.ID.String())
}

func (a *api) scimGetGroup(w http.ResponseWriter, r *http.Request, _ scim.Origin) {
	a.scimGroup(w, r, http.StatusOK, r.PathValue("id"))
}

func (a *api) scimReplaceGroup(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	g, err := a.SCIM.ReplaceGroup(r.Context(), o, r.PathValue("id"), raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimGroup(w, r, http.StatusOK, g.ID.String())
}

func (a *api) scimPatchGroup(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	g, err := a.SCIM.PatchGroup(r.Context(), o, r.PathValue("id"), raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimGroup(w, r, http.StatusOK, g.ID.String())
}

func (a *api) scimDeleteGroup(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	if err := a.SCIM.DeleteGroup(r.Context(), o, r.PathValue("id")); err != nil {
		scimFail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
