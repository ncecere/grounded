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
	// The Audience filter (aud-10): the questions were answers to the team, none to the public.
	var public apitypes.AdminGapCounts
	if code := env.auditor.get("/v1/admin/analytics/gaps?audience=public", &public); code != 200 || public.Questions != 0 {
		t.Fatalf("public counts = %d %+v", code, public)
	}
	var audience string
	env.app.Pool.QueryRow(context.Background(), `SELECT audience_type FROM message_events WHERE agent_id = $1 LIMIT 1`, picky.Id).Scan(&audience)
	if code := env.auditor.get("/v1/admin/analytics/gaps?audience="+audience, &public); code != 200 || public.Questions != 3 {
		t.Fatalf("%s counts = %d %+v", audience, code, public)
	}
}

// TestGapTextNeverReachesPlatformStaff (aud-1, aud-2, adm-2 of the v0.4.0
// walkthrough): adding a shared question to evaluations and dismissing a
// topic with a reason leave neither text in anything platform staff read:
// the platform and team audit logs (the CSV export is built from them),
// search, notifications. The team's editors still see both on the topic.
func TestGapTextNeverReachesPlatformStaff(t *testing.T) {
	env := newAgentEnv(t)
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["minSimilarity"] = 0.99
	picky := env.publishAgent(t, "Picky", cfg)
	const question, reason = "Where do visitors buy a parking permit?", "Visitors park free at the stadium lot."
	var shared apitypes.ChatAnswer
	for i, s := range []*session{env.member, env.editor, env.tadmin} {
		var ans apitypes.ChatAnswer
		code, e := s.call("POST", env.chatPath(picky.Slug), map[string]any{"message": question, "stream": false}, &ans, nil)
		mustCode(t, "chat", code, e, 200, "")
		if i == 0 {
			shared = ans
		}
	}
	code, e := env.member.call("POST", "/v1/messages/"+shared.MessageId.String()+"/feedback",
		map[string]any{"rating": "down", "reason": "missing_sources", "share": true}, nil, nil)
	mustCode(t, "share", code, e, 200, "")
	runner := &gaps.Runner{Pool: env.app.Pool, Catalog: env.app.Svc.Catalog}
	if _, err := runner.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	var list apitypes.GapTopicList
	env.editor.get(env.base+"/gap-topics?agentId="+picky.Id.String(), &list)
	if len(list.Topics) != 1 {
		t.Fatalf("topics = %+v", list)
	}
	top := list.Topics[0].Id.String()
	var detail apitypes.GapTopicDetail
	env.editor.get(env.base+"/gap-topics/"+top, &detail)
	if len(detail.SharedQuestions) != 1 || detail.SharedQuestions[0].Question != question {
		t.Fatalf("shared questions = %+v", detail.SharedQuestions)
	}
	set := env.newEvalSet(t, map[string]any{"agentId": picky.Id, "name": "Picky answers"})
	var added apitypes.GapEvaluationAdded
	code, e = env.editor.call("POST", env.base+"/gap-topics/"+top+"/evaluations", map[string]any{"setId": set.Id,
		"sharedQuestionId": detail.SharedQuestions[0].Id, "expected": map[string]any{"filenames": []string{"parking.md"}}}, &added, nil)
	mustCode(t, "add to evaluations", code, e, 201, "")
	code, e = env.editor.call("POST", env.base+"/gap-topics/"+top+"/dismiss", map[string]any{"reason": reason, "kind": "not_for_agent"}, nil, nil)
	mustCode(t, "dismiss", code, e, 200, "")

	// The team's editors see the reason and who gave it in the topic's history.
	env.editor.get(env.base+"/gap-topics/"+top, &detail)
	if len(detail.History) != 1 || detail.History[0].Reason != reason || detail.History[0].By == nil ||
		detail.Topic.DismissKind == nil || *detail.Topic.DismissKind != apitypes.NotForAgent {
		t.Fatalf("history = %+v, topic %+v", detail.History, detail.Topic)
	}
	leaks := func(what string, raw []byte) {
		t.Helper()
		for _, text := range []string{"parking permit", "stadium lot"} {
			if strings.Contains(strings.ToLower(string(raw)), text) {
				t.Errorf("%s carries %q: %s", what, text, raw)
			}
		}
	}
	for _, s := range []*session{env.admin, env.auditor} {
		code, raw := s.raw("GET", "/v1/admin/audit?limit=200", nil, nil)
		if code != 200 || !strings.Contains(string(raw), "fromSharedQuestion") || !strings.Contains(string(raw), `"hasReason":true`) {
			t.Fatalf("platform audit log = %d %s", code, raw)
		}
		leaks("the platform audit log", raw)
		code, raw = s.raw("GET", "/v1/search?q=parking", nil, nil)
		if code == 200 {
			leaks("search", raw)
		}
	}
	code, raw := env.admin.raw("GET", env.base+"/audit?limit=200", nil, nil)
	if code != 200 {
		t.Fatalf("team audit log as a platform admin = %d", code)
	}
	leaks("the team audit log", raw)
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE concat(before_state::text, after_state::text, metadata::text)
		ILIKE ANY (ARRAY['%parking permit%', '%stadium lot%'])`); n != 0 {
		t.Errorf("%d audit entries carry the question or the reason", n)
	}
	if n := env.scalar(t, `SELECT (SELECT count(*) FROM notifications n WHERE n::text ILIKE ANY (ARRAY['%parking permit%', '%stadium lot%']))
		+ (SELECT count(*) FROM notification_events n WHERE n::text ILIKE ANY (ARRAY['%parking permit%', '%stadium lot%']))`); n != 0 {
		t.Errorf("%d notifications carry the question or the reason", n)
	}
}
