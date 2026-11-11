package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/platform"
)

// Source types (ADR-0035, #258; docs/source-types.md): the registered types with what each can do, for every signed-in
// person, and the platform's switch for each (platform admins).
func (a *api) sourceTypeRoutes() []route {
	return []route{
		{"GET", "/v1/source-types", a.session(a.listSourceTypes)},
		{"PUT", "/v1/admin/source-types/{key}", a.admin(a.adminPutSourceType)},
	}
}

func toAPISourceType(t platform.SourceType) apitypes.SourceType {
	out := apitypes.SourceType{
		Key: t.Key, Name: t.Name, Description: t.Description, BuiltIn: t.BuiltIn, Enabled: t.Enabled,
		Capabilities: apitypes.SourceTypeCapabilities{
			Uploads: t.Uploads, Sync: t.Sync, WebPages: t.WebPages, Shared: t.Shared,
			Permissions: apitypes.SourceTypeCapabilitiesPermissions(t.Permissions),
		},
		Credentials: make([]apitypes.SourceTypeCredential, len(t.Credentials)),
	}
	for i, f := range t.Credentials {
		out.Credentials[i] = apitypes.SourceTypeCredential{Key: f.Key, Label: f.Label, Help: f.Help, Secret: f.Secret, Required: f.Required}
	}
	if len(t.ConfigSchema) > 0 {
		var schema map[string]any
		if json.Unmarshal(t.ConfigSchema, &schema) == nil {
			out.ConfigSchema = &schema
		}
	}
	if t.Sources > 0 {
		out.Sources = &t.Sources
	}
	return out
}

func (a *api) listSourceTypes(w http.ResponseWriter, r *http.Request) {
	types, err := a.Platform.SourceTypes(r.Context(), a.actor(r))
	writeList(w, r, types, err, toAPISourceType)
}

func (a *api) adminPutSourceType(w http.ResponseWriter, r *http.Request) {
	var in apitypes.SourceTypeInput
	if !httpx.Decode(w, r, &in) {
		return
	}
	t, err := a.Platform.SetSourceTypeEnabled(r.Context(), a.actor(r), r.PathValue("key"), in.Enabled)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPISourceType(t))
}
