package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Document permissions (B6, #41; docs/specs/document-acls/DESIGN.md): a restricted document's text reaches only the
// people and groups it is restricted to, on every surface that shows document text, and a change applies at once.
// "decal" is only in the parking document, so a response that contains it has leaked it.

const restrictedWord = "decal"

type accessEnv struct {
	*publishEnv
	parking apitypes.Document
}

// newAccessEnv restricts the parking document to the group parking-office, which blair (the member) is in.
func newAccessEnv(t *testing.T) *accessEnv {
	t.Helper()
	env := &accessEnv{publishEnv: newPublishEnv(t)}
	var page struct {
		Items []apitypes.Document `json:"items"`
	}
	env.owner.get(env.base+"/sources/"+env.upload.Id.String()+"/documents", &page)
	for _, d := range page.Items {
		if d.Filename == "parking.md" {
			env.parking = d
		}
	}
	if env.parking.Id.String() == "00000000-0000-0000-0000-000000000000" {
		t.Fatalf("no parking document in %+v", page.Items)
	}
	env.sql(t, `UPDATE documents SET acl_principals = ARRAY['group:parking-office'] WHERE id = $1`, env.parking.Id)
	env.setGroups(t, env.member, "parking-office")
	return env
}

func (env *accessEnv) sql(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := env.app.Pool.Exec(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

// setGroups records the groups a person was last seen with at sign-in.
func (env *accessEnv) setGroups(t *testing.T, s *session, groups ...string) {
	t.Helper()
	env.sql(t, `INSERT INTO sso_user_groups (user_id, groups, claim_present) VALUES ($1, $2, true)
		ON CONFLICT (user_id) DO UPDATE SET groups = EXCLUDED.groups`, s.me.User.Id, groups)
}

func (env *accessEnv) retrieve(t *testing.T, s *session) string {
	t.Helper()
	code, raw := s.raw("POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve", map[string]any{"query": "parking permit", "topK": 10}, nil)
	if code != 200 {
		t.Fatalf("retrieve = %d %s", code, raw)
	}
	return string(raw)
}

func (env *accessEnv) ask(t *testing.T, s *session, slug string) (apitypes.ChatAnswer, string) {
	t.Helper()
	code, raw := s.raw("POST", env.chatPath(slug), map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, nil)
	if code != 200 {
		t.Fatalf("chat = %d %s", code, raw)
	}
	var env2 struct{ Data apitypes.ChatAnswer }
	if err := json.Unmarshal(raw, &env2); err != nil {
		t.Fatal(err)
	}
	return env2.Data, string(raw)
}

func citesDoc(ans apitypes.ChatAnswer, id string) string {
	for _, c := range ans.Citations {
		if c.DocumentId.String() == id {
			return strconv.Itoa(c.N)
		}
	}
	return ""
}

func keyRaw(t *testing.T, base, method, path, key string, body any) (int, string) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, base+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(raw)
}

func TestRestrictedDocumentsReachOnlyTheirPrincipals(t *testing.T) {
	env := newAccessEnv(t)
	doc := env.parking.Id.String()

	// Knowledge base search: the group's member finds it; an editor, the owner and an API key do not.
	if raw := env.retrieve(t, env.member); !strings.Contains(raw, restrictedWord) {
		t.Fatalf("the principal's search lacks the restricted document: %s", raw)
	}
	for name, s := range map[string]*session{"editor": env.editor, "owner": env.owner} {
		if raw := env.retrieve(t, s); strings.Contains(raw, restrictedWord) || strings.Contains(raw, doc) {
			t.Errorf("%s's search returned the restricted document: %s", name, raw)
		}
	}
	key := createKey(t, env.owner, env.base, map[string]any{"name": "search", "scopes": []string{"query"}})
	code, raw := keyRaw(t, env.app.URL, "POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve", key.Secret, map[string]any{"query": "parking permit", "topK": 10})
	if code != 200 || strings.Contains(raw, restrictedWord) || strings.Contains(raw, doc) {
		t.Errorf("an API key's search = %d %s", code, raw)
	}

	// Agent answers: the principal's cites it; the editor's does not, and nothing of it is in the response.
	ag := env.publishAgent(t, "Permits", env.agentConfig(env.kb.Id.String()))
	mine, raw := env.ask(t, env.member, ag.Slug)
	n := citesDoc(mine, doc)
	if n == "" || !strings.Contains(raw, restrictedWord) {
		t.Fatalf("the principal's answer does not cite the restricted document: %s", raw)
	}
	theirs, raw := env.ask(t, env.editor, ag.Slug)
	if citesDoc(theirs, doc) != "" || strings.Contains(raw, restrictedWord) {
		t.Errorf("the editor's answer used the restricted document: %s", raw)
	}
	code, raw = keyRaw(t, env.app.URL, "POST", env.chatPath(ag.Slug), key.Secret, map[string]any{"message": "Where do students buy a parking permit?", "stream": false})
	if code != 200 || strings.Contains(raw, restrictedWord) || strings.Contains(raw, doc) {
		t.Errorf("an API key's answer = %d %s", code, raw)
	}

	// The viewer: the principal opens the cited passage; once out of the group, at once, it is no longer available.
	msg := mine.MessageId.String()
	if code, e, p := citedPassage(t, env.member, msg, n); code != 200 || p.Status != "available" || !strings.Contains(citedText(p), restrictedWord) {
		t.Fatalf("principal's cited passage = %d %s %+v", code, e, p)
	}
	env.setGroups(t, env.member, "someone-else")
	if code, e, p := citedPassage(t, env.member, msg, n); code != 200 || p.Status != "document_deleted" || len(p.Passages) != 0 {
		t.Errorf("cited passage after leaving the group = %d %s %+v", code, e, p)
	}
	env.setGroups(t, env.member, "parking-office")

	// Editors and the owner manage the document (it is listed) but do not read its text.
	docPath := env.base + "/sources/" + env.upload.Id.String() + "/documents/" + doc
	if code, e := env.editor.call("GET", docPath, nil, nil, nil); code != 200 {
		t.Errorf("the editor's document = %d %s", code, e)
	}
	for name, s := range map[string]*session{"editor": env.editor, "owner": env.owner} {
		if code, raw := s.raw("GET", docPath+"/passages", nil, nil); code != 403 || errorCode([]byte(raw)) != "document_restricted" || strings.Contains(string(raw), restrictedWord) {
			t.Errorf("%s's passages = %d %s", name, code, raw)
		}
		if code, raw := s.raw("GET", docPath+"/text?from=0&limit=50", nil, nil); code != 404 || strings.Contains(string(raw), restrictedWord) {
			t.Errorf("%s's document text = %d %s", name, code, raw)
		}
	}

	// Sharing: a conversation that cited it can't be shared.
	code, e := env.member.call("POST", "/v1/conversations/"+mine.ConversationId.String()+"/shares", map[string]any{"audience": "agent_users"}, nil, nil)
	if code != 409 || e != "not_shareable" {
		t.Errorf("share of a restricted answer = %d %s", code, e)
	}

	// An anonymous visitor of a public agent over the same knowledge never gets it.
	pub := env.publicAgent(t, "Open permits")
	v := newVisitor(t, env.app.URL)
	if code, e := v.start(pub.Id, "", ""); code != 201 {
		t.Fatalf("start = %d %s", code, e)
	}
	_, evs, _ := v.ask(pub.Id, "Where do students buy a parking permit?")
	for _, ev := range evs {
		if strings.Contains(string(ev.data), restrictedWord) || strings.Contains(string(ev.data), doc) {
			t.Errorf("a visitor's answer used the restricted document: %s %s", ev.name, ev.data)
		}
	}
}

// A share made before a document was restricted stops working once it is; repeated-block samples from a restricted
// document are hidden from readers outside it.
func TestRestrictionClosesEarlierSharesAndSamples(t *testing.T) {
	env := &accessEnv{publishEnv: newPublishEnv(t)}
	ag := env.publishAgent(t, "Permits", env.agentConfig(env.kb.Id.String()))
	ans := askFor(t, env.member, env.chatPath(ag.Slug), "Where do students buy a parking permit?")
	var share apitypes.ConversationShareCreated
	code, e := env.member.call("POST", "/v1/conversations/"+ans.ConversationId.String()+"/shares", map[string]any{"audience": "agent_users"}, &share, nil)
	mustCode(t, "share", code, e, 201, "")
	if code, e := env.editor.call("GET", "/v1/shared/"+share.Token, nil, nil, nil); code != 200 {
		t.Fatalf("open share before = %d %s", code, e)
	}
	env.sql(t, `UPDATE documents SET acl_principals = ARRAY['group:parking-office'] WHERE id = $1`, ans.Citations[0].DocumentId)
	if code, raw := env.editor.raw("GET", "/v1/shared/"+share.Token, nil, nil); code != 404 || strings.Contains(string(raw), restrictedWord) {
		t.Errorf("open share after the restriction = %d %s", code, raw)
	}

	// A repeated block whose canonical document is restricted.
	env.sql(t, `INSERT INTO source_boilerplate_blocks (source_id, block_hash, doc_count, sample, canonical_document_id, variants)
		VALUES ($1, 424242, 9, 'Display the parking decal on the dashboard', $2, 1)`, env.upload.Id, ans.Citations[0].DocumentId)
	env.setGroups(t, env.member, "parking-office")
	path := env.base + "/sources/" + env.upload.Id.String() + "/boilerplate"
	if code, raw := env.owner.raw("GET", path, nil, nil); code != 200 || strings.Contains(string(raw), restrictedWord) {
		t.Errorf("the owner's repeated blocks = %d %s", code, raw)
	}
}

// An agent whose knowledge has a restricted document answers each person with their own permissions: its answers are
// never stored in the answer cache, and a person outside the restriction never gets one built from it.
func TestRestrictedKnowledgeSkipsTheAnswerCache(t *testing.T) {
	base := newAgentEnv(t)
	env := newCacheEnv(t, base)
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE documents SET acl_principals = ARRAY['group:parking-office']
		WHERE source_id = $1 AND filename = 'parking.md'`, env.upload.Id); err != nil {
		t.Fatal(err)
	}
	if _, err := env.app.Pool.Exec(t.Context(), `INSERT INTO sso_user_groups (user_id, groups, claim_present) VALUES ($1, '{parking-office}', true)
		ON CONFLICT (user_id) DO UPDATE SET groups = EXCLUDED.groups`,
		env.member.me.User.Id); err != nil {
		t.Fatal(err)
	}
	first, called := env.ask(t, env.member, cacheQuestion)
	if !called || !strings.Contains(first.Citations[0].Snippet, restrictedWord) {
		t.Fatalf("the principal's answer = %+v (model called %v)", first, called)
	}
	again, called := env.ask(t, env.editor, cacheQuestion)
	if !called || env.entries(t) != 0 {
		t.Fatalf("restricted knowledge used the cache: model called %v, entries %d", called, env.entries(t))
	}
	for _, c := range again.Citations {
		if strings.Contains(c.Snippet, restrictedWord) || strings.Contains(again.Text, restrictedWord) {
			t.Fatalf("the editor's answer has the restricted document: %+v", again)
		}
	}
}
