package httpapi_test

import (
	"strings"
	"testing"
)

// U+0000 cannot be stored in a Postgres text column. It used to reach the database and come back as a 500 "internal" from about twenty endpoints
// (QA pass v0.6.0, #109); now every way of sending one is a 400 invalid_text before anything is written or searched.
func TestNULTextIsRefused(t *testing.T) {
	env := newShareEnv(t)
	ag := env.publishAgent(t, "NUL help", env.agentConfig(env.kb.Id.String()))

	// The control: the same chat without a NUL works, so what follows fails because of the NUL and nothing else.
	conv := env.ask(t, env.member, ag.Slug, "", "Where do students buy a parking permit?")

	for _, tc := range []struct {
		name, method, path string
		body               any
	}{
		{"chat message", "POST", env.chatPath(ag.Slug), map[string]any{"message": "a\x00b", "stream": false}},
		{"chat message continuing a conversation", "POST", env.chatPath(ag.Slug), map[string]any{"message": "a\x00b", "conversationId": conv, "stream": false}},
		{"rename a conversation", "PATCH", "/v1/conversations/" + conv, map[string]any{"title": "a\x00b"}},
		{"create a team", "POST", "/v1/admin/teams", map[string]any{"name": "a\x00b", "ownerEmail": "owner@example.org"}},
		{"search conversations", "GET", "/v1/conversations?q=%00", nil},
		{"a team path", "GET", "/v1/teams/%00", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, e := env.member.call(tc.method, tc.path, tc.body, nil, nil)
			if tc.name == "create a team" { // only a platform admin may
				code, e = env.admin.call(tc.method, tc.path, tc.body, nil, nil)
			}
			mustCode(t, tc.name, code, e, 400, "invalid_text")
		})
	}

	// A literal "\u0000" typed as text (an escaped backslash) is just text and is accepted.
	code, e := env.member.call("PATCH", "/v1/conversations/"+conv, map[string]any{"title": `a \u0000 b`}, nil, nil)
	mustCode(t, "the text backslash-u-0-0-0-0", code, e, 200, "")
	if !strings.Contains(env.detail(t, env.member, conv).Conversation.Title, `\u0000`) {
		t.Error("the typed text was changed")
	}
}
