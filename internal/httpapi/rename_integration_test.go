package httpapi_test

import (
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// TestRenameKeepsLastActivity (v0.4.2 US-15): renaming a conversation keeps
// its time (its last message's), so it doesn't move to the top of the lists.
func TestRenameKeepsLastActivity(t *testing.T) {
	env := newAgentEnv(t)
	env.publishAgent(t, "Renames", env.agentConfig(env.kb.Id.String()))
	var ans struct {
		ConversationId string `json:"conversationId"`
	}
	code, e := env.member.call("POST", env.chatPath("renames"), map[string]any{"message": "Where do I buy a parking permit?", "stream": false}, &ans, nil)
	mustCode(t, "chat", code, e, 200, "")
	var before, after apitypes.ConversationDetail
	env.member.get("/v1/conversations/"+ans.ConversationId, &before)
	time.Sleep(20 * time.Millisecond)
	code, e = env.member.call("PATCH", "/v1/conversations/"+ans.ConversationId, map[string]any{"title": "Parking"}, nil, nil)
	mustCode(t, "rename", code, e, 200, "")
	env.member.get("/v1/conversations/"+ans.ConversationId, &after)
	if after.Conversation.Title != "Parking" || !after.Conversation.UpdatedAt.Equal(before.Conversation.UpdatedAt) {
		t.Fatalf("after rename: %q at %s, before %s", after.Conversation.Title, after.Conversation.UpdatedAt, before.Conversation.UpdatedAt)
	}
}
