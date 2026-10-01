package httpapi_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/gaps"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// TestGapCaptureFeedbackAndReport: a failed answer keeps its question with
// the search's vector (no extra embedding); Try it keeps nothing; a
// thumbs-down keeps the question, shared when ticked, and a thumbs-up takes
// it back; the topics job groups 3 askers' questions into a topic the
// team's editors see (members get 404), and platform staff see counts.
func TestGapCaptureFeedbackAndReport(t *testing.T) {
	env := newAgentEnv(t)
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["minSimilarity"] = 0.99 // nothing survives: strict agents refuse
	picky := env.publishAgent(t, "Picky", cfg)
	question := "Where do visitors buy a parking permit?"
	embedsBefore := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'embed_tokens'`)
	for _, s := range []*session{env.member, env.editor, env.tadmin} {
		var ans apitypes.ChatAnswer
		code, e := s.call("POST", env.chatPath(picky.Slug), map[string]any{"message": question, "stream": false}, &ans, nil)
		mustCode(t, "chat", code, e, 200, "")
		if !ans.Refused {
			t.Fatalf("answer = %+v, want a refusal", ans)
		}
	}
	if n := env.scalar(t, `SELECT count(*) FROM gap_questions WHERE agent_id = $1 AND embedding IS NOT NULL AND profile_id IS NOT NULL
		AND signals @> ARRAY['refused', 'no_context'] AND NOT shared AND question = $2`, picky.Id, question); n != 3 {
		t.Fatalf("captured questions = %d, want 3", n)
	}
	// One embedding per answer: the search's vector was reused.
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'embed_tokens'`) - embedsBefore; n != 3 {
		t.Errorf("embedding usage events = %d, want 3 (one search each)", n)
	}
	code, _, _ := env.editor.stream(env.base+"/agents/"+picky.Id.String()+"/test", map[string]any{"message": "Is there parking on Sunday?"})
	if code != 200 || env.scalar(t, `SELECT count(*) FROM gap_questions WHERE question = 'Is there parking on Sunday?'`) != 0 {
		t.Fatalf("Try it kept its question (code %d)", code)
	}

	// A thumbs-down on a good answer, shared; then a thumbs-up takes it back.
	helper := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	var good apitypes.ChatAnswer
	env.member.call("POST", env.chatPath(helper.Slug), map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, &good, nil)
	fbPath := "/v1/messages/" + good.MessageId.String() + "/feedback"
	var fb apitypes.FeedbackResult
	code, e := env.member.call("POST", fbPath, map[string]any{"rating": "down", "reason": "missing_sources", "share": true}, &fb, nil)
	mustCode(t, "thumbs-down", code, e, 200, "")
	if !fb.Shared || env.scalar(t, `SELECT count(*) FROM gap_questions WHERE message_id = $1 AND shared AND signals = ARRAY['thumbs_down']
		AND feedback_reason = 'missing_sources'`, good.MessageId) != 1 {
		t.Fatalf("shared thumbs-down = %+v", fb)
	}
	var detail apitypes.ConversationDetail
	env.member.get("/v1/conversations/"+good.ConversationId.String(), &detail)
	if m := detail.Messages[1]; m.FeedbackShared == nil || !*m.FeedbackShared {
		t.Errorf("feedbackShared = %v", m.FeedbackShared)
	}
	code, e = env.member.call("POST", fbPath, map[string]any{"rating": "up", "share": true}, &fb, nil)
	mustCode(t, "thumbs-up", code, e, 200, "")
	if fb.Shared || env.scalar(t, `SELECT count(*) FROM gap_questions WHERE message_id = $1`, good.MessageId) != 0 {
		t.Fatalf("after a thumbs-up = %+v", fb)
	}

	// The topics job groups the 3 askers' questions.
	runner := &gaps.Runner{Pool: env.app.Pool, Catalog: env.app.Svc.Catalog}
	if _, err := runner.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	var list apitypes.GapTopicList
	if code := env.editor.get(env.base+"/gap-topics?agentId="+picky.Id.String(), &list); code != 200 || len(list.Topics) != 1 ||
		list.Topics[0].Askers != 3 || list.MinAskers != 3 {
		t.Fatalf("topics = %d %+v", code, list)
	}
	top := list.Topics[0]
	code, raw := env.editor.raw("GET", env.base+"/gap-topics/"+top.Id.String(), nil, nil)
	if code != 200 || strings.Contains(string(raw), question) {
		t.Fatalf("topic = %d %s (no question was shared)", code, raw)
	}
	code, e = env.member.call("GET", env.base+"/gap-topics", nil, nil, nil)
	mustCode(t, "member list", code, e, 404, "not_found")
	var dismissed apitypes.GapTopic
	code, e = env.editor.call("POST", env.base+"/gap-topics/"+top.Id.String()+"/dismiss", map[string]any{"reason": "Visitors park free."}, &dismissed, nil)
	mustCode(t, "dismiss", code, e, 200, "")
	if dismissed.State != apitypes.GapTopicStateDismissed {
		t.Errorf("state = %s", dismissed.State)
	}
	var counts apitypes.AdminGapCounts
	if code := env.auditor.get("/v1/admin/analytics/gaps", &counts); code != 200 || counts.Questions != 3 || len(counts.Teams) != 1 ||
		counts.Teams[0].Signals["refused"] != 3 {
		t.Fatalf("admin counts = %d %+v", code, counts)
	}
}
