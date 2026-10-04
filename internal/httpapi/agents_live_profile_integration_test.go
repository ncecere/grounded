package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// An agent's profile (name, address, description, look, welcome) isn't
// versioned: it reaches people at once. While the agent is published beyond
// the team, only team admins and owners change it, as only they publish
// there; editors keep the draft (BU-09, v0.4.2).
func TestEditorsKeepTheDraftOfAWiderAgent(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open desk")
	path := env.base + "/agents/" + pub.Id.String()
	var cur apitypes.Agent
	env.editor.get(path, &cur)

	for _, body := range []map[string]any{
		{"name": "Renamed by an editor"},
		{"slug": "renamed-desk"},
		{"description": "Edited"},
		{"welcomeMessage": "Hi from an editor"},
		{"accentColor": "#1d4ed8"},
		{"starterQuestions": []string{"Where is the desk?"}},
	} {
		code, e := env.editor.call("PATCH", path, body, nil, ifMatch(cur.Revision))
		mustCode(t, "editor changes the live profile", code, e, 403, "live_profile_forbidden")
	}
	// The same values (an editor's form saving its draft) and the draft itself are fine.
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["audience"] = "public"
	cfg["instructions"] = "Answer briefly."
	code, e := env.editor.call("PATCH", path, map[string]any{"name": cur.Name, "description": cur.Description, "config": cfg}, &cur, ifMatch(cur.Revision))
	mustCode(t, "editor changes the draft", code, e, 200, "")
	if cur.Draft.Instructions != "Answer briefly." || !cur.HasUnpublishedChanges {
		t.Fatalf("draft after the editor's change = %+v", cur.Draft)
	}
	// Admins and owners change the profile.
	code, e = env.tadmin.call("PATCH", path, map[string]any{"welcomeMessage": "Hello."}, &cur, ifMatch(cur.Revision))
	mustCode(t, "team admin changes the live profile", code, e, 200, "")

	// An agent live for its team only: editors change its profile too.
	team := env.draftAgent(t, "Team desk", env.kb.Id.String(), "team")
	if code, raw := env.publish(env.editor, team); code != 201 {
		t.Fatalf("publish to the team = %d %s", code, raw)
	}
	env.editor.get(env.base+"/agents/"+team.Id.String(), &team)
	code, e = env.editor.call("PATCH", env.base+"/agents/"+team.Id.String(), map[string]any{"name": "Team desk (renamed)"}, nil, ifMatch(team.Revision))
	mustCode(t, "editor renames a team agent", code, e, 200, "")
}

// The pickers show health: a chat model or MCP server never tested is
// untested, then its latest stored check (AD-02, BU-07).
func TestChatModelPickerHealth(t *testing.T) {
	env := newAgentEnv(t)
	var models []apitypes.ChatModelOption
	if code := env.editor.get("/v1/chat-models", &models); code != 200 || len(models) == 0 {
		t.Fatalf("chat models = %d %+v", code, models)
	}
	if h := models[0].Health; h.Status != apitypes.PickerHealthStatusUntested || h.Since != nil {
		t.Fatalf("untested model health = %+v", h)
	}
	code, e := env.admin.call("POST", "/v1/admin/models/"+env.chat.Id.String()+"/test", nil, nil, nil)
	mustCode(t, "test the chat model", code, e, 200, "")
	env.editor.get("/v1/chat-models", &models)
	for _, m := range models {
		if m.Id == env.chat.Id && (m.Health.Status != apitypes.PickerHealthStatusHealthy || m.Health.Since == nil) {
			t.Fatalf("tested model health = %+v", m.Health)
		}
	}
	var tools []apitypes.MCPToolOption
	if code := env.editor.get("/v1/mcp-tools", &tools); code != 200 {
		t.Fatalf("mcp tools = %d", code)
	}
}
