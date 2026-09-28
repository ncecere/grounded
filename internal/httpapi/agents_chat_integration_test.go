package httpapi_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

type problemBody struct {
	Error struct {
		Code    string
		Details struct {
			Problems []apitypes.AgentProblem
			Agents   []struct{ Name string }
			Rule     string
		}
	}
}

func decodeProblems(t *testing.T, raw []byte) problemBody {
	t.Helper()
	var b problemBody
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return b
}

func hasField(ps []apitypes.AgentProblem, field string) bool {
	for _, p := range ps {
		if p.Field == field {
			return true
		}
	}
	return false
}

// create → publish validation errors → publish → chat (always mode) with
// citations; conversations continue with query rewrite; stream=false;
// analytics rows carry no content.
func TestAgentLifecycleAndChat(t *testing.T) {
	env := newAgentEnv(t)
	editor, member := env.editor, env.member
	agents := env.base + "/agents"

	// Members can't create; editors can, with an incomplete draft.
	code, e := member.call("POST", agents, map[string]any{"name": "Nope"}, nil, nil)
	mustCode(t, "member creates", code, e, 403, "forbidden")
	var ag apitypes.Agent
	code, e = editor.call("POST", agents, map[string]any{"name": "Student Help!", "accentColor": "#0021A5"}, &ag, nil)
	mustCode(t, "create", code, e, 201, "")
	if ag.Slug != "student-help" || ag.AccentColor != "#0021a5" || ag.Published != nil || !ag.HasUnpublishedChanges ||
		ag.Draft.RetrievalMode != "always" || !ag.Draft.StrictlyGrounded || ag.Draft.CitationMode != "snippet_link" || ag.Audience != "team" {
		t.Fatalf("created = %+v", ag)
	}
	if !hasField(ag.Warnings, "draft.kbs") || !hasField(ag.Warnings, "draft.chatModelId") {
		t.Errorf("warnings = %+v", ag.Warnings)
	}
	code, e = editor.call("POST", agents, map[string]any{"name": "Bright", "accentColor": "#ffdd00"}, nil, nil)
	mustCode(t, "low contrast accent", code, e, 400, "insufficient_contrast")
	code, e = editor.call("POST", agents, map[string]any{"name": "Dup", "slug": "student-help"}, nil, nil)
	mustCode(t, "duplicate slug", code, e, 409, "slug_taken")
	path := agents + "/" + ag.Id.String()

	// Publishing an incomplete draft lists every problem.
	code, raw := editor.raw("POST", path+"/publish", map[string]any{}, nil)
	pb := decodeProblems(t, raw)
	if code != 422 || pb.Error.Code != "agent_invalid" || !hasField(pb.Error.Details.Problems, "kbs") || !hasField(pb.Error.Details.Problems, "chatModelId") {
		t.Fatalf("publish incomplete = %d %s", code, raw)
	}
	// Lenient draft saves still check types and ranges.
	code, raw = editor.raw("PATCH", path, map[string]any{"config": map[string]any{"kbs": []map[string]any{{"kbId": env.kb.Id, "topK": 50}}, "maxTurns": 9}}, ifMatch(ag.Revision))
	pb = decodeProblems(t, raw)
	if code != 400 || pb.Error.Code != "invalid_config" || !hasField(pb.Error.Details.Problems, "kbs[0].topK") || !hasField(pb.Error.Details.Problems, "maxTurns") {
		t.Fatalf("invalid draft = %d %s", code, raw)
	}
	code, e = editor.call("PATCH", path, map[string]any{"config": map[string]any{"bogus": true}}, nil, ifMatch(ag.Revision))
	mustCode(t, "unknown config field", code, e, 400, "invalid_config")
	// A tool-mode draft with a model that has no tools can't be published.
	var noTools apitypes.Model
	env.proxy.AddChatModel("plain-chat")
	code, e = env.admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": env.conn.Id, "key": "plain", "upstreamModel": "plain-chat", "displayName": "Plain", "kind": "chat",
		"maxClassification": "sensitive", "supportsTools": false,
	}, &noTools, nil)
	mustCode(t, "no-tools model", code, e, 201, "")
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["chatModelId"], cfg["retrievalMode"] = noTools.Id, "tool"
	code, e = editor.call("PATCH", path, map[string]any{"config": cfg}, &ag, ifMatch(ag.Revision))
	mustCode(t, "save tool draft", code, e, 200, "")
	code, raw = editor.raw("POST", path+"/publish", nil, nil)
	if pb = decodeProblems(t, raw); code != 422 || !hasField(pb.Error.Details.Problems, "retrievalMode") {
		t.Fatalf("publish tool mode without tools = %d %s", code, raw)
	}

	// A complete draft publishes version 1.
	code, e = editor.call("PATCH", path, map[string]any{"config": env.agentConfig(env.kb.Id.String()),
		"welcomeMessage": "Hi!", "starterQuestions": []string{"Where do I park?", " "}}, &ag, ifMatch(ag.Revision))
	mustCode(t, "save draft", code, e, 200, "")
	if len(ag.StarterQuestions) != 1 || len(ag.Warnings) != 0 || ag.DraftRevision < 3 {
		t.Fatalf("saved = %+v", ag)
	}
	code, e = editor.call("PATCH", path, map[string]any{"name": "Stale"}, nil, ifMatch(ag.Revision-1))
	mustCode(t, "stale revision", code, e, 412, "revision_conflict")
	var v1 apitypes.AgentVersion
	code, e = editor.call("POST", path+"/publish", map[string]any{"note": "launch"}, &v1, nil)
	mustCode(t, "publish", code, e, 201, "")
	if v1.Version != 1 || v1.EffectiveRank != 0 || v1.Classification != "open" || v1.ChatModelId != env.chat.Id ||
		len(v1.KnowledgeBases) != 1 || v1.KnowledgeBases[0].Name != "Student help" || v1.Note != "launch" || v1.PublishedByName == "" {
		t.Fatalf("version = %+v", v1)
	}
	editor.get(path, &ag)
	if ag.Published == nil || ag.Published.Version != 1 || ag.HasUnpublishedChanges {
		t.Fatalf("after publish = %+v", ag)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent.publish' AND target_id = $1`, ag.Id.String()); n != 1 {
		t.Errorf("publish audits = %d", n)
	}
	// Versions are immutable in the database too.
	if _, err := env.app.Pool.Exec(context.Background(), `UPDATE agent_versions SET note = 'x' WHERE id = $1`, v1.Id); err == nil {
		t.Error("agent_versions row was updated")
	}

	// The directory and profile show the published agent to members.
	var dir []apitypes.AgentCard
	if code := member.get("/v1/agents", &dir); code != 200 || len(dir) != 1 || dir[0].Slug != "student-help" || dir[0].WelcomeMessage != "Hi!" {
		t.Fatalf("directory = %d %+v", code, dir)
	}
	var card apitypes.AgentCard
	if code := member.get("/v1/agents/"+env.team+"/student-help", &card); code != 200 || card.Id != ag.Id || card.CitationMode != "snippet_link" {
		t.Fatalf("profile = %d %+v", code, card)
	}
	if code := member.get("/v1/agents/id/"+ag.Id.String(), &card); code != 200 || card.Slug != "student-help" {
		t.Fatalf("profile by id = %d", code)
	}

	// Chat (always mode) over SSE.
	requestsBefore := len(env.proxy.ChatRequests())
	code, evs, e := member.stream(env.chatPath("student-help"), map[string]any{"message": "Where do students buy a parking permit?"})
	mustCode(t, "chat", code, e, 200, "")
	names := evs.names()
	want := []string{"conversation", "retrieval", "message_start"}
	for i, n := range want {
		if i >= len(names) || names[i] != n {
			t.Fatalf("event order = %v", names)
		}
	}
	if names[len(names)-1] != "done" || names[len(names)-2] != "message_end" {
		t.Fatalf("event order = %v", names)
	}
	if evs.text("thinking_delta") == "" {
		t.Error("no thinking deltas")
	}
	var conv struct {
		ConversationId *string
		UserMessageId  *string
		AgentVersion   *int32
	}
	evs.one(t, "conversation", &conv)
	if conv.ConversationId == nil || conv.UserMessageId == nil || conv.AgentVersion == nil || *conv.AgentVersion != 1 {
		t.Fatalf("conversation event = %+v", conv)
	}
	var retr apitypes.ChatEventRetrieval
	evs.one(t, "retrieval", &retr)
	if len(retr.Hits) == 0 || retr.Hits[0].N != 1 || retr.Hits[0].Title != "Parking" || retr.Hits[0].Url != nil {
		t.Fatalf("retrieval = %+v", retr)
	}
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if end.StopReason != "stop" || end.Refused || end.NoContext || len(end.Citations) != 1 || end.Citations[0].N != 1 ||
		end.Citations[0].Title != "Parking" || end.Citations[0].Url != nil || !strings.HasSuffix(end.Text, "[1]") ||
		end.Usage.Input == 0 || end.Usage.Reasoning != 3 {
		t.Fatalf("message_end = %+v", end)
	}
	if !strings.Contains(end.Citations[0].Snippet, "parking permit") {
		t.Errorf("snippet = %q", end.Citations[0].Snippet)
	}
	if got := evs.text("text_delta"); got != end.Text {
		t.Errorf("streamed %q, final %q", got, end.Text)
	}
	// The preamble: untrusted sources, the refusal line, the team's instructions.
	prompts := systemPrompts(env.proxy)[requestsBefore:]
	if len(prompts) != 1 || !strings.Contains(prompts[0], `Refusal message: "I couldn't find an answer to that in the sources I have."`) ||
		!strings.Contains(prompts[0], "untrusted") || !strings.Contains(prompts[0], "Be brief and friendly.") || strings.Contains(prompts[0], "standalone") {
		t.Fatalf("system prompts = %q", prompts)
	}

	// Continue the conversation: the question is rewritten with the history.
	before := len(env.proxy.ChatRequests())
	code, evs, e = member.stream(env.chatPath("student-help"), map[string]any{"message": "And where do I pick it up?", "conversationId": *conv.ConversationId})
	mustCode(t, "continue", code, e, 200, "")
	var conv2 struct{ ConversationId *string }
	evs.one(t, "conversation", &conv2)
	if *conv2.ConversationId != *conv.ConversationId {
		t.Fatalf("new conversation %v", conv2)
	}
	prompts = systemPrompts(env.proxy)[before:]
	if len(prompts) != 2 || !strings.Contains(prompts[0], "standalone") {
		t.Fatalf("expected a rewrite then an answer: %q", prompts)
	}
	// The history (question and answer) reaches the model; sources are not replayed.
	var lastReq struct {
		Messages []struct{ Role, Content string }
	}
	_ = json.Unmarshal(env.proxy.ChatRequests()[len(env.proxy.ChatRequests())-1], &lastReq)
	if len(lastReq.Messages) != 4 || lastReq.Messages[1].Content != "Where do students buy a parking permit?" ||
		lastReq.Messages[2].Role != "assistant" || strings.Contains(lastReq.Messages[1].Content, "<sources>") {
		t.Fatalf("answer request messages = %+v", lastReq.Messages)
	}

	// Non-streaming.
	var ans apitypes.ChatAnswer
	code, e = member.call("POST", env.chatPath("student-help"), map[string]any{"message": "When do residence halls open?", "stream": false}, &ans, nil)
	mustCode(t, "stream false", code, e, 200, "")
	if !ans.Persisted || ans.ConversationId == nil || ans.ConversationId.String() == *conv.ConversationId ||
		ans.StopReason != "stop" || len(ans.Citations) != 1 || ans.Citations[0].Title != "Housing" || ans.Thinking == "" || len(ans.Sources) == 0 {
		t.Fatalf("answer = %+v", ans)
	}

	// The transcript.
	var detail apitypes.ConversationDetail
	if code := member.get("/v1/conversations/"+*conv.ConversationId, &detail); code != 200 || len(detail.Messages) != 4 {
		t.Fatalf("conversation = %d %+v", code, detail)
	}
	m1 := detail.Messages[1]
	if m1.Role != "assistant" || m1.Citations == nil || len(*m1.Citations) != 1 || m1.Thinking == nil || *m1.Thinking == "" ||
		m1.Usage == nil || m1.StopReason == nil || *m1.StopReason != "stop" || detail.Conversation.Title != "Where do students buy a parking permit?" {
		t.Fatalf("assistant message = %+v", m1)
	}
	var page apitypes.ConversationPage
	if code := member.get("/v1/conversations?agentId="+ag.Id.String(), &page); code != 200 || len(page.Items) != 2 {
		t.Fatalf("conversations = %d %+v", code, page)
	}

	// Analytics events: one per answer, no content, a pseudonym (not the user ID).
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND channel = 'ui' AND message_id IS NOT NULL`, ag.Id); n != 3 {
		t.Errorf("message events = %d", n)
	}
	var pseudo string
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT pseudonymous_user FROM message_events WHERE agent_id = $1 LIMIT 1`, ag.Id).Scan(&pseudo)
	if len(pseudo) != 32 || strings.Contains(pseudo, member.me.User.Id.String()) {
		t.Errorf("pseudonym = %q", pseudo)
	}
	if n := env.scalar(t, `SELECT count(DISTINCT pseudonymous_user) FROM message_events WHERE agent_id = $1`, ag.Id); n != 1 {
		t.Errorf("pseudonyms = %d", n)
	}
	for _, kind := range []string{"chat_tokens_in", "chat_tokens_out", "embed_tokens", "query"} {
		if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = $1 AND agent_id = $2`, kind, ag.Id); n == 0 {
			t.Errorf("no %s usage with the agent", kind)
		}
	}
	// Open agents do not write the access log.
	if n := env.scalar(t, `SELECT count(*) FROM access_log`); n != 0 {
		t.Errorf("access log rows = %d", n)
	}

	// Revert: a later draft change reverts to version 1's config.
	code, e = editor.call("PATCH", path, map[string]any{"config": map[string]any{"chatModelId": env.chat.Id, "kbs": []map[string]any{{"kbId": env.kb.Id}}, "instructions": "Changed"}}, &ag, ifMatch(ag.Revision))
	mustCode(t, "change draft", code, e, 200, "")
	if !ag.HasUnpublishedChanges {
		t.Error("changed draft not flagged")
	}
	code, e = editor.call("POST", path+"/revert", map[string]any{"version": 1}, &ag, nil)
	mustCode(t, "revert", code, e, 200, "")
	if ag.Draft.Instructions != "Be brief and friendly." || ag.HasUnpublishedChanges {
		t.Fatalf("reverted = %+v", ag.Draft)
	}
	var versions []apitypes.AgentVersion
	if code := member.get(path+"/versions", &versions); code != 200 || len(versions) != 1 {
		t.Fatalf("versions = %d %+v", code, versions)
	}
	var one apitypes.AgentVersion
	if code := member.get(path+"/versions/1", &one); code != 200 || one.Config.Instructions != "Be brief and friendly." {
		t.Fatalf("version 1 = %d", code)
	}
	code, e = member.call("GET", path+"/versions/9", nil, nil, nil)
	mustCode(t, "missing version", code, e, 404, "version_not_found")

	// Draft test chat: nothing stored, channel test.
	convsBefore := env.scalar(t, `SELECT count(*) FROM conversations`)
	code, evs, e = editor.stream(path+"/test", map[string]any{"message": "Library hours during finals?"})
	mustCode(t, "test chat", code, e, 200, "")
	var tconv struct {
		ConversationId *string
		AgentVersion   *int32
	}
	evs.one(t, "conversation", &tconv)
	if tconv.ConversationId != nil || tconv.AgentVersion != nil {
		t.Errorf("test conversation event = %+v", tconv)
	}
	if env.scalar(t, `SELECT count(*) FROM conversations`) != convsBefore {
		t.Error("test chat stored a conversation")
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND channel = 'test' AND message_id IS NULL AND agent_version_id IS NULL`, ag.Id); n != 1 {
		t.Errorf("test events = %d", n)
	}
	code, e = member.call("POST", path+"/test", map[string]any{"message": "hi"}, nil, nil)
	mustCode(t, "member tests draft", code, e, 403, "forbidden")

	// Deleting the agent (team admins): the directory hides it; the
	// conversation stays readable but can't continue.
	code, e = editor.call("DELETE", path, nil, nil, nil)
	mustCode(t, "editor deletes", code, e, 403, "forbidden")
	code, e = env.tadmin.call("DELETE", path, nil, nil, nil)
	mustCode(t, "admin deletes", code, e, 200, "")
	if code := member.get("/v1/agents", &dir); code != 200 || len(dir) != 0 {
		t.Errorf("directory after delete = %+v", dir)
	}
	if code := member.get("/v1/conversations/"+*conv.ConversationId, &detail); code != 200 || !detail.Conversation.AgentDeleted {
		t.Errorf("conversation after delete = %d %+v", code, detail.Conversation)
	}
	code, _, e = member.stream(env.chatPath("student-help"), map[string]any{"message": "Hello?", "conversationId": *conv.ConversationId})
	mustCode(t, "chat with deleted agent", code, e, 404, "agent_not_found")
	// The slug is free again.
	code, e = editor.call("POST", agents, map[string]any{"name": "Student help"}, &ag, nil)
	mustCode(t, "reuse slug", code, e, 201, "")
	if ag.Slug != "student-help" {
		t.Errorf("slug = %s", ag.Slug)
	}
}

// Tool mode with web pages: search_knowledge calls, citation URLs by mode,
// and pinned metadata filters.
func TestAgentToolModeWebCitationsAndFilters(t *testing.T) {
	env := newAgentEnv(t)
	site := env.site
	web := env.createWeb(t, env.owner, env.base+"/sources", "Registrar web", map[string]any{
		"mode": "batch", "urls": []string{site.url("/"), site.url("/admissions/")}, "tags": []string{"Web", "registrar"},
	})
	webPath := env.base + "/sources/" + web.Id.String()
	waitCrawl(t, env.owner, webPath, web.ActiveCrawl.Id)
	pages := env.owner.waitForDocuments(t, webPath+"/documents")
	if len(pages) == 0 || strings.Join(pages[0].Tags, ",") != "web,registrar" {
		t.Fatalf("pages = %+v", pages)
	}
	var webKB apitypes.KnowledgeBase
	env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Web"}, &webKB, nil)
	code, e := env.owner.call("PUT", env.base+"/kbs/"+webKB.Id.String()+"/sources/"+web.Id.String(), nil, nil, nil)
	mustCode(t, "attach web", code, e, 200, "")

	q := "When do freshman applications open?"

	cfg := env.agentConfig(webKB.Id.String())
	cfg["retrievalMode"] = "tool"
	ag := env.publishAgent(t, "Web helper", cfg)
	before := len(env.proxy.ChatRequests())
	code, evs, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": q})
	mustCode(t, "tool chat", code, e, 200, "")
	names := strings.Join(evs.names(), ",")
	if !strings.Contains(names, "message_start,thinking_delta") || !strings.Contains(names, "tool_call,retrieval,tool_result") {
		t.Fatalf("events = %s", names)
	}
	var call apitypes.ChatEventToolCall
	evs.one(t, "tool_call", &call)
	if call.Name != "search_knowledge" || call.Id == "" {
		t.Fatalf("tool call = %+v", call)
	}
	var res apitypes.ChatEventToolResult
	evs.one(t, "tool_result", &res)
	if res.IsError || res.HitCount == 0 || res.Id != call.Id {
		t.Fatalf("tool result = %+v", res)
	}
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if len(end.Citations) != 1 || end.Citations[0].Url == nil || !strings.HasPrefix(*end.Citations[0].Url, site.url("/")) || end.NoContext {
		t.Fatalf("tool answer = %+v", end)
	}
	// The first turn offered the tool; the fake's tool_choice is not sent
	// (compat default) and the second turn answered from the tool result.
	reqs := env.proxy.ChatRequests()[before:]
	if len(reqs) != 2 || !strings.Contains(string(reqs[0]), `"search_knowledge"`) || strings.Contains(string(reqs[0]), `"tool_choice"`) {
		t.Fatalf("tool requests = %d", len(reqs))
	}
	var conv struct{ ConversationId string }
	evs.one(t, "conversation", &conv)
	var detail apitypes.ConversationDetail
	env.member.get("/v1/conversations/"+conv.ConversationId, &detail)
	if tc := detail.Messages[1].ToolCalls; tc == nil || len(*tc) != 1 || (*tc)[0].HitCount == 0 || (*tc)[0].Query == nil {
		t.Fatalf("stored tool calls = %+v", detail.Messages[1])
	}
	if n := env.scalar(t, `SELECT count(*) FROM messages WHERE role = 'tool_result' AND conversation_id = $1`, conv.ConversationId); n != 1 {
		t.Errorf("tool_result rows = %d", n)
	}
	if n := env.scalar(t, `SELECT tool_calls FROM message_events WHERE message_id = $1`, end.MessageId); n != 1 {
		t.Errorf("tool_calls = %d", n)
	}

	// snippet mode: no URLs anywhere.
	cfg["citationMode"] = "snippet"
	snippetAg := env.publishAgent(t, "Web snippets", cfg)
	code, evs, _ = env.member.stream(env.chatPath(snippetAg.Slug), map[string]any{"message": q})
	evs.one(t, "message_end", &end)
	if code != 200 || len(end.Citations) != 1 || end.Citations[0].Url != nil {
		t.Fatalf("snippet citations = %+v", end.Citations)
	}
	var retr apitypes.ChatEventRetrieval
	evs.one(t, "retrieval", &retr)
	for _, h := range retr.Hits {
		if h.Url != nil {
			t.Fatalf("snippet mode leaked a URL: %+v", h)
		}
	}
	// none mode: markers stripped, no citations.
	cfg["citationMode"], cfg["retrievalMode"] = "none", "always"
	noneAg := env.publishAgent(t, "Web plain", cfg)
	code, evs, _ = env.member.stream(env.chatPath(noneAg.Slug), map[string]any{"message": q})
	evs.one(t, "message_end", &end)
	if code != 200 || len(end.Citations) != 0 || strings.Contains(end.Text, "[1]") || end.Text == "" {
		t.Fatalf("none mode = %+v", end)
	}

	// Pinned filters: tags select the tagged handbook page across both KBs.
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	var list apitypes.DocumentPage
	env.owner.get(docs, &list)
	var housing apitypes.Document
	for _, d := range list.Items {
		if d.Filename == "housing.md" {
			housing = d
		}
	}
	var tagged apitypes.Document
	code, e = env.owner.call("PATCH", docs+"/"+housing.Id.String(), map[string]any{"tags": []string{"Dorms", "dorms", "housing"}}, &tagged, nil)
	mustCode(t, "tag document", code, e, 200, "")
	if strings.Join(tagged.Tags, ",") != "dorms,housing" {
		t.Fatalf("tags = %v", tagged.Tags)
	}
	code, e = env.member.call("PATCH", docs+"/"+housing.Id.String(), map[string]any{"tags": []string{"x"}}, nil, nil)
	mustCode(t, "member tags", code, e, 403, "forbidden")
	code, e = env.owner.call("PATCH", docs+"/"+housing.Id.String(), map[string]any{"tags": []string{"a,b"}}, nil, nil)
	mustCode(t, "comma tag", code, e, 400, "invalid_tags")

	fcfg := env.agentConfig(env.kb.Id.String(), webKB.Id.String())
	fcfg["filters"] = map[string]any{"tags": []string{"housing"}}
	filtered := env.publishAgent(t, "Housing only", fcfg)
	code, evs, _ = env.member.stream(env.chatPath(filtered.Slug), map[string]any{"message": "Where do students buy a parking permit?"})
	evs.one(t, "retrieval", &retr)
	if code != 200 || len(retr.Hits) != 1 || retr.Hits[0].Title != "Housing" {
		t.Fatalf("filtered retrieval = %+v", retr)
	}
	// An agent's filter is validated when the draft is saved.
	fcfg["filters"] = map[string]any{"kinds": []string{"exe"}}
	code, raw := env.editor.raw("POST", env.base+"/agents", map[string]any{"name": "Bad filter", "config": fcfg}, nil)
	if pb := decodeProblems(t, raw); code != 400 || !hasField(pb.Error.Details.Problems, "filters.kinds") {
		t.Fatalf("bad filter = %d %s", code, raw)
	}
}

// Metadata filters on /retrieve: sources, kinds, tags, URL prefixes, dates.
func TestRetrieveMetadataFilters(t *testing.T) {
	env := newAgentEnv(t)
	site := env.site
	web := env.createWeb(t, env.owner, env.base+"/sources", "Registrar web", map[string]any{
		"mode": "batch", "urls": []string{site.url("/"), site.url("/admissions/")},
	})
	webPath := env.base + "/sources/" + web.Id.String()
	waitCrawl(t, env.owner, webPath, web.ActiveCrawl.Id)
	env.owner.waitForDocuments(t, webPath+"/documents")
	code, e := env.owner.call("PUT", env.base+"/kbs/"+env.kb.Id.String()+"/sources/"+web.Id.String(), nil, nil, nil)
	mustCode(t, "attach web", code, e, 200, "")
	// Tags via upload: a new tagged document (the field may follow the files).
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	code, results, _ := env.owner.uploadFilesWithTags(docs, []upload{{"parking-faq.md", []byte("# Parking FAQ\n\nParking permits for students are sold online each semester.")}}, "FAQ, Parking")
	if code != 200 || results[0].Document == nil || strings.Join(results[0].Document.Tags, ",") != "faq,parking" {
		t.Fatalf("tagged upload = %d %+v", code, results)
	}
	env.owner.waitForDocuments(t, docs)

	retrieve := func(filters map[string]any) []apitypes.RetrieveHit {
		t.Helper()
		var res apitypes.RetrieveResult
		code, e := env.member.call("POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve",
			map[string]any{"query": "parking permit students registrar admissions", "topK": 20, "filters": filters}, &res, nil)
		mustCode(t, "retrieve", code, e, 200, "")
		return res.Hits
	}
	all := retrieve(nil)
	sources := map[string]bool{}
	for _, h := range all {
		sources[h.SourceId.String()] = true
	}
	if len(sources) != 2 {
		t.Fatalf("unfiltered hits from %d sources: %+v", len(sources), all)
	}
	check := func(what string, hits []apitypes.RetrieveHit, ok func(apitypes.RetrieveHit) bool) {
		t.Helper()
		if len(hits) == 0 {
			t.Fatalf("%s: no hits", what)
		}
		for _, h := range hits {
			if !ok(h) {
				t.Fatalf("%s: unexpected hit %+v", what, h)
			}
		}
	}
	check("sourceIds", retrieve(map[string]any{"sourceIds": []string{web.Id.String()}}), func(h apitypes.RetrieveHit) bool { return h.SourceId == web.Id })
	check("kinds", retrieve(map[string]any{"kinds": []string{"md"}}), func(h apitypes.RetrieveHit) bool { return strings.HasSuffix(h.Filename, ".md") })
	check("tags", retrieve(map[string]any{"tags": []string{"PARKING"}}), func(h apitypes.RetrieveHit) bool { return h.Filename == "parking-faq.md" })
	check("urlPrefixes", retrieve(map[string]any{"urlPrefixes": []string{site.url("/admissions/")}}), func(h apitypes.RetrieveHit) bool {
		return strings.HasPrefix(h.Url, site.url("/admissions/"))
	})
	if hits := retrieve(map[string]any{"updatedAfter": "2099-01-01T00:00:00Z"}); len(hits) != 0 {
		t.Errorf("future updatedAfter matched %d", len(hits))
	}
	if hits := retrieve(map[string]any{"updatedBefore": "2099-01-01T00:00:00Z"}); len(hits) != len(all) {
		t.Errorf("updatedBefore = %d of %d", len(hits), len(all))
	}
	if hits := retrieve(map[string]any{"sourceIds": []string{env.kb.Id.String()}}); len(hits) != 0 {
		t.Errorf("a source outside the KB matched %d", len(hits))
	}
	code, e = env.member.call("POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve",
		map[string]any{"query": "x", "filters": map[string]any{"urlPrefixes": []string{"ftp://x"}}}, nil, nil)
	mustCode(t, "bad prefix", code, e, 400, "invalid_filter")

	// Web source tags apply to existing pages when the source changes.
	var src apitypes.DataSource
	env.owner.get(webPath, &src)
	code, e = env.owner.call("PATCH", webPath, map[string]any{"web": map[string]any{"mode": "batch",
		"urls": []string{site.url("/"), site.url("/admissions/")}, "tags": []string{"site"}}}, &src, ifMatch(src.Revision))
	mustCode(t, "retag web source", code, e, 200, "")
	check("web tags", retrieve(map[string]any{"tags": []string{"site"}}), func(h apitypes.RetrieveHit) bool { return h.SourceId == web.Id })
}

// uploadFilesWithTags uploads files with a trailing tags field.
func (s *session) uploadFilesWithTags(path string, files []upload, tagList string) (int, []apitypes.UploadResult, string) {
	s.t.Helper()
	var body strings.Builder
	boundary := "groundedtestboundary"
	for _, f := range files {
		body.WriteString("--" + boundary + "\r\nContent-Disposition: form-data; name=\"files\"; filename=\"" + f.name + "\"\r\nContent-Type: text/markdown\r\n\r\n")
		body.Write(f.data)
		body.WriteString("\r\n")
	}
	body.WriteString("--" + boundary + "\r\nContent-Disposition: form-data; name=\"tags\"\r\n\r\n" + tagList + "\r\n--" + boundary + "--\r\n")
	req, _ := http.NewRequest("POST", s.app.URL+path, strings.NewReader(body.String()))
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	req.Header.Set("Origin", s.app.URL)
	req.Header.Set("X-CSRF-Token", s.csrf)
	res, err := s.client.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var env struct{ Data []apitypes.UploadResult }
	_ = json.Unmarshal(raw, &env)
	return res.StatusCode, env.Data, errorCode(raw)
}
