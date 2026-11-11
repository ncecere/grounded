package httpapi_test

import (
	"slices"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/sourcetypes"
)

// Source types (ADR-0035, #258; docs/source-types.md): the registry lists upload and web with what each can do; a
// platform admin turns a type off and on, which stops and allows new sources of it and nothing else; a type that is not
// built in starts off; a classification level allows any registered type and no other.

// sampleType is a registered type with no connector behind it, as a build with one more connector would have.
const sampleType = "zz_sample"

func init() {
	sourcetypes.Register(sourcetypes.Type{
		Key: sampleType, Name: "Sample connector", Description: "A type registered by the tests",
		Capabilities: sourcetypes.Capabilities{Sync: true, Permissions: sourcetypes.PermissionsProvider},
		ConfigSchema: []byte(`{"type":"object","properties":{"folder":{"type":"string"}}}`),
		Credentials:  []sourcetypes.Field{{Key: "token", Label: "Access token", Secret: true, Required: true}},
	})
}

func sourceTypes(t *testing.T, s *session) map[string]apitypes.SourceType {
	t.Helper()
	var list []apitypes.SourceType
	if code := s.get("/v1/source-types", &list); code != 200 {
		t.Fatalf("list source types = %d", code)
	}
	out := map[string]apitypes.SourceType{}
	for i, st := range list {
		if i < 2 && st.Key != []string{"upload", "web"}[i] {
			t.Errorf("type %d is %s: upload and web come first", i, st.Key)
		}
		out[st.Key] = st
	}
	return out
}

func TestSourceTypes(t *testing.T) {
	env := newPublishEnv(t)
	site := newTestSite(t)
	webSource := func(name string) (apitypes.DataSource, int, string) {
		var out apitypes.DataSource
		code, e := env.editor.call("POST", env.base+"/sources", map[string]any{"name": name, "type": "web", "classification": "open",
			"web": map[string]any{"mode": "scrape", "urls": []string{site.url("/")}}}, &out, nil)
		return out, code, e
	}

	// Every signed-in person reads the list; only platform staff see how many sources each type has.
	types := sourceTypes(t, env.member)
	up, web, sample := types["upload"], types["web"], types[sampleType]
	if !up.Enabled || !up.BuiltIn || !up.Capabilities.Uploads || up.Capabilities.Sync || up.Capabilities.WebPages ||
		up.Capabilities.Permissions != "none" || !up.Capabilities.Shared || up.Sources != nil || up.ConfigSchema != nil || len(up.Credentials) != 0 {
		t.Errorf("upload = %+v", up)
	}
	if !web.Enabled || !web.BuiltIn || web.Capabilities.Uploads || !web.Capabilities.Sync || !web.Capabilities.WebPages || web.Capabilities.Permissions != "none" {
		t.Errorf("web = %+v", web)
	}
	if sample.Enabled || sample.BuiltIn || sample.Capabilities.Permissions != "provider" || sample.ConfigSchema == nil ||
		len(sample.Credentials) != 1 || !sample.Credentials[0].Secret || sample.Credentials[0].Key != "token" {
		t.Errorf("a type that is not built in starts off, with its schema and credentials: %+v", sample)
	}
	if n := sourceTypes(t, env.auditor)["upload"].Sources; n == nil || *n < 1 {
		t.Errorf("the auditor sees the number of upload sources: %v", n)
	}

	// Only a platform admin changes a type; an unknown type is not found.
	for name, s := range map[string]*session{"owner": env.owner, "auditor": env.auditor} {
		if code, _ := s.call("PUT", "/v1/admin/source-types/web", map[string]any{"enabled": false}, nil, nil); code != 403 {
			t.Errorf("%s turning a type off = %d", name, code)
		}
	}
	code, e := env.admin.call("PUT", "/v1/admin/source-types/sharepoint", map[string]any{"enabled": true}, nil, nil)
	mustCode(t, "unknown type", code, e, 404, "source_type_not_found")

	// Off: no new web source; the existing sources, uploads and other types are untouched. On again: as before.
	first, code, e := webSource("Before")
	mustCode(t, "web source while on", code, e, 201, "")
	var off apitypes.SourceType
	code, e = env.admin.call("PUT", "/v1/admin/source-types/web", map[string]any{"enabled": false}, &off, nil)
	mustCode(t, "turn web off", code, e, 200, "")
	if off.Enabled || off.Key != "web" || off.Sources == nil || *off.Sources < 1 {
		t.Errorf("web after turning it off = %+v", off)
	}
	if sourceTypes(t, env.member)["web"].Enabled {
		t.Error("the list still shows web on")
	}
	_, code, e = webSource("While off")
	mustCode(t, "web source while off", code, e, 409, "source_type_off")
	var still apitypes.DataSource
	if code := env.editor.get(env.base+"/sources/"+first.Id.String(), &still); code != 200 || still.Type != "web" {
		t.Errorf("the existing web source = %d %+v", code, still.Type)
	}
	code, e = env.editor.call("POST", env.base+"/sources", map[string]any{"name": "Files while web is off", "classification": "open"}, nil, nil)
	mustCode(t, "upload source while web is off", code, e, 201, "")
	code, e = env.admin.call("PUT", "/v1/admin/source-types/web", map[string]any{"enabled": false}, nil, nil)
	mustCode(t, "turn web off again", code, e, 200, "")
	code, e = env.admin.call("PUT", "/v1/admin/source-types/web", map[string]any{"enabled": true}, nil, nil)
	mustCode(t, "turn web on", code, e, 200, "")
	_, code, e = webSource("After")
	mustCode(t, "web source once on again", code, e, 201, "")
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.source_type' AND target_id = 'web'`); n != 2 {
		t.Errorf("platform.source_type entries = %d: one for off and one for on, none for the change that changed nothing", n)
	}

	// A type with no connector in this build can't hold a source, on or off; an unknown type never can.
	code, e = env.editor.call("POST", env.base+"/sources", map[string]any{"name": "Sample", "type": sampleType, "classification": "open"}, nil, nil)
	mustCode(t, "a type without a connector", code, e, 400, "unsupported_type")
	code, e = env.editor.call("POST", env.base+"/sources", map[string]any{"name": "Nothing", "type": "sharepoint", "classification": "open"}, nil, nil)
	mustCode(t, "an unknown type", code, e, 400, "unsupported_type")
}

func TestClassificationAllowsRegisteredSourceTypes(t *testing.T) {
	env := newPublishEnv(t)
	var levels []apitypes.Classification
	env.admin.get("/v1/classifications", &levels)
	i := slices.IndexFunc(levels, func(l apitypes.Classification) bool { return l.Key == "open" })
	if i < 0 || !slices.Equal(levels[i].AllowedSourceTypes, []string{"upload", "web"}) {
		t.Fatalf("open's allowed types before = %+v", levels)
	}
	var out apitypes.Classification
	code, e := env.admin.call("PATCH", "/v1/admin/classifications/open", map[string]any{"allowedSourceTypes": []string{"upload", "web", sampleType}}, &out, ifMatch(levels[i].Revision))
	mustCode(t, "allow a registered type", code, e, 200, "")
	if !slices.Equal(out.AllowedSourceTypes, []string{"upload", "web", sampleType}) {
		t.Errorf("allowed types = %v", out.AllowedSourceTypes)
	}
	code, e = env.admin.call("PATCH", "/v1/admin/classifications/open", map[string]any{"allowedSourceTypes": []string{"upload", "sharepoint"}}, nil, ifMatch(out.Revision))
	mustCode(t, "allow an unknown type", code, e, 400, "invalid_source_type")
}
