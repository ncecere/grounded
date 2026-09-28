package httpapi_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Strict refusal without a model call, non-strict labelling, and a merge
// across two KBs with different embedding profiles.
func TestAgentGroundingAndMultiKB(t *testing.T) {
	env := newAgentEnv(t)
	var empty apitypes.KnowledgeBase
	env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Empty"}, &empty, nil)

	// Strict: nothing retrieved → the refusal, without calling the model.
	cfg := env.agentConfig(empty.Id.String())
	cfg["refusalMessage"] = "Sorry, I only know the handbook."
	strict := env.publishAgent(t, "Strict", cfg)
	before := len(env.proxy.ChatRequests())
	code, evs, e := env.member.stream(env.chatPath(strict.Slug), map[string]any{"message": "What is the meaning of life?"})
	mustCode(t, "strict chat", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if !end.Refused || !end.NoContext || end.Text != "Sorry, I only know the handbook." || len(end.Citations) != 0 {
		t.Fatalf("strict = %+v", end)
	}
	if len(env.proxy.ChatRequests()) != before {
		t.Fatal("the model was called for a strict refusal")
	}
	if evs.text("text_delta") != end.Text || len(evs.all("message_start")) != 1 {
		t.Errorf("refusal stream = %v", evs.names())
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND refused AND no_context AND input_tokens = 0`, strict.Id); n != 1 {
		t.Errorf("refusal events = %d", n)
	}

	// The model's own refusal (tool mode, nothing found) is detected too.
	cfg["retrievalMode"] = "tool"
	toolStrict := env.publishAgent(t, "Strict tools", cfg)
	code, evs, _ = env.member.stream(env.chatPath(toolStrict.Slug), map[string]any{"message": "Anything?"})
	evs.one(t, "message_end", &end)
	if code != 200 || !end.Refused || !end.NoContext || end.Text != "Sorry, I only know the handbook." {
		t.Fatalf("tool refusal = %+v", end)
	}

	// Not strict: the model answers, told to label general knowledge; no
	// refusal line in the prompt.
	cfg = env.agentConfig(empty.Id.String())
	cfg["strictlyGrounded"], cfg["refusalMessage"] = false, "UNUSED REFUSAL"
	loose := env.publishAgent(t, "Loose", cfg)
	before = len(env.proxy.ChatRequests())
	code, evs, _ = env.member.stream(env.chatPath(loose.Slug), map[string]any{"message": "What is the meaning of life?"})
	evs.one(t, "message_end", &end)
	if code != 200 || end.Refused || !end.NoContext || end.Text == "" {
		t.Fatalf("loose = %+v", end)
	}
	prompts := systemPrompts(env.proxy)[before:]
	if len(prompts) != 1 || strings.Contains(prompts[0], "Refusal message:") || !strings.Contains(prompts[0], "not from the sources") ||
		!strings.Contains(prompts[0], "general knowledge") {
		t.Fatalf("loose prompt = %q", prompts)
	}

	// Two KBs on different embedding profiles, merged with RRF.
	env.proxy.AddEmbeddingModel("bow-32", 32)
	var model apitypes.Model
	code, e = env.admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": env.conn.Id, "key": "bow32", "upstreamModel": "bow-32", "displayName": "BoW 32", "kind": "embedding",
		"maxClassification": "restricted", "dimensions": 32,
	}, &model, nil)
	mustCode(t, "second embedding model", code, e, 201, "")
	var prof apitypes.EmbeddingProfile
	code, e = env.admin.call("POST", "/v1/admin/embedding-profiles", map[string]any{
		"key": "bow-32", "name": "BoW 32", "modelId": model.Id, "chunkSize": 128, "chunkOverlap": 16,
	}, &prof, nil)
	mustCode(t, "second profile", code, e, 201, "")
	var src2 apitypes.DataSource
	code, e = env.owner.call("POST", env.base+"/sources", map[string]any{"name": "Bursar", "classification": "open", "embeddingProfileId": prof.Id}, &src2, nil)
	mustCode(t, "second source", code, e, 201, "")
	docs2 := env.base + "/sources/" + src2.Id.String() + "/documents"
	env.owner.uploadFiles(docs2, []upload{{"tuition.md", []byte("# Tuition\n\nTuition payments and parking permit fees are due before the first day of classes.")}}, "")
	env.owner.waitForDocuments(t, docs2)
	var kb2 apitypes.KnowledgeBase
	code, e = env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Bursar", "embeddingProfileId": prof.Id}, &kb2, nil)
	mustCode(t, "second kb", code, e, 201, "")
	env.owner.call("PUT", env.base+"/kbs/"+kb2.Id.String()+"/sources/"+src2.Id.String(), nil, nil, nil)

	multi := env.publishAgent(t, "Both", env.agentConfig(env.kb.Id.String(), kb2.Id.String()))
	code, evs, _ = env.member.stream(env.chatPath(multi.Slug), map[string]any{"message": "When are tuition and parking permit fees due?"})
	var retr apitypes.ChatEventRetrieval
	evs.one(t, "retrieval", &retr)
	titles := map[string]bool{}
	for i, h := range retr.Hits {
		titles[h.Title] = true
		if h.N != i+1 {
			t.Errorf("hit numbering: %+v", retr.Hits)
		}
	}
	if code != 200 || !titles["Tuition"] || !titles["Parking"] {
		t.Fatalf("multi-KB hits = %+v", retr.Hits)
	}
	// One embedding per profile.
	if n := env.scalar(t, `SELECT count(DISTINCT model_id) FROM usage_events WHERE kind = 'embed_tokens' AND agent_id = $1`, multi.Id); n != 2 {
		t.Errorf("embedding models used = %d", n)
	}

	// minSimilarity drops weak hits: at 0.99 nothing survives, so strict refuses.
	mcfg := env.agentConfig(env.kb.Id.String())
	mcfg["minSimilarity"] = 0.99
	picky := env.publishAgent(t, "Picky", mcfg)
	code, evs, _ = env.member.stream(env.chatPath(picky.Slug), map[string]any{"message": "Where do students buy a parking permit?"})
	evs.one(t, "message_end", &end)
	if code != 200 || !end.Refused || !end.NoContext {
		t.Fatalf("minSimilarity = %+v", end)
	}
}

// Only the owner can read a conversation; delete, export and feedback;
// analytics without content.
func TestConversationPrivacyExportFeedbackAnalytics(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	question := "Where do students buy a parking permit?"
	var ans apitypes.ChatAnswer
	code, e := env.member.call("POST", env.chatPath(ag.Slug), map[string]any{"message": question, "stream": false}, &ans, nil)
	mustCode(t, "chat", code, e, 200, "")
	convPath := "/v1/conversations/" + ans.ConversationId.String()

	// Another member, a team admin, the owner and platform staff all get 404.
	for name, s := range map[string]*session{"editor": env.editor, "team admin": env.tadmin, "team owner": env.owner, "platform admin": env.admin, "auditor": env.auditor} {
		for _, req := range []struct{ method, path string }{
			{"GET", convPath}, {"GET", convPath + "/export"}, {"PATCH", convPath}, {"DELETE", convPath},
		} {
			var body any
			if req.method == "PATCH" {
				body = map[string]string{"title": "x"}
			}
			code, e := s.call(req.method, req.path, body, nil, nil)
			mustCode(t, name+" "+req.method+" "+req.path, code, e, 404, "conversation_not_found")
		}
		code, e := s.call("POST", "/v1/messages/"+ans.MessageId.String()+"/feedback", map[string]string{"rating": "down"}, nil, nil)
		mustCode(t, name+" feedback", code, e, 404, "message_not_found")
		var page apitypes.ConversationPage
		if code := s.get("/v1/conversations", &page); code != 200 || len(page.Items) != 0 {
			t.Errorf("%s lists %d conversations", name, len(page.Items))
		}
		// The team's conversation list exists only under break-glass (ADR-0024).
		if code, _ := s.call("GET", env.base+"/conversations", nil, nil, nil); code != 403 {
			t.Errorf("%s lists the team's conversations: %d", name, code)
		}
	}

	// Rename, export, feedback.
	var c apitypes.Conversation
	code, e = env.member.call("PATCH", convPath, map[string]string{"title": "Parking"}, &c, nil)
	mustCode(t, "rename", code, e, 200, "")
	// Search (title or agent name, case-insensitive; LIKE wildcards are literal) and the activity range.
	for query, want := range map[string]int{
		"?q=park":    1,
		"?q=HELPER":  1,
		"?q=%25":     0,
		"?q=nomatch": 0,
		"?from=" + time.Now().UTC().Format(time.DateOnly):                 1,
		"?to=" + time.Now().UTC().AddDate(0, 0, -2).Format(time.DateOnly): 0,
		"?from=" + time.Now().Add(time.Hour).UTC().Format(time.RFC3339):   0,
	} {
		var page apitypes.ConversationPage
		if code := env.member.get("/v1/conversations"+query, &page); code != 200 || len(page.Items) != want {
			t.Errorf("conversations%s: code %d, %d items, want %d", query, code, len(page.Items), want)
		}
	}
	code, e = env.member.call("GET", "/v1/conversations?from=yesterday", nil, nil, nil)
	mustCode(t, "bad from", code, e, 400, "invalid_from")
	if c.Title != "Parking" {
		t.Errorf("title = %q", c.Title)
	}
	code, raw := env.member.raw("GET", convPath+"/export", nil, nil)
	md := string(raw)
	if code != 200 || !strings.Contains(md, "# Parking") || !strings.Contains(md, question) || !strings.Contains(md, "1. Parking") {
		t.Fatalf("markdown export = %d %s", code, md)
	}
	code, raw = env.member.raw("GET", convPath+"/export?format=json", nil, nil)
	var exp apitypes.ConversationDetail
	if code != 200 || json.Unmarshal(raw, &exp) != nil || len(exp.Messages) != 2 || exp.Messages[1].Citations == nil {
		t.Fatalf("json export = %d %s", code, raw)
	}
	code, e = env.member.call("GET", convPath+"/export?format=pdf", nil, nil, nil)
	mustCode(t, "bad format", code, e, 400, "invalid_format")

	var fb apitypes.FeedbackResult
	code, e = env.member.call("POST", "/v1/messages/"+ans.MessageId.String()+"/feedback", map[string]string{"rating": "down", "reason": "outdated"}, &fb, nil)
	mustCode(t, "feedback", code, e, 200, "")
	code, e = env.member.call("POST", "/v1/messages/"+ans.MessageId.String()+"/feedback", map[string]string{"rating": "meh"}, nil, nil)
	mustCode(t, "bad rating", code, e, 400, "invalid_rating")
	code, e = env.member.call("POST", "/v1/messages/"+ans.UserMessageId.String()+"/feedback", map[string]string{"rating": "up"}, nil, nil)
	mustCode(t, "feedback on a question", code, e, 404, "message_not_found")
	var detail apitypes.ConversationDetail
	env.member.get(convPath, &detail)
	if f := detail.Messages[1].Feedback; f == nil || *f != "down" || detail.Messages[1].FeedbackReason == nil {
		t.Fatalf("stored feedback = %+v", detail.Messages[1])
	}

	// A second, positive answer for the analytics.
	var ans2 apitypes.ChatAnswer
	env.member.call("POST", env.chatPath(ag.Slug), map[string]any{"message": "When do residence halls open?", "stream": false}, &ans2, nil)
	env.member.call("POST", "/v1/messages/"+ans2.MessageId.String()+"/feedback", map[string]string{"rating": "up"}, nil, nil)

	path := env.base + "/agents/" + ag.Id.String() + "/analytics"
	code, e = env.member.call("GET", path, nil, nil, nil)
	mustCode(t, "member analytics", code, e, 403, "forbidden")
	code, raw = env.editor.raw("GET", path, nil, nil)
	var an struct{ Data apitypes.AgentAnalytics }
	if code != 200 || json.Unmarshal(raw, &an) != nil {
		t.Fatalf("analytics = %d %s", code, raw)
	}
	tot := an.Data.Totals
	if tot.Answers != 2 || tot.Conversations != 2 || tot.UniqueUsers != 1 || tot.Up != 1 || tot.Down != 1 ||
		tot.Satisfaction == nil || *tot.Satisfaction != 0.5 || tot.LatencyP50Ms == nil || tot.NoContextRate == nil || *tot.NoContextRate != 0 {
		t.Fatalf("totals = %+v", tot)
	}
	if len(an.Data.Daily) != 30 || an.Data.Daily[29].Answers != 2 || len(an.Data.Models) != 1 || an.Data.Models[0].ModelName != "Chat Tools" ||
		len(an.Data.TopDocuments) != 2 || len(an.Data.FeedbackReasons) != 1 || an.Data.FeedbackReasons[0].Reason != "outdated" {
		t.Fatalf("analytics = %+v", an.Data)
	}
	// No content: neither the question nor the answer appears.
	if strings.Contains(string(raw), "parking permit") || strings.Contains(string(raw), ans.Text) {
		t.Fatal("analytics contain content")
	}
	code, e = env.editor.call("GET", path+"?from=2026-09-10&to=2026-09-01", nil, nil, nil)
	mustCode(t, "bad range", code, e, 400, "invalid_range")

	// Delete: hidden at once.
	code, e = env.member.call("DELETE", convPath, nil, nil, nil)
	mustCode(t, "delete", code, e, 200, "")
	code, e = env.member.call("GET", convPath, nil, nil, nil)
	mustCode(t, "deleted", code, e, 404, "conversation_not_found")
	var page apitypes.ConversationPage
	if env.member.get("/v1/conversations", &page); len(page.Items) != 1 {
		t.Errorf("conversations after delete = %+v", page.Items)
	}
	code, e = env.member.call("POST", env.chatPath(ag.Slug), map[string]any{"message": "More?", "conversationId": ans.ConversationId, "stream": false}, nil, nil)
	mustCode(t, "continue deleted", code, e, 404, "conversation_not_found")
	// The analytics event survives (it holds no content).
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1`, ag.Id); n != 2 {
		t.Errorf("events after delete = %d", n)
	}
}

// Kill switch, team status, policy violations with an audit entry, and the
// access log for Sensitive agents.
func TestAgentKillSwitchPolicyAndAccessLog(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	chat := func(s *session) (int, string) {
		code, _, e := s.stream(env.chatPath(ag.Slug), map[string]any{"message": "Where do students buy a parking permit?"})
		return code, e
	}

	// Platform kill switch: reason required; teams can't clear it.
	statusPath := "/v1/admin/agents/" + ag.Id.String() + "/status"
	code, e := env.admin.call("POST", statusPath, map[string]string{"status": "disabled_by_platform"}, nil, nil)
	mustCode(t, "no reason", code, e, 400, "reason_required")
	code, e = env.auditor.call("POST", statusPath, map[string]string{"status": "disabled_by_platform", "reason": "testing"}, nil, nil)
	mustCode(t, "auditor kills", code, e, 403, "forbidden")
	var aa apitypes.AdminAgent
	code, e = env.admin.call("POST", statusPath, map[string]string{"status": "disabled_by_platform", "reason": "Reported abuse"}, &aa, nil)
	mustCode(t, "kill", code, e, 200, "")
	if aa.Status != "disabled_by_platform" || aa.DisabledReason != "Reported abuse" || aa.PublishedVersion == nil || aa.Classification == nil || *aa.Classification != "open" {
		t.Fatalf("killed = %+v", aa)
	}
	code, e = chat(env.member)
	mustCode(t, "chat killed", code, e, 403, "agent_disabled")
	var card apitypes.AgentCard
	if env.member.get("/v1/agents/"+env.team+"/"+ag.Slug, &card); card.Status != "disabled_by_platform" {
		t.Errorf("profile status = %s", card.Status)
	}
	teamStatus := env.base + "/agents/" + ag.Id.String() + "/status"
	code, e = env.tadmin.call("POST", teamStatus, map[string]string{"status": "active"}, nil, nil)
	mustCode(t, "team clears kill switch", code, e, 403, "agent_disabled_by_platform")
	var list []apitypes.AdminAgent
	if code := env.auditor.get("/v1/admin/agents?status=disabled_by_platform", &list); code != 200 || len(list) != 1 {
		t.Fatalf("admin list = %d %+v", code, list)
	}
	code, e = env.owner.call("GET", "/v1/admin/agents", nil, nil, nil)
	mustCode(t, "team owner lists all agents", code, e, 403, "forbidden")
	env.admin.call("POST", statusPath, map[string]string{"status": "active"}, nil, nil)
	if code, e = chat(env.member); code != 200 {
		t.Fatalf("after re-enable = %d %s", code, e)
	}
	// Team disable (admins only).
	code, e = env.editor.call("POST", teamStatus, map[string]string{"status": "disabled_by_team"}, nil, nil)
	mustCode(t, "editor disables", code, e, 403, "forbidden")
	code, e = env.tadmin.call("POST", teamStatus, map[string]string{"status": "disabled_by_team", "reason": "Updating content"}, nil, nil)
	mustCode(t, "team disables", code, e, 200, "")
	code, e = chat(env.member)
	mustCode(t, "chat disabled", code, e, 403, "agent_disabled")
	env.tadmin.call("POST", teamStatus, map[string]string{"status": "active"}, nil, nil)
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent.status' AND target_id = $1`, ag.Id.String()); n != 4 {
		t.Errorf("status audits = %d", n)
	}

	// Policy: an agent on an Open-only chat model over a platform-shared
	// source. Raising the shared source to Sensitive would break the agent
	// (rule 4), so it is refused at write time with the agent named (rule
	// 6). If policy drifts anyway, every query refuses, audited (rule 8).
	env.proxy.AddChatModel("open-chat")
	var openModel apitypes.Model
	code, e = env.admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": env.conn.Id, "key": "open-chat", "upstreamModel": "open-chat", "displayName": "Open chat",
		"kind": "chat", "maxClassification": "open",
	}, &openModel, nil)
	mustCode(t, "open model", code, e, 201, "")
	var shared apitypes.DataSource
	code, e = env.admin.call("POST", "/v1/admin/shared-sources", map[string]any{"name": "Catalog", "classification": "open"}, &shared, nil)
	mustCode(t, "shared source", code, e, 201, "")
	sharedPath := "/v1/admin/shared-sources/" + shared.Id.String()
	env.admin.uploadFiles(sharedPath+"/documents", []upload{{"catalog.md", []byte("# Catalog\n\nThe undergraduate catalog lists every degree program.")}}, "")
	env.admin.waitForDocuments(t, sharedPath+"/documents")
	var kb apitypes.KnowledgeBase
	env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Catalog"}, &kb, nil)
	code, e = env.owner.call("PUT", env.base+"/kbs/"+kb.Id.String()+"/sources/"+shared.Id.String(), nil, nil, nil)
	mustCode(t, "attach shared", code, e, 200, "")
	cfg := env.agentConfig(kb.Id.String())
	cfg["chatModelId"] = openModel.Id
	catalog := env.publishAgent(t, "Catalog", cfg)
	catalogChat := env.chatPath(catalog.Slug)
	if code, _, e := env.member.stream(catalogChat, map[string]any{"message": "Which degree programs exist?"}); code != 200 {
		t.Fatalf("catalog chat = %d %s", code, e)
	}
	env.admin.get(sharedPath, &shared)
	var preview apitypes.ClassificationImpact
	code, e = env.admin.call("PATCH", sharedPath+"?preview=true", map[string]any{"classification": "sensitive"}, &preview, ifMatch(shared.Revision))
	mustCode(t, "preview raise", code, e, 200, "")
	if len(preview.Agents) != 1 || preview.Agents[0].AgentId != catalog.Id || len(preview.Agents[0].Reasons) != 1 ||
		preview.Agents[0].Reasons[0] != apitypes.ImpactedAgentReasonsModel || preview.Agents[0].ModelMaxClassification != "open" ||
		len(preview.Agents[0].ReasonText) != 1 || !strings.Contains(preview.Agents[0].ReasonText[0], "chat model") {
		t.Fatalf("preview agents = %+v", preview.Agents)
	}
	code, raw := env.admin.raw("PATCH", sharedPath, map[string]any{"classification": "sensitive"}, ifMatch(shared.Revision))
	var impact struct {
		Error struct {
			Code    string                        `json:"code"`
			Message string                        `json:"message"`
			Details apitypes.ClassificationImpact `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &impact); err != nil || code != 409 || impact.Error.Code != "classification_impact" ||
		len(impact.Error.Details.Agents) != 1 || impact.Error.Details.Agents[0].AgentName != "Catalog" {
		t.Fatalf("raise shared source = %d %s", code, raw)
	}
	// F-19: the message names only the reason that applies (the model here).
	if !strings.Contains(impact.Error.Message, "chat model isn't approved") || strings.Contains(impact.Error.Message, "audience") {
		t.Errorf("message = %q", impact.Error.Message)
	}
	// Attaching a Sensitive team source to the agent's KB raises the KB:
	// refused the same way.
	var sens apitypes.DataSource
	code, e = env.owner.call("POST", env.base+"/sources", map[string]any{"name": "Advising notes", "classification": "sensitive"}, &sens, nil)
	mustCode(t, "sensitive source", code, e, 201, "")
	code, raw = env.owner.raw("PUT", env.base+"/kbs/"+kb.Id.String()+"/sources/"+sens.Id.String(), nil, nil)
	if err := json.Unmarshal(raw, &impact); err != nil || code != 409 || impact.Error.Code != "classification_impact" ||
		len(impact.Error.Details.Agents) != 1 || impact.Error.Details.Classification != "sensitive" {
		t.Fatalf("attach sensitive source = %d %s", code, raw)
	}
	// Policy drift that bypasses the write-time checks (e.g. a direct data
	// fix) is still caught on every query.
	if n := env.scalar(t, `WITH u AS (UPDATE data_sources SET classification = 'sensitive' WHERE id = $1 RETURNING 1) SELECT count(*) FROM u`, shared.Id.String()); n != 1 {
		t.Fatalf("drift update = %d", n)
	}
	code, raw = env.member.raw("POST", catalogChat, map[string]any{"message": "Which degree programs exist?"}, nil)
	if pb := decodeProblems(t, raw); code != 409 || pb.Error.Code != "agent_policy_violation" || pb.Error.Details.Rule != "model_ceiling" {
		t.Fatalf("policy violation = %d %s", code, raw)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent.policy_violation' AND target_id = $1 AND metadata->'rules' ? 'model_ceiling'`, catalog.Id.String()); n != 1 {
		t.Errorf("policy audits = %d", n)
	}
	var got apitypes.Agent
	env.editor.get(env.base+"/agents/"+catalog.Id.String(), &got)
	if !hasField(got.Warnings, "published") || !hasField(got.Warnings, "draft.chatModelId") {
		t.Errorf("warnings = %+v", got.Warnings)
	}
	// Republishing with an approved model fixes it; the version is Sensitive
	// and each use lands in the access log.
	cfg["chatModelId"] = env.chat.Id
	code, e = env.editor.call("PATCH", env.base+"/agents/"+catalog.Id.String(), map[string]any{"config": cfg}, nil, ifMatch(got.Revision))
	mustCode(t, "switch model", code, e, 200, "")
	var v2 apitypes.AgentVersion
	code, e = env.editor.call("POST", env.base+"/agents/"+catalog.Id.String()+"/publish", nil, &v2, nil)
	mustCode(t, "republish", code, e, 201, "")
	if v2.Version != 2 || v2.EffectiveRank != 1 || v2.Classification != "sensitive" {
		t.Fatalf("v2 = %+v", v2)
	}
	if code, _, e := env.member.stream(catalogChat, map[string]any{"message": "Which degree programs exist?"}); code != 200 {
		t.Fatalf("sensitive chat = %d %s", code, e)
	}
	var logPage apitypes.AccessLogPage
	if code := env.auditor.get("/v1/admin/access-log?agentId="+catalog.Id.String(), &logPage); code != 200 || len(logPage.Items) != 1 {
		t.Fatalf("access log = %d %+v", code, logPage)
	}
	entry := logPage.Items[0]
	if entry.UserEmail != "blair@localhost" || entry.Rank != 1 || entry.Classification != "sensitive" || entry.Channel != "ui" ||
		entry.AgentVersion == nil || *entry.AgentVersion != 2 || entry.TeamSlug != env.team {
		t.Fatalf("access log entry = %+v", entry)
	}
	if code := env.admin.get("/v1/admin/access-log?userId="+env.member.me.User.Id.String()+"&from="+time.Now().UTC().Format(time.DateOnly), &logPage); code != 200 || len(logPage.Items) != 1 {
		t.Fatalf("access log by user = %d %+v", code, logPage)
	}
	if code := env.admin.get("/v1/admin/access-log?channel=widget&agentId="+catalog.Id.String(), &logPage); code != 200 || len(logPage.Items) != 0 {
		t.Fatalf("access log by channel = %d %+v", code, logPage)
	}
	if code := env.admin.get("/v1/admin/access-log?channel=ui&agentId="+catalog.Id.String(), &logPage); code != 200 || len(logPage.Items) != 1 {
		t.Fatalf("access log by channel ui = %d %+v", code, logPage)
	}
	code, e = env.admin.call("GET", "/v1/admin/access-log?channel=email", nil, nil, nil)
	mustCode(t, "bad channel", code, e, 400, "invalid_channel")
	code, e = env.owner.call("GET", "/v1/admin/access-log", nil, nil, nil)
	mustCode(t, "team owner reads access log", code, e, 403, "forbidden")
}

// kb_in_use: published agents block KB deletion; drafts drop the KB.
func TestKBInUse(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	code, raw := env.owner.raw("DELETE", env.base+"/kbs/"+env.kb.Id.String(), nil, nil)
	pb := decodeProblems(t, raw)
	if code != 409 || pb.Error.Code != "kb_in_use" || len(pb.Error.Details.Agents) != 1 || pb.Error.Details.Agents[0].Name != "Helper" {
		t.Fatalf("delete used kb = %d %s", code, raw)
	}
	// Another KB referenced by a draft only, and by an older version.
	var other apitypes.KnowledgeBase
	env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Other"}, &other, nil)
	path := env.base + "/agents/" + ag.Id.String()
	var cur apitypes.Agent
	env.editor.get(path, &cur)
	code, e := env.editor.call("PATCH", path, map[string]any{"config": env.agentConfig(other.Id.String())}, &cur, ifMatch(cur.Revision))
	mustCode(t, "draft with other", code, e, 200, "")
	code, e = env.editor.call("POST", path+"/publish", nil, nil, nil)
	mustCode(t, "publish v2", code, e, 201, "")
	// v2 uses Other; v1 (not served) still references Student help.
	code, e = env.owner.call("DELETE", env.base+"/kbs/"+env.kb.Id.String(), nil, nil, nil)
	mustCode(t, "delete kb of an old version", code, e, 200, "")
	code, e = env.editor.call("PATCH", path, map[string]any{"config": env.agentConfig(env.kb.Id.String())}, nil, ifMatch(cur.Revision+1))
	mustCode(t, "draft with deleted kb", code, e, 200, "")
	// Now Other is served by v2 and also in the draft: blocked.
	code, e = env.owner.call("DELETE", env.base+"/kbs/"+other.Id.String(), nil, nil, nil)
	mustCode(t, "delete served kb", code, e, 409, "kb_in_use")
	var v1 apitypes.AgentVersion
	if code := env.editor.get(path+"/versions/1", &v1); code != 200 || v1.KnowledgeBases[0].Name != "" {
		t.Fatalf("old version after KB delete = %d %+v", code, v1)
	}
	// A draft that only references a KB loses it silently, with a warning.
	var third apitypes.KnowledgeBase
	env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Third"}, &third, nil)
	env.editor.get(path, &cur)
	env.editor.call("PATCH", path, map[string]any{"config": env.agentConfig(third.Id.String())}, &cur, ifMatch(cur.Revision))
	code, e = env.owner.call("DELETE", env.base+"/kbs/"+third.Id.String(), nil, nil, nil)
	mustCode(t, "delete draft-only kb", code, e, 200, "")
	env.editor.get(path, &cur)
	if len(cur.Draft.Kbs) != 0 || !hasField(cur.Warnings, "draft.kbs") {
		t.Fatalf("draft after KB delete = %+v %+v", cur.Draft.Kbs, cur.Warnings)
	}
}

// API keys: query scope; KB-restricted keys; personal keys persist as the
// user; service keys are stateless.
func TestAgentChatWithAPIKeys(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	path := env.chatPath(ag.Slug)
	newKey := func(s *session, body map[string]any) string {
		var k apitypes.APIKeyCreated
		code, e := s.call("POST", env.base+"/api-keys", body, &k, nil)
		mustCode(t, "key", code, e, 201, "")
		return k.Secret
	}
	service := newKey(env.owner, map[string]any{"name": "bot", "kind": "service", "scopes": []string{"query"}})
	personal := newKey(env.member, map[string]any{"name": "mine", "scopes": []string{"query"}})
	ingest := newKey(env.owner, map[string]any{"name": "loader", "kind": "service", "scopes": []string{"ingest"}})
	var other apitypes.KnowledgeBase
	env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Other"}, &other, nil)
	restricted := newKey(env.owner, map[string]any{"name": "narrow", "kind": "service", "scopes": []string{"query"}, "knowledgeBaseIds": []string{other.Id.String()}})
	covering := newKey(env.owner, map[string]any{"name": "wide", "kind": "service", "scopes": []string{"query"}, "knowledgeBaseIds": []string{env.kb.Id.String(), other.Id.String()}})

	// Service key: stateless, history allowed, conversationId rejected.
	var ans apitypes.ChatAnswer
	code, e := keyCall(t, env.app.URL, "POST", path, service, map[string]any{"message": "And the housing?", "stream": false,
		"history": []map[string]string{{"role": "user", "content": "Where do I park?"}, {"role": "assistant", "content": "Get a permit."}}}, &ans)
	mustCode(t, "service chat", code, e, 200, "")
	if ans.Persisted || ans.ConversationId != nil || ans.Text == "" {
		t.Fatalf("service answer = %+v", ans)
	}
	var body struct {
		Messages []struct{ Role, Content string }
	}
	reqs := env.proxy.ChatRequests()
	_ = json.Unmarshal(reqs[len(reqs)-1], &body)
	if len(body.Messages) != 4 || body.Messages[1].Content != "Where do I park?" {
		t.Fatalf("history not sent: %+v", body.Messages)
	}
	code, e = keyCall(t, env.app.URL, "POST", path, service, map[string]any{"message": "x", "stream": false, "conversationId": ans.MessageId}, nil)
	mustCode(t, "service conversationId", code, e, 400, "conversation_not_allowed")
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE channel = 'api' AND pseudonymous_user IS NULL AND message_id IS NULL`); n != 1 {
		t.Errorf("service events = %d", n)
	}
	// SSE works with keys too.
	code, evs, e := keyStream(t, env.app.URL, path, service, map[string]any{"message": "Where do students buy a parking permit?"})
	mustCode(t, "service stream", code, e, 200, "")
	if len(evs.all("message_end")) != 1 {
		t.Fatalf("events = %v", evs.names())
	}

	// Personal key: persisted as the member, listed in their session.
	code, e = keyCall(t, env.app.URL, "POST", path, personal, map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, &ans)
	mustCode(t, "personal chat", code, e, 200, "")
	if !ans.Persisted || ans.ConversationId == nil {
		t.Fatalf("personal answer = %+v", ans)
	}
	var page apitypes.ConversationPage
	if env.member.get("/v1/conversations", &page); len(page.Items) != 1 || page.Items[0].Id != *ans.ConversationId {
		t.Fatalf("member conversations = %+v", page.Items)
	}
	code, e = keyCall(t, env.app.URL, "POST", path, personal, map[string]any{"message": "And housing?", "stream": false, "conversationId": ans.ConversationId}, &ans)
	mustCode(t, "personal continue", code, e, 200, "")
	code, e = keyCall(t, env.app.URL, "POST", path, personal, map[string]any{"message": "x", "stream": false,
		"history": []map[string]string{{"role": "user", "content": "y"}}}, nil)
	mustCode(t, "personal history", code, e, 400, "history_not_allowed")
	// The personal key can read its user's conversation; the service key can't.
	code, e = keyCall(t, env.app.URL, "GET", "/v1/conversations/"+ans.ConversationId.String(), personal, nil, nil)
	mustCode(t, "personal reads", code, e, 200, "")
	code, e = keyCall(t, env.app.URL, "GET", "/v1/conversations/"+ans.ConversationId.String(), service, nil, nil)
	mustCode(t, "service reads", code, e, 404, "conversation_not_found")

	// Scopes and KB restrictions.
	code, e = keyCall(t, env.app.URL, "POST", path, ingest, map[string]any{"message": "x", "stream": false}, nil)
	mustCode(t, "ingest key chats", code, e, 403, "forbidden")
	code, e = keyCall(t, env.app.URL, "POST", path, restricted, map[string]any{"message": "x", "stream": false}, nil)
	mustCode(t, "restricted key", code, e, 404, "agent_not_found")
	var dir []apitypes.AgentCard
	keyCall(t, env.app.URL, "GET", "/v1/agents", restricted, nil, &dir)
	if len(dir) != 0 {
		t.Errorf("restricted directory = %+v", dir)
	}
	code, e = keyCall(t, env.app.URL, "POST", path, covering, map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, nil)
	mustCode(t, "covering key", code, e, 200, "")
	// Keys never manage agents.
	code, e = keyCall(t, env.app.URL, "POST", env.base+"/agents", service, map[string]any{"name": "x"}, nil)
	mustCode(t, "key creates agent", code, e, 401, "")
}

// Rate limits, the daily chat token quota and concurrent chats.
func TestChatLimits(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	path := env.chatPath(ag.Slug)
	askAs := func(s *session) (int, []byte) {
		return s.raw("POST", path, map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, nil)
	}
	ask := func() (int, []byte) { return askAs(env.member) }

	setTeamLimits(t, env.admin, env.team, map[string]any{"chat_tokens_per_day": 10})
	if code, raw := ask(); code != 200 {
		t.Fatalf("first chat = %d %s", code, raw)
	}
	code, raw := ask()
	le := decodeLimitError(t, raw)
	if code != 429 || le.Error.Code != "quota_exceeded" || le.Error.Details.Limit != "chat_tokens_per_day" || le.Error.Details.Current <= 10 {
		t.Fatalf("over quota = %d %s", code, raw)
	}
	lim := teamLimit(t, env.owner, env.team, "chat_tokens_per_day")
	if lim.Used == nil || *lim.Used <= 10 {
		t.Errorf("chat tokens used = %+v", lim)
	}

	// Per person per minute (the owner has not asked anything yet).
	setTeamLimits(t, env.admin, env.team, map[string]any{"chat_tokens_per_day": nil, "user_queries_per_minute": 1})
	avoidMinuteBoundary()
	if code, raw := askAs(env.owner); code != 200 {
		t.Fatalf("first in minute = %d %s", code, raw)
	}
	code, raw = askAs(env.owner)
	if le := decodeLimitError(t, raw); code != 429 || le.Error.Code != "rate_limited" || le.Error.Details.Limit != "user_queries_per_minute" {
		t.Fatalf("rate limited = %d %s", code, raw)
	}

	// Chat counts as a query for the daily team limit.
	setTeamLimits(t, env.admin, env.team, map[string]any{"user_queries_per_minute": nil, "queries_per_day": env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'query'`)})
	code, raw = ask()
	if le := decodeLimitError(t, raw); code != 429 || le.Error.Details.Limit != "queries_per_day" {
		t.Fatalf("daily queries = %d %s", code, raw)
	}

	// Concurrent chats: one slot; a slow stream holds it.
	setTeamLimits(t, env.admin, env.team, map[string]any{"queries_per_day": nil, "concurrent_chats_per_user": 1})
	env.proxy.SetChunkDelay(100 * time.Millisecond)
	defer env.proxy.SetChunkDelay(0)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	go func() {
		req, _ := http.NewRequestWithContext(ctx, "POST", env.app.URL+path, strings.NewReader(`{"message":"Where do students buy a parking permit?"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", env.app.URL)
		req.Header.Set("X-CSRF-Token", env.member.csrf)
		res, err := env.member.client.Do(req)
		if err == nil {
			close(started)
			_, _ = io.Copy(io.Discard, res.Body)
			res.Body.Close()
		}
	}()
	<-started
	code, raw = ask()
	if le := decodeLimitError(t, raw); code != 429 || le.Error.Details.Limit != "concurrent_chats_per_user" {
		t.Fatalf("concurrent = %d %s", code, raw)
	}
}

// Closing the connection stops the answer and saves the partial text.
func TestChatAbortSavesPartialAnswer(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	env.proxy.SetChunkDelay(150 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "POST", env.app.URL+env.chatPath(ag.Slug), strings.NewReader(`{"message":"Where do students buy a parking permit?"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", env.app.URL)
	req.Header.Set("X-CSRF-Token", env.member.csrf)
	res, err := env.member.client.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("chat = %v %v", res, err)
	}
	// Read until the first text delta, then hang up.
	buf := make([]byte, 4096)
	var got strings.Builder
	for !strings.Contains(got.String(), "event: text_delta") {
		n, err := res.Body.Read(buf)
		if err != nil {
			t.Fatalf("stream ended early: %v %s", err, got.String())
		}
		got.Write(buf[:n])
	}
	cancel()
	res.Body.Close()

	var stop, text string
	eventually(t, "the aborted answer", func() bool {
		err := env.app.Pool.QueryRow(context.Background(),
			`SELECT stop_reason, coalesce((SELECT b->>'text' FROM jsonb_array_elements(content) b WHERE b->>'type' = 'text'), '')
			 FROM messages WHERE role = 'assistant'`).Scan(&stop, &text)
		return err == nil
	})
	if stop != "aborted" || text == "" || strings.HasSuffix(text, "[1]") {
		t.Fatalf("stored = %s %q", stop, text)
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE stop_reason = 'aborted' AND message_id IS NOT NULL`); n != 1 {
		t.Errorf("aborted events = %d", n)
	}
	// The slot is released: another chat works.
	env.proxy.SetChunkDelay(0)
	if code, _, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Housing?"}); code != 200 {
		t.Fatalf("after abort = %d %s", code, e)
	}
}

// Team members pick agent models from /v1/chat-models: enabled chat models
// on enabled connections only, with no connection details.
func TestUsableChatModels(t *testing.T) {
	env := newAgentEnv(t)
	var list []apitypes.ChatModelOption
	if code := env.member.get("/v1/chat-models", &list); code != 200 {
		t.Fatalf("chat models = %d", code)
	}
	if len(list) != 1 || list[0].Id != env.chat.Id || !list[0].SupportsTools || list[0].MaxClassification != "sensitive" {
		t.Fatalf("chat models = %+v", list)
	}
	code, e := env.admin.call("PATCH", "/v1/admin/models/"+env.chat.Id.String(), map[string]any{"enabled": false}, nil, ifMatch(env.chat.Revision))
	mustCode(t, "disable model", code, e, 200, "")
	if code := env.member.get("/v1/chat-models", &list); code != 200 || len(list) != 0 {
		t.Fatalf("after disable = %d %+v", code, list)
	}
}

// A gateway refusing because of load (429, or 503 with Retry-After) is
// "busy", not an outage; other failures stay model_unavailable. Both keep
// the question in the conversation.
func TestChatModelBusyVersusUnavailable(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	for _, tc := range []struct {
		status int
		code   string
	}{{http.StatusTooManyRequests, "model_busy"}, {http.StatusInternalServerError, "model_unavailable"}} {
		env.proxy.FailChatWith(tc.status)
		code, raw := env.member.raw("POST", env.chatPath(ag.Slug), map[string]any{"message": "Where do students buy a parking permit?"}, nil)
		var body struct {
			Error struct {
				Code    string         `json:"code"`
				Details map[string]any `json:"details"`
			} `json:"error"`
		}
		if err := json.Unmarshal(raw, &body); err != nil || code != 503 || body.Error.Code != tc.code || body.Error.Details["conversationId"] == nil {
			t.Fatalf("gateway %d: chat = %d %s", tc.status, code, raw)
		}
	}
	env.proxy.FailChatWith(0)
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE error_code IN ('model_busy', 'model_unavailable')`); n != 2 {
		t.Errorf("failed answers recorded = %d", n)
	}
}
