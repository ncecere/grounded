package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Sharing a conversation (v0.6.0, C12; ADR-0010 amendment): a link to a read-only, snapshot view of your own conversation.

type shareEnv struct {
	*publishEnv
	anon *visitor
}

func newShareEnv(t *testing.T) *shareEnv {
	t.Helper()
	env := newPublishEnv(t)
	return &shareEnv{publishEnv: env, anon: newVisitor(t, env.app.URL)}
}

// ask has s chat with an agent (optionally continuing a conversation) and returns the conversation's id.
func (env *shareEnv) ask(t *testing.T, s *session, slug, conv, question string) string {
	t.Helper()
	body := map[string]any{"message": question}
	if conv != "" {
		body["conversationId"] = conv
	}
	code, evs, e := s.stream(env.chatPath(slug), body)
	mustCode(t, "chat", code, e, 200, "")
	var c struct{ ConversationId string }
	evs.one(t, "conversation", &c)
	return c.ConversationId
}

func (env *shareEnv) detail(t *testing.T, s *session, conv string) apitypes.ConversationDetail {
	t.Helper()
	var d apitypes.ConversationDetail
	if code := s.get("/v1/conversations/"+conv, &d); code != 200 {
		t.Fatalf("conversation = %d", code)
	}
	return d
}

func (env *shareEnv) share(t *testing.T, s *session, conv, audience string, showName bool) apitypes.ConversationShareCreated {
	t.Helper()
	var out apitypes.ConversationShareCreated
	code, e := s.call("POST", "/v1/conversations/"+conv+"/shares", map[string]any{"audience": audience, "showName": showName}, &out, nil)
	mustCode(t, "share", code, e, 201, "")
	return out
}

// view opens a link as s and returns the status, the decoded view and the error code.
func (env *shareEnv) view(s *session, token string) (int, apitypes.SharedConversation, string) {
	var out apitypes.SharedConversation
	code, e := s.call("GET", "/v1/shared/"+token, nil, &out, nil)
	return code, out, e
}

func (env *shareEnv) viewAnon(token string) (int, apitypes.SharedConversation, string) {
	var out apitypes.SharedConversation
	code, e := env.anon.call("GET", "/v1/shared/"+token, nil, &out)
	return code, out, e
}

func (env *shareEnv) source(s *session, token, message string, n int) (int, string) {
	return s.call("GET", "/v1/shared/"+token+"/messages/"+message+"/sources/"+itoa(int64(n)), nil, nil, nil)
}

func TestSharedConversationLifecycle(t *testing.T) {
	env := newShareEnv(t)
	ag := env.publishAgent(t, "Parking help", env.agentConfig(env.kb.Id.String()))
	conv := env.ask(t, env.member, ag.Slug, "", "Where do students buy a parking permit?")
	d := env.detail(t, env.member, conv)
	if len(d.Messages) != 2 || d.Messages[1].Citations == nil || len(*d.Messages[1].Citations) == 0 {
		t.Fatalf("the conversation to share = %+v", d.Messages)
	}
	answer := d.Messages[1]

	// Nothing is listed before a link is made; the link is shown once.
	var list []apitypes.ConversationShare
	if code := env.member.get("/v1/conversations/"+conv+"/shares", &list); code != 200 || len(list) != 0 {
		t.Fatalf("shares before = %d %+v", code, list)
	}
	made := env.share(t, env.member, conv, "agent_users", false)
	if len(made.Token) != 43 || !strings.HasSuffix(made.Url, "/shared/"+made.Token) || made.Share.MessageCount != 2 || made.Share.Audience != "agent_users" || made.Share.ShowName {
		t.Fatalf("created = %+v", made)
	}
	if code := env.member.get("/v1/conversations/"+conv+"/shares", &list); code != 200 || len(list) != 1 || list[0].Id != made.Share.Id {
		t.Fatalf("shares after = %d %+v", code, list)
	}
	if _, raw := env.member.raw("GET", "/v1/conversations/"+conv+"/shares", nil, nil); strings.Contains(string(raw), made.Token) {
		t.Error("the list shows a link's secret again: only its hash is kept")
	}
	if n := env.scalar(t, `SELECT count(*) FROM conversation_shares WHERE encode(token_hash, 'escape') LIKE '%' || $1 || '%'`, made.Token); n != 0 {
		t.Error("the secret is stored as it is")
	}

	// The owner and the agent's other users open it: the questions, the answer and its citations, no name.
	for who, s := range map[string]*session{"owner of the link": env.member, "editor": env.editor, "team admin": env.tadmin} {
		code, v, e := env.view(s, made.Token)
		mustCode(t, who+" opens", code, e, 200, "")
		if len(v.Messages) != 2 || v.Messages[0].Role != "user" || v.Messages[1].Role != "assistant" || v.Messages[1].Text != answer.Text || len(v.Messages[1].Citations) == 0 ||
			v.Agent.Name != "Parking help" || v.SharedBy != "" || v.Owner != (who == "owner of the link") {
			t.Errorf("%s sees %+v", who, v)
		}
	}
	// What the view must never carry, anywhere in its JSON.
	_, raw := env.editor.raw("GET", "/v1/shared/"+made.Token, nil, nil)
	for _, leaked := range []string{"thinking", "toolCalls", "retrieval", "feedback", "usage", "latencyMs", "claims", "uncited", "verification", "markers", "documentId", "sourceId"} {
		if strings.Contains(string(raw), `"`+leaked+`"`) {
			t.Errorf("the shared view carries %q: %s", leaked, raw)
		}
	}

	// Everyone else: signed in without access gets 404, with no session 401, and an invalid secret looks exactly the same to each.
	for who, s := range map[string]*session{"platform admin": env.admin, "auditor": env.auditor} {
		code, _, e := env.view(s, made.Token)
		mustCode(t, who+" is not on the team", code, e, 404, "share_not_found")
	}
	for name, tok := range map[string]string{"valid": made.Token, "unknown": strings.Repeat("B", 43), "garbage": "nonsense"} {
		code, _, e := env.viewAnon(tok)
		mustCode(t, name+" link without a session", code, e, 401, "sign_in_required")
	}
	code, e := env.admin.call("GET", "/v1/shared/"+strings.Repeat("B", 43), nil, nil, nil)
	mustCode(t, "an unknown secret, signed in", code, e, 404, "share_not_found")

	// An API key is not accepted (it is not a person's own act), and the response is never cached or sent on.
	key := createKey(t, env.member, env.base, map[string]any{"name": "shares", "scopes": []string{"query"}})
	req, _ := http.NewRequest("GET", env.app.URL+"/v1/shared/"+made.Token, nil)
	req.Header.Set("Authorization", "Bearer "+key.Secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Errorf("an API key opening a link = %d, want 400", res.StatusCode)
	}
	for _, h := range []*http.Response{res, func() *http.Response { r, _ := env.anon.do("GET", "/v1/shared/"+made.Token, nil, nil); return r }()} {
		if h.Header.Get("Cache-Control") != "no-store" || h.Header.Get("Referrer-Policy") != "no-referrer" || !strings.Contains(h.Header.Get("X-Robots-Tag"), "noindex") {
			t.Errorf("headers = %v", h.Header)
		}
	}
	// The page's own address (the app shell) is not sent on as a referrer, nor indexed.
	if r, _ := env.anon.do("GET", "/shared/"+made.Token, nil, nil); r.Header.Get("Referrer-Policy") != "no-referrer" || !strings.Contains(r.Header.Get("X-Robots-Tag"), "noindex") {
		t.Logf("the app shell for /shared/ is not served in this test build (no UI): %d", r.StatusCode)
	}

	// A snapshot: the conversation goes on, the link does not.
	env.ask(t, env.member, ag.Slug, conv, "And where is the office?")
	later := env.detail(t, env.member, conv)
	if len(later.Messages) != 4 {
		t.Fatalf("the conversation has %d messages", len(later.Messages))
	}
	_, v, _ := env.view(env.editor, made.Token)
	if len(v.Messages) != 2 {
		t.Errorf("the link shows %d messages after the conversation went on, want the 2 it was made with", len(v.Messages))
	}
	second := env.share(t, env.member, conv, "agent_users", true)
	if second.Share.MessageCount != 4 || second.Share.UpToSeq <= made.Share.UpToSeq {
		t.Errorf("a new link covers %+v", second.Share)
	}
	// "Show my name" puts the sharer's name on that link only.
	_, v, _ = env.view(env.editor, second.Token)
	if v.SharedBy != "Blair Dev" || len(v.Messages) != 4 {
		t.Errorf("the named link shows %q and %d messages", v.SharedBy, len(v.Messages))
	}

	// Sources open through the link, only for answers inside the snapshot.
	code, e = env.source(env.editor, made.Token, answer.Id.String(), 1)
	mustCode(t, "source of an answer in the snapshot", code, e, 200, "")
	var passage apitypes.CitedPassage
	if code, _ := env.editor.call("GET", "/v1/shared/"+made.Token+"/messages/"+answer.Id.String()+"/sources/1", nil, &passage, nil); code != 200 || passage.Status != "available" || len(passage.Passages) == 0 {
		t.Errorf("passage = %+v", passage)
	}
	if _, raw := env.editor.raw("GET", "/v1/shared/"+made.Token+"/messages/"+answer.Id.String()+"/sources/1", nil, nil); strings.Contains(string(raw), `"claims"`) && !strings.Contains(string(raw), `"claims":[]`) {
		t.Errorf("a shared source carries the agent's claim checks: %s", raw)
	}
	code, e = env.source(env.editor, made.Token, later.Messages[3].Id.String(), 1)
	mustCode(t, "an answer after the snapshot", code, e, 404, "message_not_found")
	other := env.ask(t, env.member, ag.Slug, "", "Where do students buy a parking permit?")
	code, e = env.source(env.editor, made.Token, env.detail(t, env.member, other).Messages[1].Id.String(), 1)
	mustCode(t, "an answer of another conversation", code, e, 404, "message_not_found")
	code, e = env.source(env.editor, made.Token, answer.Id.String(), 99)
	mustCode(t, "a source number it does not cite", code, e, 404, "source_not_found")
	code, e = env.source(env.auditor, made.Token, answer.Id.String(), 1)
	mustCode(t, "a source, without access", code, e, 404, "share_not_found")
	if code, e := env.anon.call("GET", "/v1/shared/"+made.Token+"/messages/"+answer.Id.String()+"/sources/1", nil, nil); code != 401 || e != "sign_in_required" {
		t.Errorf("a source with no session = %d %s", code, e)
	}

	// Only the owner makes, lists and revokes links; to everyone else the conversation does not exist.
	for who, s := range map[string]*session{"editor": env.editor, "team admin": env.tadmin, "platform admin": env.admin} {
		code, e := s.call("POST", "/v1/conversations/"+conv+"/shares", map[string]any{"audience": "agent_users"}, nil, nil)
		mustCode(t, who+" makes a link to someone else's conversation", code, e, 404, "conversation_not_found")
		if code := s.get("/v1/conversations/"+conv+"/shares", nil); code != 404 {
			t.Errorf("%s lists someone else's links = %d", who, code)
		}
		code, e = s.call("DELETE", "/v1/conversations/"+conv+"/shares/"+made.Share.Id.String(), nil, nil, nil)
		mustCode(t, who+" revokes someone else's link", code, e, 404, "conversation_not_found")
	}
	if code, _, _ := env.view(env.editor, made.Token); code != 200 {
		t.Fatalf("a refused revoke ended the link: %d", code)
	}

	// Revoking ends it at once, for every viewer and for its sources; the other link stays.
	code, e = env.member.call("DELETE", "/v1/conversations/"+conv+"/shares/"+made.Share.Id.String(), nil, nil, nil)
	mustCode(t, "revoke", code, e, 200, "")
	code, _, e = env.view(env.editor, made.Token)
	mustCode(t, "a revoked link", code, e, 404, "share_not_found")
	code, _, e = env.view(env.member, made.Token)
	mustCode(t, "a revoked link, for its owner", code, e, 404, "share_not_found")
	code, e = env.source(env.editor, made.Token, answer.Id.String(), 1)
	mustCode(t, "a source of a revoked link", code, e, 404, "share_not_found")
	code, e = env.member.call("DELETE", "/v1/conversations/"+conv+"/shares/"+made.Share.Id.String(), nil, nil, nil)
	mustCode(t, "revoke twice", code, e, 404, "share_not_found")
	if code, _, _ := env.view(env.editor, second.Token); code != 200 {
		t.Errorf("revoking one link ended the other: %d", code)
	}

	// Deleting the conversation closes the links at once, before retention removes the rows; retention's deletion removes them with it.
	code, e = env.member.call("DELETE", "/v1/conversations/"+conv, nil, nil, nil)
	mustCode(t, "delete the conversation", code, e, 200, "")
	code, _, e = env.view(env.editor, second.Token)
	mustCode(t, "a link to a deleted conversation", code, e, 404, "share_not_found")
	if n := env.scalar(t, `SELECT count(*) FROM conversation_shares WHERE conversation_id = $1`, conv); n != 1 {
		t.Fatalf("the share row went before retention: %d", n)
	}
	if _, err := env.app.Pool.Exec(context.Background(), `DELETE FROM conversations WHERE id = $1`, conv); err != nil {
		t.Fatal(err)
	}
	if n := env.scalar(t, `SELECT count(*) FROM conversation_shares WHERE conversation_id = $1`, conv); n != 0 {
		t.Errorf("%d shares outlived their conversation's purge", n)
	}
}

func TestShareCreationRules(t *testing.T) {
	env := newShareEnv(t)
	ag := env.publishAgent(t, "Parking help", env.agentConfig(env.kb.Id.String()))
	conv := env.ask(t, env.member, ag.Slug, "", "Where do students buy a parking permit?")
	path := "/v1/conversations/" + conv + "/shares"

	// The audience is required and checked.
	for _, bad := range []map[string]any{{}, {"audience": ""}, {"audience": "everyone"}, {"audience": "public"}} {
		code, e := env.member.call("POST", path, bad, nil, nil)
		if code != 400 {
			t.Errorf("audience %v = %d %s, want 400", bad, code, e)
		}
	}
	// A link open to anyone needs a public agent: this one is for the team.
	code, e := env.member.call("POST", path, map[string]any{"audience": "anyone"}, nil, nil)
	mustCode(t, "anyone, on a team agent", code, e, 409, "public_share_unavailable")

	// A personal API key can read the conversation but cannot make, list or revoke links (they are a person's own act).
	key := createKey(t, env.member, env.base, map[string]any{"name": "shares", "scopes": []string{"query"}})
	for _, m := range []struct{ method, path string }{{"POST", path}, {"GET", path}, {"DELETE", path + "/00000000-0000-4000-8000-000000000000"}} {
		req, _ := http.NewRequest(m.method, env.app.URL+m.path, strings.NewReader(`{"audience":"agent_users"}`))
		req.Header.Set("Authorization", "Bearer "+key.Secret)
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 401 && res.StatusCode != 403 {
			t.Errorf("an API key: %s %s = %d, want a refusal", m.method, m.path, res.StatusCode)
		}
	}
	if n := env.scalar(t, `SELECT count(*) FROM conversation_shares`); n != 0 {
		t.Fatalf("refused requests left %d links", n)
	}

	// A conversation with no finished answer has nothing to share.
	var empty string
	if err := env.app.Pool.QueryRow(context.Background(), `INSERT INTO conversations (agent_id, user_id, title) VALUES ($1, $2, 'Empty') RETURNING id::text`,
		ag.Id, env.member.me.User.Id).Scan(&empty); err != nil {
		t.Fatal(err)
	}
	code, e = env.member.call("POST", "/v1/conversations/"+empty+"/shares", map[string]any{"audience": "agent_users"}, nil, nil)
	mustCode(t, "no answer yet", code, e, 409, "nothing_to_share")

	// A link ends at the last finished answer: a stopped answer is not one.
	if _, err := env.app.Pool.Exec(context.Background(), `INSERT INTO messages (conversation_id, seq, role, content, stop_reason) VALUES ($1, 1, 'user', '{"text":"Hello?"}', ''),
		($1, 2, 'assistant', '[{"type":"text","text":"Hel"}]', 'aborted')`, empty); err != nil {
		t.Fatal(err)
	}
	code, e = env.member.call("POST", "/v1/conversations/"+empty+"/shares", map[string]any{"audience": "agent_users"}, nil, nil)
	mustCode(t, "only a stopped answer", code, e, 409, "nothing_to_share")

	// At most 10 links per conversation, and a revoked one makes room.
	var first apitypes.ConversationShareCreated
	for i := 0; i < MaxShares; i++ {
		made := env.share(t, env.member, conv, "agent_users", false)
		if i == 0 {
			first = made
		}
	}
	code, e = env.member.call("POST", path, map[string]any{"audience": "agent_users"}, nil, nil)
	mustCode(t, "an eleventh link", code, e, 409, "too_many_shares")
	code, e = env.member.call("DELETE", path+"/"+first.Share.Id.String(), nil, nil, nil)
	mustCode(t, "revoke one", code, e, 200, "")
	env.share(t, env.member, conv, "agent_users", false)
}

// MaxShares is the limit per conversation (agents.MaxSharesPerConversation), written out so a change to it is a change here.
const MaxShares = 10
