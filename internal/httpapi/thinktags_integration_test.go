package httpapi_test

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The model's reasoning in the answer text (v0.4.2 BU-02): after a tool
// call, Qwen3 with thinking off wrote "draft </think> answer" in content, and
// a public widget showed the tag and the answer twice. The fake gateway's
// second turn (after search_knowledge) answers the same way here: the
// answer appears once, without the tag, streamed or buffered, and stored.
func TestReasoningInTheAnswerTextIsDropped(t *testing.T) {
	env := newPublishEnv(t)
	answer := "Campus email is operating normally [1]."
	env.proxy.SetAnswer(answer + "\n</think>\n\n" + answer)
	t.Cleanup(func() { env.proxy.SetAnswer("") })
	q := "Where do students buy a parking permit?"
	clean := func(step, text string) {
		t.Helper()
		if text != answer {
			t.Fatalf("%s: text = %q", step, text)
		}
	}

	// Signed in, streamed, tool mode: message_end and the stored message.
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["retrievalMode"] = "tool"
	ag := env.publishAgent(t, "Tool helper", cfg)
	code, evs, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": q})
	mustCode(t, "chat", code, e, 200, "")
	if !strings.Contains(strings.Join(evs.names(), ","), "tool_call,retrieval,tool_result") {
		t.Fatalf("events = %v", evs.names())
	}
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	clean("message_end", end.Text)
	var conv struct{ ConversationId *string }
	evs.one(t, "conversation", &conv)
	var detail apitypes.ConversationDetail
	env.member.get("/v1/conversations/"+*conv.ConversationId, &detail)
	clean("stored", detail.Messages[len(detail.Messages)-1].Text)
	if th := evs.text("thinking_delta"); !strings.Contains(th, answer) {
		t.Fatalf("the draft isn't kept as thinking: %q", th)
	}

	// Public, buffered: the one text the visitor gets is the answer.
	env.setPublic(t, true)
	env.publicPolicy(t)
	cfg = env.agentConfig(env.kb.Id.String())
	cfg["retrievalMode"], cfg["audience"] = "tool", "public"
	var pub apitypes.Agent
	code, e = env.editor.call("POST", env.base+"/agents", map[string]any{"name": "Public tool helper", "config": cfg}, &pub, nil)
	mustCode(t, "create public", code, e, 201, "")
	if code, raw := env.publish(env.tadmin, pub); code != 201 {
		t.Fatalf("publish public = %d %s", code, raw)
	}
	v := newVisitor(t, env.app.URL)
	if code, e := v.start(pub.Id, "", ""); code != 201 {
		t.Fatalf("start = %d %s", code, e)
	}
	code, evs, e = v.ask(pub.Id, q)
	mustCode(t, "public chat", code, e, 200, "")
	clean("public text", evs.text("text_delta"))
	evs.one(t, "message_end", &end)
	clean("public message_end", end.Text)
}
