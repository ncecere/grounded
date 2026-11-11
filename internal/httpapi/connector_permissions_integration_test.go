package httpapi_test

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/connector/connectortest"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// A connector's document permissions (docs/specs/document-acls/DESIGN.md, ADR-0035): each document is readable by the
// people and groups the provider names and by nobody else, whatever their role in the team; what the connector can't
// express gives nobody access; a change of permissions or of group membership applies at the next sync without the
// content being read again.

// animals are words that occur nowhere else, one per file, so a search result shows exactly which files a reader got.
var animals = []string{"quokka", "narwhal", "axolotl", "pangolin", "okapi", "tapir", "kakapo"}

func (env *connectorEnv) sees(t *testing.T, who string, raw string, want ...string) {
	t.Helper()
	got := []string{}
	for _, a := range animals {
		if strings.Contains(raw, a) {
			got = append(got, a)
		}
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("%s reads %v, want %v", who, got, want)
	}
}

func (env *connectorEnv) search(t *testing.T, s *session) string {
	t.Helper()
	code, raw := s.raw("POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve",
		map[string]any{"query": "field notes on the " + strings.Join(animals, " "), "topK": 20}, nil)
	if code != 200 {
		t.Fatalf("retrieve = %d %s", code, raw)
	}
	return string(raw)
}

func note(animal string) string {
	return "# Field notes\n\nThe " + animal + " was observed near the river at dawn.\n"
}

func TestConnectorPermissionsReachOnlyTheirPrincipals(t *testing.T) {
	env := newConnectorEnv(t)
	p := env.p
	env.setGroups(t, env.member, "parking-office")
	editor, tadmin, owner := env.editor.me.User.Id.String(), env.tadmin.me.User.Id.String(), env.owner.me.User.Id.String()
	p.SetGroup("Staff", []string{"user:" + tadmin, "not a principal"})
	p.Put("everyone", "everyone.md", note("quokka"), &connector.Permissions{Everyone: true})
	p.Put("group", "group.md", note("narwhal"), &connector.Permissions{Principals: []string{"group:Parking-Office"}})
	p.Put("person", "person.md", note("axolotl"), &connector.Permissions{Principals: []string{"user:" + editor}})
	p.Put("staff", "staff.md", note("pangolin"), &connector.Permissions{Groups: []string{"staff"}})
	p.Put("unreported", "unreported.md", note("okapi"), nil)
	p.Put("link", "link.md", note("tapir"), &connector.Permissions{Notes: []string{"A link for anyone gives nobody access."}})
	p.Put("mixed", "mixed.md", note("kakapo"), &connector.Permissions{Principals: []string{"everyone", "role:admin", "group:parking-office"}})
	src := env.create(t, connectortest.TypeDrive, "Field notes", nil)
	id := src.Id.String()
	code, e := env.owner.call("PUT", env.base+"/kbs/"+env.kb.Id.String()+"/sources/"+id, nil, nil, nil)
	mustCode(t, "attach to the knowledge base", code, e, 200, "")

	check := func(step string, member, editorSees, admin, ownerSees []string) {
		t.Helper()
		env.sees(t, step+": the member in the group", env.search(t, env.member), member...)
		env.sees(t, step+": the editor named on one file", env.search(t, env.editor), editorSees...)
		env.sees(t, step+": the team admin in the provider's group", env.search(t, env.tadmin), admin...)
		env.sees(t, step+": the team's owner, named nowhere", env.search(t, env.owner), ownerSees...)
	}
	check("first sync", []string{"quokka", "narwhal", "kakapo"}, []string{"quokka", "axolotl"}, []string{"quokka", "pangolin"}, []string{"quokka"})

	// An API key is a program: it reads unrestricted documents only, even with every scope.
	var key struct {
		Secret string `json:"secret"`
	}
	code, e = env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": "Service", "kind": "service", "scopes": []string{"query", "ingest", "manage"}}, &key, nil)
	mustCode(t, "api key", code, e, 201, "")
	_, raw := keyRaw(t, env.app.URL, "POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve", key.Secret,
		map[string]any{"query": "field notes on the " + strings.Join(animals, " "), "topK": 20})
	env.sees(t, "an API key", raw, "quokka")

	// Editors manage every document by name; its text only if they are on its list.
	docs := env.documents(t, id)
	for name, restricted := range map[string]bool{"everyone.md": false, "group.md": true, "unreported.md": true, "link.md": true} {
		if d := docs[name]; (d.Restricted != nil && *d.Restricted) != restricted {
			t.Errorf("%s restricted = %v, want %v", name, d.Restricted, restricted)
		}
	}
	code, e = env.editor.call("GET", env.path(id)+"/documents/"+docs["group.md"].Id.String()+"/passages", nil, nil, nil)
	mustCode(t, "the editor reading a document restricted to others", code, e, 403, "document_restricted")
	if code, _ := env.editor.call("GET", env.path(id)+"/documents/"+docs["person.md"].Id.String()+"/passages", nil, nil, nil); code != 200 {
		t.Errorf("the editor reading the document they are named on = %d", code)
	}

	// The provider decides: a restriction can't be set by hand on this source.
	var cur apitypes.DataSource
	env.editor.get(env.path(id), &cur)
	code, e = env.editor.call("PUT", env.path(id)+"/access", map[string]any{"principals": nil}, nil, ifMatch(cur.Revision))
	mustCode(t, "make a connector's source unrestricted by hand", code, e, 409, "access_from_provider")

	// Permissions change without the content changing: the next sync applies them and reads nothing.
	reads := p.Opens()
	p.Share("group", &connector.Permissions{Principals: []string{"group:library"}})
	p.Share("person", &connector.Permissions{Everyone: true})
	p.Share("everyone", &connector.Permissions{Groups: []string{"staff"}})
	got := env.sync(t, id, false)
	if got.PermissionsChanged != 3 || got.ItemsChanged != 0 || p.Opens() != reads {
		t.Errorf("a sync of permission changes: %s, %d reads", counts(got), p.Opens()-reads)
	}
	check("after sharing changed", []string{"axolotl", "kakapo"}, []string{"axolotl"}, []string{"quokka", "axolotl", "pangolin"}, []string{"axolotl"})

	// Membership of the provider's own group changes: it applies at the next sync.
	p.SetGroup("Staff", []string{"user:" + owner})
	env.sync(t, id, false)
	check("after the group's members changed", []string{"axolotl", "kakapo"}, []string{"axolotl"}, []string{"axolotl"}, []string{"quokka", "axolotl", "pangolin"})

	// The group is gone from the provider: after a complete sync nobody is in it.
	p.SetGroup("Staff", nil)
	env.sync(t, id, true)
	check("after the group was removed", []string{"axolotl", "kakapo"}, []string{"axolotl"}, []string{"axolotl"}, []string{"axolotl"})
	if n := env.scalar(t, `SELECT count(*) FROM source_group_members WHERE source_id = $1`, src.Id); n != 0 {
		t.Errorf("%d members of the removed group are left", n)
	}

	// What the connector could not express is kept as a note for editors, and never widened.
	for name, want := range map[string]string{"unreported": "reported no permissions", "link": "link for anyone", "mixed": "2 entries could not be matched"} {
		if n := env.scalar(t, `SELECT count(*) FROM documents WHERE source_id = $1 AND external_id = $2 AND acl::text LIKE '%' || $3 || '%'`, src.Id, name, want); n != 1 {
			t.Errorf("%s has no note saying %q", name, want)
		}
	}
	if n := env.scalar(t, `SELECT count(*) FROM documents WHERE source_id = $1 AND external_id IN ('unreported', 'link') AND acl_principals = '{}'`, src.Id); n != 2 {
		t.Errorf("%d of the two unexpressed documents are restricted to nobody, want 2", n)
	}
}

func TestConnectorWithoutPermissionsTakesAHandSetRestriction(t *testing.T) {
	env := newConnectorEnv(t)
	p := env.p
	env.setGroups(t, env.member, "parking-office")
	// The provider's permissions are ignored for a type that reports none.
	p.Put("a", "a.md", note("quokka"), &connector.Permissions{Principals: []string{"group:nobody-here"}})
	src := env.create(t, connectortest.TypeBucket, "Bucket notes", nil)
	id := src.Id.String()
	code, e := env.owner.call("PUT", env.base+"/kbs/"+env.kb.Id.String()+"/sources/"+id, nil, nil, nil)
	mustCode(t, "attach", code, e, 200, "")
	env.sees(t, "the owner, before any restriction", env.search(t, env.owner), "quokka")

	var cur apitypes.DataSource
	env.editor.get(env.path(id), &cur)
	code, e = env.editor.call("PUT", env.path(id)+"/access", map[string]any{"principals": []string{"group:parking-office"}}, &cur, ifMatch(cur.Revision))
	mustCode(t, "restrict by hand", code, e, 200, "")
	// A document the next sync adds, and one it changes, both carry the source's restriction.
	p.Put("b", "b.md", note("narwhal"), nil)
	p.Put("a", "a.md", note("quokka")+"\nSeen again at dusk.\n", nil)
	if got := env.sync(t, id, false); got.ItemsAdded != 1 || got.ItemsChanged != 1 {
		t.Fatalf("sync: %s", counts(got))
	}
	env.sees(t, "the member in the group", env.search(t, env.member), "quokka", "narwhal")
	env.sees(t, "the owner, outside the group", env.search(t, env.owner))
}

func TestConnectorWithPermissionsNeedsTheSwitch(t *testing.T) {
	env := &connectorEnv{accessEnv: &accessEnv{publishEnv: newPublishEnv(t)}, p: connectortest.NewProvider()}
	t.Cleanup(env.p.Close)
	var open apitypes.Classification
	var levels []apitypes.Classification
	env.admin.get("/v1/classifications", &levels)
	for _, l := range levels {
		if l.Key == "open" {
			open = l
		}
	}
	body := map[string]any{"name": "Drive", "type": connectortest.TypeDrive, "classification": "open", "connector": env.settings(nil)}
	code, e := env.editor.call("POST", env.base+"/sources", body, nil, nil)
	mustCode(t, "a type that is off", code, e, 409, "source_type_off")
	code, e = env.admin.call("PUT", "/v1/admin/source-types/"+connectortest.TypeDrive, map[string]any{"enabled": true}, nil, nil)
	mustCode(t, "type on", code, e, 200, "")
	code, e = env.editor.call("POST", env.base+"/sources", body, nil, nil)
	mustCode(t, "a type no level allows yet", code, e, 400, "source_type_not_allowed")
	code, e = env.admin.call("PATCH", "/v1/admin/classifications/open", map[string]any{"allowedSourceTypes": []string{"upload", "web", connectortest.TypeDrive}}, nil, ifMatch(open.Revision))
	mustCode(t, "allow it at open", code, e, 200, "")
	code, e = env.editor.call("POST", env.base+"/sources", body, nil, nil)
	mustCode(t, "permissions from the provider while document permissions are off", code, e, 409, "document_permissions_off")
	code, e = env.admin.call("POST", "/v1/admin/shared-sources", body, nil, nil)
	mustCode(t, "a shared connector source", code, e, 400, "type_not_shared")
	if n := env.scalar(t, `SELECT count(*) FROM data_sources WHERE type = $1`, connectortest.TypeDrive); n != 0 {
		t.Errorf("%d sources were left behind by refused creations", n)
	}
}

// A source whose type this build does not have (it was made by a build with another connector) is inert: it and its
// documents stay and stay searchable, and nothing uploads to it or syncs it.
func TestSourceOfAnUnknownTypeIsInert(t *testing.T) {
	env := newConnectorEnv(t)
	env.p.Put("a", "a.md", note("quokka"), nil)
	src := env.create(t, connectortest.TypeBucket, "From another build", nil)
	id := src.Id.String()
	code, e := env.owner.call("PUT", env.base+"/kbs/"+env.kb.Id.String()+"/sources/"+id, nil, nil, nil)
	mustCode(t, "attach", code, e, 200, "")
	env.sql(t, `UPDATE data_sources SET type = 'gone_connector' WHERE id = $1`, src.Id)

	var cur apitypes.DataSource
	if code := env.editor.get(env.path(id), &cur); code != 200 || cur.Type != "gone_connector" || cur.Connector != nil {
		t.Fatalf("the source = %d %+v", code, cur)
	}
	var list []apitypes.DataSource
	if code := env.editor.get(env.base+"/sources", &list); code != 200 {
		t.Fatalf("list sources = %d", code)
	}
	if len(env.documents(t, id)) != 1 {
		t.Error("its document is gone")
	}
	env.sees(t, "a search", env.search(t, env.owner), "quokka")
	code, e = env.editor.call("POST", env.path(id)+"/syncs", nil, nil, nil)
	mustCode(t, "sync", code, e, 400, "not_connector_source")
	code, e = env.editor.call("POST", env.path(id)+"/sync", nil, nil, nil)
	mustCode(t, "crawl", code, e, 400, "not_web_source")
	if code, _, e := env.editor.uploadFiles(env.path(id)+"/documents", []upload{{"b.md", []byte("# B\n")}}, ""); code != 400 || e != "not_upload_source" {
		t.Errorf("upload = %d %s", code, e)
	}
	if len(env.documents(t, id)) != 1 {
		t.Error("a file was uploaded to a source of an unknown type")
	}
}
