package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// What an API key may reach (QA pass v0.6.0, #110, #111, #112): a key with only the mcp scope has no REST access at all; a key restricted
// to some knowledge bases reaches only the sources they use; a personal key never acts above its owner's role now.

type keyAuthzEnv struct {
	*ragEnv
	base       string
	srcA, srcB apitypes.DataSource
	docA, docB apitypes.Document
	kb1, kb2   apitypes.KnowledgeBase
}

func newKeyAuthzEnv(t *testing.T) *keyAuthzEnv {
	t.Helper()
	env := &keyAuthzEnv{ragEnv: newRAGEnv(t)}
	env.base = "/v1/teams/" + env.team
	setMCP(t, env.admin, true)
	mk := func(name, file, text string) (apitypes.DataSource, apitypes.Document) {
		var src apitypes.DataSource
		code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": name, "classification": "sensitive"}, &src, nil)
		mustCode(t, "create source "+name, code, e, 201, "")
		docs := env.base + "/sources/" + src.Id.String() + "/documents"
		code, _, e2 := env.owner.uploadFiles(docs, []upload{{file, []byte(text)}}, "")
		if code != 200 {
			t.Fatalf("upload %s = %d %s", file, code, e2)
		}
		ready := byName(env.owner.waitForDocuments(t, docs))
		if ready[file].Status != "ready" {
			t.Fatalf("%s = %+v", file, ready[file])
		}
		return src, ready[file]
	}
	env.srcA, env.docA = mk("Parking", "parking.md", "# Parking\n\nStudents must display a permit. PINEAPPLE-A.")
	env.srcB, env.docB = mk("Housing", "housing.md", "# Housing\n\nResidence halls open in August. PINEAPPLE-B.")
	kb := func(name string, src apitypes.DataSource) apitypes.KnowledgeBase {
		var out apitypes.KnowledgeBase
		code, e := env.owner.call("POST", env.base+"/kbs", map[string]any{"name": name, "topK": 3}, &out, nil)
		mustCode(t, "create kb "+name, code, e, 201, "")
		code, e = env.owner.call("PUT", env.base+"/kbs/"+out.Id.String()+"/sources/"+src.Id.String(), nil, &out, nil)
		mustCode(t, "attach "+name, code, e, 200, "")
		return out
	}
	env.kb1, env.kb2 = kb("Parking KB", env.srcA), kb("Housing KB", env.srcB)
	return env
}

func (env *keyAuthzEnv) docPath(src apitypes.DataSource, doc apitypes.Document, tail string) string {
	return env.base + "/sources/" + src.Id.String() + "/documents/" + doc.Id.String() + tail
}

func TestMCPOnlyKeyHasNoRESTAccess(t *testing.T) {
	env := newKeyAuthzEnv(t)
	mcpKey := createKey(t, env.owner, env.base, map[string]any{"name": "ai tool", "kind": "service", "scopes": []string{"mcp"}})
	queryKey := createKey(t, env.owner, env.base, map[string]any{"name": "search", "kind": "service", "scopes": []string{"query"}})

	paths := []string{
		env.base + "/sources", env.base + "/kbs", env.base + "/agents",
		env.base + "/sources/" + env.srcA.Id.String(),
		env.docPath(env.srcA, env.docA, ""), env.docPath(env.srcA, env.docA, "/passages"),
	}
	for _, p := range paths {
		if code, e := keyCall(t, env.app.URL, "GET", p, queryKey.Secret, nil, nil); code != 200 {
			t.Errorf("control: a query key reads %s = %d %s", p, code, e)
		}
		code, e := keyCall(t, env.app.URL, "GET", p, mcpKey.Secret, nil, nil)
		if code != 403 || e != "missing_scope" {
			t.Errorf("an mcp-only key reads %s = %d %s, want 403 missing_scope", p, code, e)
		}
	}

	// It is still welcome where it belongs: the MCP server.
	cs := mustConnect(t, env.app.URL, mcpKey.Secret, "")
	if tools, err := cs.ListTools(t.Context(), nil); err != nil || len(tools.Tools) == 0 {
		t.Fatalf("the mcp-only key lists tools on /mcp: %v %+v", err, tools)
	}
}

func TestKeyRestrictedToKnowledgeBasesReachesOnlyTheirSources(t *testing.T) {
	env := newKeyAuthzEnv(t)
	key := createKey(t, env.owner, env.base, map[string]any{
		"name": "parking only", "kind": "service", "scopes": []string{"query", "ingest", "manage"}, "knowledgeBaseIds": []string{env.kb1.Id.String()},
	})
	get := func(p string) (int, string) { return keyCall(t, env.app.URL, "GET", p, key.Secret, nil, nil) }

	// Inside the restriction.
	for _, p := range []string{
		env.base + "/sources/" + env.srcA.Id.String(), env.base + "/sources/" + env.srcA.Id.String() + "/documents",
		env.docPath(env.srcA, env.docA, ""), env.docPath(env.srcA, env.docA, "/passages"), env.docPath(env.srcA, env.docA, "/text"),
	} {
		if code, e := get(p); code != 200 {
			t.Errorf("inside the restriction: %s = %d %s", p, code, e)
		}
	}
	// The list holds only the sources of the key's knowledge bases.
	var list []apitypes.DataSource
	if code, e := keyCall(t, env.app.URL, "GET", env.base+"/sources", key.Secret, nil, &list); code != 200 || len(list) != 1 || list[0].Id != env.srcA.Id {
		t.Errorf("source list for the restricted key = %d %s %+v", code, e, list)
	}
	// Outside it, the source does not exist for this key: the same answer as for an unknown one.
	outside := []string{
		env.base + "/sources/" + env.srcB.Id.String(), env.base + "/sources/" + env.srcB.Id.String() + "/documents",
		env.base + "/sources/" + env.srcB.Id.String() + "/tags", env.base + "/sources/" + env.srcB.Id.String() + "/crawls",
		env.docPath(env.srcB, env.docB, ""), env.docPath(env.srcB, env.docB, "/passages"), env.docPath(env.srcB, env.docB, "/text"),
	}
	for _, p := range outside {
		if code, e := get(p); code != 404 || e != "source_not_found" {
			t.Errorf("outside the restriction: %s = %d %s, want 404 source_not_found", p, code, e)
		}
		if code, _ := env.owner.call("GET", p, nil, nil, nil); code != 200 {
			t.Errorf("control: the owner reads %s = %d", p, code)
		}
	}
	if code, e := keyCall(t, env.app.URL, "POST", env.base+"/sources/"+env.srcB.Id.String()+"/sync", key.Secret, nil, nil); code != 404 {
		t.Errorf("sync outside the restriction = %d %s", code, e)
	}
	if code, _, e := env.owner.uploadFiles(env.base+"/sources/"+env.srcB.Id.String()+"/documents", []upload{{"x.md", []byte("# x\n\ny")}}, key.Secret); code != 404 {
		t.Errorf("upload outside the restriction = %d %s", code, e)
	}
}

func TestPersonalKeyNeverActsAboveItsOwnersRole(t *testing.T) {
	env := newKeyAuthzEnv(t)
	alex := env.app.signIn("alex")
	var added apitypes.MemberAddResult
	code, e := env.owner.call("POST", env.base+"/members", map[string]string{"email": "alex@localhost", "role": "editor"}, &added, nil)
	mustCode(t, "add alex as editor", code, e, 201, "")
	alex.refresh()
	key := createKey(t, alex, env.base, map[string]any{"name": "alex ingest", "scopes": []string{"ingest", "query"}})
	text := env.docPath(env.srcA, env.docA, "/text")
	upload1 := func() int {
		code, _, _ := env.owner.uploadFiles(env.base+"/sources/"+env.srcA.Id.String()+"/documents", []upload{{"a-new.md", []byte("# New\n\nbody")}}, key.Secret)
		return code
	}

	// As an editor the key does what an editor may.
	if code, e := keyCall(t, env.app.URL, "GET", text, key.Secret, nil, nil); code != 200 {
		t.Fatalf("an editor's key reads the whole document = %d %s", code, e)
	}
	if c := upload1(); c != 200 {
		t.Fatalf("an editor's key uploads = %d", c)
	}

	// The owner demotes alex to a plain member: the key follows at once.
	var m apitypes.Member
	code, e = env.owner.call("PATCH", env.base+"/members/"+alex.me.User.Id.String(), map[string]string{"role": "member"}, &m, ifMatch(added.Member.Revision))
	mustCode(t, "demote alex", code, e, 200, "")
	if code, e := keyCall(t, env.app.URL, "GET", text, key.Secret, nil, nil); code != 403 {
		t.Errorf("a demoted member's key still reads the whole document = %d %s", code, e)
	}
	if c := upload1(); c != 403 {
		t.Errorf("a demoted member's key still uploads = %d", c)
	}
	// What a member may still do, the key may: read the source list.
	if code, e := keyCall(t, env.app.URL, "GET", env.base+"/sources", key.Secret, nil, nil); code != 200 {
		t.Errorf("a member's key lists sources = %d %s", code, e)
	}
}
