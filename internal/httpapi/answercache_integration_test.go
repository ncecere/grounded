package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

const cacheQuestion = "Where do students buy a parking permit?"

// cacheEnv is an agent environment with one published agent whose cache
// is on.
type cacheEnv struct {
	*agentEnv
	agent apitypes.Agent
}

func (env *cacheEnv) cachePath() string {
	return env.base + "/agents/" + env.agent.Id.String() + "/answer-cache"
}

// putCache saves the agent's cache settings.
func (env *cacheEnv) putCache(t *testing.T, body map[string]any) apitypes.AgentAnswerCache {
	t.Helper()
	var cur, out apitypes.AgentAnswerCache
	env.editor.get(env.cachePath(), &cur)
	code, e := env.editor.call("PUT", env.cachePath(), body, &out, ifMatch(cur.Revision))
	mustCode(t, "put answer cache", code, e, 200, "")
	return out
}

// ask asks the agent as s and reports whether the chat model was called.
func (env *cacheEnv) ask(t *testing.T, s *session, question string) (apitypes.ChatAnswer, bool) {
	t.Helper()
	before := len(env.proxy.ChatRequests())
	var ans apitypes.ChatAnswer
	code, e := s.call("POST", env.chatPath(env.agent.Slug), map[string]any{"message": question, "stream": false}, &ans, nil)
	mustCode(t, "chat", code, e, 200, "")
	return ans, len(env.proxy.ChatRequests()) > before
}

func (env *cacheEnv) entries(t *testing.T) int64 {
	return env.scalar(t, `SELECT count(*) FROM answer_cache WHERE agent_id = $1`, env.agent.Id)
}

func newCacheEnv(t *testing.T, base *agentEnv) *cacheEnv {
	t.Helper()
	env := &cacheEnv{agentEnv: base}
	env.agent = env.publishAgent(t, "Cachy", env.agentConfig(env.kb.Id.String()))
	var st apitypes.AgentAnswerCache
	if code := env.editor.get(env.cachePath(), &st); code != 200 || st.On || st.Enabled != nil || st.ExpiryHours != 24 || !st.PlatformEnabled {
		t.Fatalf("defaults for a team agent = %d %+v", code, st)
	}
	if st = env.putCache(t, map[string]any{"enabled": true, "nearIdentical": false, "expiryHours": 24}); !st.On {
		t.Fatalf("after turning it on = %+v", st)
	}
	return env
}

// TestAnswerCacheHitAndReplay: the same question (after normalising) gets
// the stored answer without the model, with the same text and citations,
// recorded as cached with no model tokens; a stream replays the live
// events; follow-ups (any later message of a conversation) and Try it
// never use the cache.
func TestAnswerCacheHitAndReplay(t *testing.T) {
	env := newCacheEnv(t, newAgentEnv(t))
	first, called := env.ask(t, env.member, cacheQuestion)
	if !called || first.NoContext || len(first.Citations) == 0 {
		t.Fatalf("first answer = %+v (model called %v)", first, called)
	}
	if env.entries(t) != 1 {
		t.Fatalf("entries = %d, want 1", env.entries(t))
	}
	again, called := env.ask(t, env.editor, "  where do students   buy a parking permit ")
	if called || again.Text != first.Text || len(again.Citations) != len(first.Citations) || !again.Persisted || again.Usage.Input != 0 {
		t.Fatalf("cached answer = %+v (model called %v)", again, called)
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE message_id = $1 AND cached AND cache_entry_id IS NOT NULL
		AND tokens_saved > 0 AND input_tokens = 0 AND output_tokens = 0`, again.MessageId); n != 1 {
		t.Errorf("cached message event = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'query' AND metadata->>'cached' = 'true' AND agent_id = $1`, env.agent.Id); n != 1 {
		t.Errorf("cached query usage = %d", n)
	}
	if n := env.scalar(t, `SELECT hits FROM answer_cache WHERE agent_id = $1`, env.agent.Id); n != 1 {
		t.Errorf("hits = %d", n)
	}

	// A stream sends the events a live answer sends.
	code, evs, e := env.tadmin.stream(env.chatPath(env.agent.Slug), map[string]any{"message": cacheQuestion + "!"})
	if code != 200 {
		t.Fatalf("stream = %d %s", code, e)
	}
	var names []string
	for _, ev := range evs {
		names = append(names, ev.name)
	}
	want := []string{"conversation", "retrieval", "message_start", "text_delta", "message_end", "done"}
	if len(names) != len(want) {
		t.Fatalf("events = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("events = %v, want %v", names, want)
		}
	}
	if evs.text("text_delta") != first.Text {
		t.Errorf("streamed text = %q", evs.text("text_delta"))
	}
	// The step shows this person's wording, never the first asker's, and the
	// replay arrives whole (shown from its start).
	var step struct{ Query string }
	var start struct{ Buffered bool }
	if evs.one(t, "retrieval", &step); step.Query != cacheQuestion+"!" {
		t.Errorf("replayed search = %q, want this person's question", step.Query)
	}
	if evs.one(t, "message_start", &start); !start.Buffered {
		t.Error("a replay's message_start isn't buffered")
	}
	var conv struct{ ConversationID string }
	evs.one(t, "conversation", &conv)
	var stored string
	if err := env.app.Pool.QueryRow(t.Context(), `SELECT retrieval->>'query' FROM messages WHERE conversation_id = $1 AND role = 'assistant'`,
		conv.ConversationID).Scan(&stored); err != nil || stored != cacheQuestion+"!" {
		t.Errorf("stored search step = %q (%v)", stored, err)
	}

	// A follow-up that leans on the conversation is answered live.
	var follow apitypes.ChatAnswer
	before := len(env.proxy.ChatRequests())
	code, e = env.member.call("POST", env.chatPath(env.agent.Slug), map[string]any{"message": "And for it?", "stream": false,
		"conversationId": first.ConversationId}, &follow, nil)
	mustCode(t, "follow-up", code, e, 200, "")
	if len(env.proxy.ChatRequests()) == before {
		t.Error("a follow-up leaning on the conversation was served from the cache")
	}
	// Any later message of a conversation is answered live, even one that
	// reads as standalone ("that" mid-sentence passed the old word test), and
	// it isn't saved.
	entries := env.entries(t)
	for _, q := range []string{cacheQuestion, "How much does that cost for students?"} {
		before = len(env.proxy.ChatRequests())
		code, e = env.member.call("POST", env.chatPath(env.agent.Slug), map[string]any{"message": q, "stream": false,
			"conversationId": first.ConversationId}, &follow, nil)
		mustCode(t, "a later message", code, e, 200, "")
		if len(env.proxy.ChatRequests()) == before {
			t.Errorf("a later message %q was served from the cache", q)
		}
	}
	if n := env.entries(t); n != entries {
		t.Errorf("entries after follow-ups = %d, want %d (follow-ups are never saved)", n, entries)
	}
	// A stateless caller's question with history is a follow-up too.
	var key apitypes.APIKeyCreated
	code, e = env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": "bot", "kind": "service", "scopes": []string{"query"}}, &key, nil)
	mustCode(t, "service key", code, e, 201, "")
	before = len(env.proxy.ChatRequests())
	code, e = keyCall(t, env.app.URL, "POST", env.chatPath(env.agent.Slug), key.Secret, map[string]any{"message": cacheQuestion, "stream": false,
		"history": []map[string]string{{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi."}}}, nil)
	mustCode(t, "stateless follow-up", code, e, 200, "")
	if len(env.proxy.ChatRequests()) == before {
		t.Error("a stateless caller's follow-up was served from the cache")
	}

	// Try it never reads the cache.
	before = len(env.proxy.ChatRequests())
	code, _, e = env.editor.stream(env.base+"/agents/"+env.agent.Id.String()+"/test", map[string]any{"message": cacheQuestion})
	if code != 200 || len(env.proxy.ChatRequests()) == before {
		t.Errorf("Try it = %d %s, model called %v", code, e, len(env.proxy.ChatRequests()) > before)
	}

	// Analytics: the hits and the tokens they saved.
	var an apitypes.AgentAnalytics
	env.editor.get(env.base+"/agents/"+env.agent.Id.String()+"/analytics", &an)
	if c := an.Totals.Cache; c.Hits != 2 || c.TokensSaved <= 0 || c.HitRate == nil {
		t.Errorf("analytics cache = %+v", c)
	}
	var st apitypes.AgentAnswerCache
	if env.editor.get(env.cachePath(), &st); st.Entries != 1 || st.Hits != 2 {
		t.Errorf("cache state = %+v", st)
	}
}

// TestAnswerCacheInvalidation: new knowledge, a new version, a thumbs-down,
// Clear cache, the platform switch, the agent's switch and expiry each
// stop the stored answer from being reused.
func TestAnswerCacheInvalidation(t *testing.T) {
	env := newCacheEnv(t, newAgentEnv(t))
	prime := func(what string) {
		t.Helper()
		env.ask(t, env.member, cacheQuestion)
		if _, called := env.ask(t, env.member, cacheQuestion); called {
			t.Fatalf("%s: not cached", what)
		}
	}
	live := func(what string) {
		t.Helper()
		if _, called := env.ask(t, env.member, cacheQuestion); !called {
			t.Fatalf("%s: the stored answer was reused", what)
		}
	}

	// A new document in the knowledge base.
	prime("before an upload")
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	env.owner.uploadFiles(docs, []upload{{"fees.md", []byte("# Fees\n\nParking permits cost forty dollars a term.\n")}}, "")
	env.owner.waitForDocuments(t, docs)
	live("after an upload")

	// A deleted document.
	prime("before a deletion")
	env.deleteDocument(t, "fees.md")
	live("after a deletion")

	// A new published version.
	prime("before publishing")
	agentPath := env.base + "/agents/" + env.agent.Id.String()
	code, e := env.editor.call("PATCH", agentPath, map[string]any{"config": map[string]any{"chatModelId": env.chat.Id,
		"kbs": []map[string]any{{"kbId": env.kb.Id}}, "instructions": "Be brief."}}, nil, ifMatch(revisionOf(t, env.editor, agentPath)))
	mustCode(t, "edit the draft", code, e, 200, "")
	code, e = env.editor.call("POST", env.base+"/agents/"+env.agent.Id.String()+"/publish", map[string]any{"note": "second"}, nil, nil)
	mustCode(t, "publish", code, e, 201, "")
	live("after publishing")

	// A thumbs-down removes the entry the answer came from.
	env.ask(t, env.member, cacheQuestion)
	cached, called := env.ask(t, env.member, cacheQuestion)
	if called {
		t.Fatal("not cached before the thumbs-down")
	}
	// (Entries of earlier versions and revisions stay until they expire, unreachable.)
	stored := env.entries(t)
	code, e = env.member.call("POST", "/v1/messages/"+cached.MessageId.String()+"/feedback", map[string]any{"rating": "down", "reason": "outdated"}, nil, nil)
	mustCode(t, "thumbs-down", code, e, 200, "")
	if n := env.entries(t); n != stored-1 {
		t.Fatalf("entries after a thumbs-down = %d, want %d", n, stored-1)
	}
	live("after a thumbs-down")

	// Clear cache (audited).
	var cleared apitypes.AnswerCacheCleared
	code, e = env.member.call("POST", env.cachePath()+"/clear", nil, nil, nil)
	mustCode(t, "member clears", code, e, 403, "forbidden")
	code, e = env.editor.call("POST", env.cachePath()+"/clear", nil, &cleared, nil)
	mustCode(t, "clear", code, e, 200, "")
	if cleared.Cleared < 1 || env.entries(t) != 0 || env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent.answer_cache_clear' AND target_id = $1`,
		env.agent.Id.String()) != 1 {
		t.Fatalf("cleared = %+v", cleared)
	}
	live("after Clear cache")

	// The platform switch.
	var ps apitypes.AnswerCacheSettings
	env.admin.get("/v1/admin/settings/answer-cache", &ps)
	code, e = env.admin.call("PUT", "/v1/admin/settings/answer-cache", map[string]any{"enabled": false}, &ps, ifMatch(ps.Revision))
	mustCode(t, "platform off", code, e, 200, "")
	live("with the platform switch off")
	code, e = env.admin.call("PUT", "/v1/admin/settings/answer-cache", map[string]any{"enabled": true}, &ps, ifMatch(ps.Revision))
	mustCode(t, "platform on", code, e, 200, "")
	// Switched off while an answer is in progress (here: behind the switch's
	// short cache in this process): the answer isn't saved.
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE answer_cache_settings SET enabled = false`); err != nil {
		t.Fatal(err)
	}
	before := env.entries(t)
	env.ask(t, env.member, "Where do staff buy a parking permit?")
	if n := env.entries(t); n != before {
		t.Errorf("entries after the switch went off = %d, want %d", n, before)
	}
	code, e = env.admin.call("PUT", "/v1/admin/settings/answer-cache", map[string]any{"enabled": true}, &ps, ifMatch(ps.Revision))
	mustCode(t, "platform on again", code, e, 200, "")

	// The agent's switch.
	env.putCache(t, map[string]any{"enabled": false, "nearIdentical": false, "expiryHours": 24})
	live("with the agent's switch off")
	env.putCache(t, map[string]any{"enabled": true, "nearIdentical": false, "expiryHours": 2})
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent.answer_cache_update' AND target_id = $1`, env.agent.Id.String()); n != 3 {
		t.Errorf("settings audits = %d, want 3", n)
	}

	// Expiry: an expired entry isn't served, and retention would delete it.
	prime("before expiry")
	// An hour back, so the report's clock (the server's) and the database's can't disagree about it.
	tag, err := env.app.Pool.Exec(t.Context(), `UPDATE answer_cache SET expires_at = now() - interval '1 hour', created_at = least(created_at, now() - interval '1 hour')
		WHERE agent_id = $1`, env.agent.Id)
	if err != nil {
		t.Fatal(err)
	} else if tag.RowsAffected() != 1 {
		t.Fatalf("stored answers expired = %d, want 1", tag.RowsAffected())
	}
	var report apitypes.RetentionReport
	env.admin.get("/v1/admin/retention/report", &report)
	due := int64(-1)
	for _, k := range report.Kinds {
		if k.Kind == apitypes.RetentionKindAnswerCache {
			due = k.Due
		}
	}
	if due != 1 {
		t.Errorf("retention due = %d, want 1", due)
	}
	live("after expiry")

	code, e = env.editor.call("PUT", env.cachePath(), map[string]any{"enabled": true, "nearIdentical": false, "expiryHours": 24}, nil, ifMatch(99))
	mustCode(t, "stale", code, e, 412, "")
	code, e = env.editor.call("PUT", env.cachePath(), map[string]any{"enabled": true, "nearIdentical": false, "expiryHours": 721},
		nil, ifMatch(revisionOf(t, env.editor, env.cachePath())))
	mustCode(t, "expiry out of range", code, e, 400, "invalid_expiry")

	// Detaching and attaching a source raise the knowledge base's revision.
	rev := func() int64 {
		return env.scalar(t, `SELECT content_revision FROM knowledge_bases WHERE id = $1`, env.kb.Id)
	}
	r0 := rev()
	attach := env.base + "/kbs/" + env.kb.Id.String() + "/sources/" + env.upload.Id.String()
	code, e = env.owner.call("DELETE", attach, nil, nil, nil)
	mustCode(t, "detach", code, e, 200, "")
	r1 := rev()
	code, e = env.owner.call("PUT", attach, nil, nil, nil)
	mustCode(t, "attach", code, e, 200, "")
	if r2 := rev(); r1 <= r0 || r2 <= r1 {
		t.Errorf("content revisions = %d, %d, %d", r0, r1, r2)
	}
}

// TestAnswerCacheNearIdentical: a near-identical question reuses the
// answer once SystemOne confirms both ask the same; one it says differs is
// answered live, without embedding the question twice.
func TestAnswerCacheNearIdentical(t *testing.T) {
	s1 := newSystemOneEnv(t)
	s1.putSettings(t, map[string]any{"enabled": false})
	env := newCacheEnv(t, s1.agentEnv)
	if st := env.putCache(t, map[string]any{"enabled": true, "nearIdentical": true, "expiryHours": 24}); !st.NearIdenticalAvailable || !st.NearIdentical {
		t.Fatalf("near-identical = %+v", st)
	}
	env.ask(t, env.member, cacheQuestion)
	if _, called := env.ask(t, env.member, "Where do students buy a parking permit, please?"); called {
		t.Fatal("a near-identical question was answered live")
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'systemone_tokens' AND metadata->>'feature' = 'cache'`); n != 1 {
		t.Errorf("same-question checks metered = %d", n)
	}
	embeds := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'embed_tokens' AND agent_id = $1`, env.agent.Id)
	if _, called := env.ask(t, env.member, "Where do students buy a parking permit DIFFERENT?"); !called {
		t.Fatal("a question SystemOne called different was served from the cache")
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'embed_tokens' AND agent_id = $1`, env.agent.Id) - embeds; n != 1 {
		t.Errorf("embeddings for a near miss = %d, want 1 (the search reuses the lookup's)", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND cached`, env.agent.Id); n != 1 {
		t.Errorf("cached answers = %d", n)
	}
}
