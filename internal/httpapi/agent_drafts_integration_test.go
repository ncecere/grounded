package httpapi_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// A draft is editor material (docs: "Nobody chats with the draft except editors"): the instructions of an agent that is not published, or the
// edits not yet published to one that is, are not for plain team members, whom the app shows the published configuration only (#129).
func TestMembersDoNotSeeAgentDrafts(t *testing.T) {
	env := newAgentEnv(t)
	const secret = "SECRET-DRAFT-INSTRUCTIONS-123"

	cfg := env.agentConfig(env.kb.Id.String())
	cfg["instructions"] = secret
	var hidden apitypes.Agent // never published
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": "Unpublished helper", "config": cfg}, &hidden, nil)
	mustCode(t, "create", code, e, 201, "")

	live := env.publishAgent(t, "Live helper", env.agentConfig(env.kb.Id.String())) // published with 'Be brief and friendly.'
	edit := env.agentConfig(env.kb.Id.String())
	edit["instructions"] = secret + "-EDIT" // an edit not yet published
	code, e = env.editor.call("PATCH", env.base+"/agents/"+live.Id.String(), map[string]any{"config": edit}, nil, ifMatch(live.Revision))
	mustCode(t, "edit the draft", code, e, 200, "")

	paths := []string{env.base + "/agents", env.base + "/agents/" + hidden.Id.String(), env.base + "/agents/" + live.Id.String()}
	memberKey := createKey(t, env.member, env.base, map[string]any{"name": "mine", "scopes": []string{"query"}})
	editorKey := createKey(t, env.editor, env.base, map[string]any{"name": "mine", "scopes": []string{"ingest"}})

	// Editors read drafts; the control for what follows.
	for name, s := range map[string]*session{"editor": env.editor, "team admin": env.tadmin} {
		if _, raw := s.raw("GET", paths[1], nil, nil); !containsText(raw, secret) {
			t.Errorf("control: the %s does not see the draft: %s", name, raw)
		}
	}
	if code, _ := keyCall(t, env.app.URL, "GET", paths[1], editorKey.Secret, nil, nil); code != 200 {
		t.Errorf("control: an editor's ingest key reads the agent = %d", code)
	}

	// Members, and a member's query key, get the agent without its draft.
	for _, p := range paths {
		_, raw := env.member.raw("GET", p, nil, nil)
		if containsText(raw, secret) {
			t.Errorf("a member reads %s and sees draft instructions: %s", p, raw)
		}
		code, body := keyBody(t, env.app.URL, p, memberKey.Secret)
		if code != 200 || containsText(body, secret) {
			t.Errorf("a member's query key reads %s = %d and sees draft instructions: %s", p, code, body)
		}
	}
	// Publish problems of a draft are editors' business too.
	var bare apitypes.Agent
	code, e = env.editor.call("POST", env.base+"/agents", map[string]any{"name": "Bare helper"}, &bare, nil)
	mustCode(t, "create a bare agent", code, e, 201, "")
	var asEditor, asMember apitypes.Agent
	env.editor.get(env.base+"/agents/"+bare.Id.String(), &asEditor)
	env.member.get(env.base+"/agents/"+bare.Id.String(), &asMember)
	if len(asEditor.Warnings) == 0 {
		t.Fatalf("control: the editor sees no publish problems for a bare agent: %+v", asEditor)
	}
	if len(asMember.Warnings) != 0 {
		t.Errorf("a member sees publish problems of a draft: %+v", asMember.Warnings)
	}
	// The published configuration is still theirs to read (the read-only summary), and the list still names every agent.
	var got apitypes.Agent
	if code := env.member.get(paths[2], &got); code != 200 || got.Published == nil || got.Published.Config.Instructions != "Be brief and friendly." {
		t.Errorf("a member's view of a published agent = %d %+v", code, got.Published)
	}
	if got.HasUnpublishedChanges || got.Draft.Instructions != "" || len(got.Warnings) != 0 {
		t.Errorf("a member is told about the draft: changes=%v draft=%q warnings=%v", got.HasUnpublishedChanges, got.Draft.Instructions, got.Warnings)
	}
	var list []apitypes.Agent
	if code := env.member.get(paths[0], &list); code != 200 || len(list) < 2 {
		t.Errorf("a member's list = %d, %d agents", code, len(list))
	}
}

func containsText(b []byte, s string) bool { return strings.Contains(string(b), s) }

// keyBody GETs a path with an API key and returns the status and the body.
func keyBody(t *testing.T, base, path, key string) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest("GET", base+path, nil)
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, raw
}
