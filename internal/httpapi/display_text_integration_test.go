package httpapi_test

import (
	"fmt"
	"testing"
)

func TestDisplayNamesAndFilenamesRejectHiddenCharacters(t *testing.T) {
	env := newAgentEnv(t)
	env.publishAgent(t, "Display safety", env.agentConfig(env.kb.Id.String()))
	var answer struct{ ConversationId string }
	code, e := env.member.call("POST", env.chatPath("display-safety"), map[string]any{"message": "Where do I buy a parking permit?", "stream": false}, &answer, nil)
	mustCode(t, "chat", code, e, 200, "")
	for i, hidden := range []string{"\x1b", "\u202e", "\u200b", "\u200d", "\ufeff", "\u0085", "\u2028", "\u034f", "\t"} {
		name := "Visible" + hidden + "name"
		for _, tc := range []struct {
			label, path string
			who         *session
			body        map[string]any
		}{
			{"team", "/v1/admin/teams", env.admin, map[string]any{"slug": fmt.Sprintf("unsafe-%d", i), "name": name, "maxClassification": "sensitive", "ownerEmail": "user@localhost"}},
			{"agent", env.base + "/agents", env.editor, map[string]any{"name": name}},
			{"kb", env.base + "/kbs", env.owner, map[string]any{"name": name, "topK": 4}},
			{"source", env.base + "/sources", env.owner, map[string]any{"name": name, "classification": "open"}},
			{"key", env.base + "/api-keys", env.owner, map[string]any{"name": name, "scopes": []string{"query"}}},
		} {
			t.Run(fmt.Sprintf("%s/%U", tc.label, []rune(hidden)[0]), func(t *testing.T) {
				code, e := tc.who.call("POST", tc.path, tc.body, nil, nil)
				mustCode(t, "unsafe display name", code, e, 400, "invalid_name")
			})
		}
		t.Run(fmt.Sprintf("title/%U", []rune(hidden)[0]), func(t *testing.T) {
			code, e := env.member.call("PATCH", "/v1/conversations/"+answer.ConversationId, map[string]any{"title": name}, nil, nil)
			mustCode(t, "unsafe title", code, e, 400, "invalid_title")
		})
		t.Run(fmt.Sprintf("filename/%U", []rune(hidden)[0]), func(t *testing.T) {
			code, results, e := env.owner.uploadFiles(env.base+"/sources/"+env.upload.Id.String()+"/documents", []upload{{name + ".txt", []byte("A safe body.")}}, "")
			// ESC is already refused by the MIME parser before a file exists.
			if hidden == "\x1b" {
				mustCode(t, "malformed multipart filename", code, e, 400, "invalid_upload")
				return
			}
			if code != 200 || e != "" || len(results) != 1 || results[0].Status != "rejected" || results[0].Error == nil || results[0].Error.Code != "invalid_filename" {
				t.Fatalf("unsafe filename = %d %s %+v", code, e, results)
			}
		})
	}
}
