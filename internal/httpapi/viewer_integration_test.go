package httpapi_test

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The source viewer (docs/v0.4.0.md §5): a cited passage in its document's
// context for the answer's reader only, the whole document for the team's
// editors, admins and owners, and clear states for a passage that changed
// or a document deleted since the answer.

// askFor asks as s and returns the stored answer.
func askFor(t *testing.T, s *session, path, question string) apitypes.ChatAnswer {
	t.Helper()
	var ans apitypes.ChatAnswer
	code, e := s.call("POST", path, map[string]any{"message": question, "stream": false}, &ans, nil)
	mustCode(t, "chat", code, e, 200, "")
	if len(ans.Citations) == 0 {
		t.Fatalf("answer without citations: %+v", ans)
	}
	return ans
}

func citedPassage(t *testing.T, s *session, msg string, n string) (int, string, apitypes.CitedPassage) {
	t.Helper()
	var p apitypes.CitedPassage
	code, e := s.call("GET", "/v1/messages/"+msg+"/sources/"+n, nil, &p, nil)
	return code, e, p
}

func citedText(p apitypes.CitedPassage) string {
	for _, x := range p.Passages {
		if x.Cited {
			return x.Content
		}
	}
	return ""
}

func TestCitedPassageInContext(t *testing.T) {
	env := newPublishEnv(t)
	ag := env.publishAgent(t, "Viewer", env.agentConfig(env.kb.Id.String()))
	ans := askFor(t, env.member, env.chatPath(ag.Slug), "Where do students buy a parking permit?")
	msg := ans.MessageId.String()
	if ans.Citations[0].ChunkId == nil {
		t.Fatalf("citation without its passage: %+v", ans.Citations[0])
	}

	code, e, p := citedPassage(t, env.member, msg, "1")
	mustCode(t, "cited passage", code, e, 200, "")
	if p.Status != "available" || !strings.Contains(citedText(p), "parking permit") || p.Title == "" || p.DocumentTeam != nil ||
		p.DocumentId != ans.Citations[0].DocumentId || len(p.Claims) != 0 {
		t.Fatalf("cited passage = %+v", p)
	}
	// Only the conversation's user, only cited numbers.
	for _, c := range []struct {
		who       *session
		n         string
		code      int
		errorCode string
	}{
		{env.editor, "1", 404, "message_not_found"}, {env.owner, "1", 404, "message_not_found"}, {env.admin, "1", 404, "message_not_found"},
		{env.member, "9", 404, "source_not_found"}, {env.member, "0", 400, "invalid_number"},
	} {
		if code, e, _ := citedPassage(t, c.who, msg, c.n); code != c.code || e != c.errorCode {
			t.Errorf("source %s as %v = %d %s", c.n, c.who, code, e)
		}
	}

	// Editors may open the whole document; members get 403 there.
	mine := askFor(t, env.editor, env.chatPath(ag.Slug), "Where do students buy a parking permit?")
	_, _, ep := citedPassage(t, env.editor, mine.MessageId.String(), "1")
	if ep.DocumentTeam == nil || *ep.DocumentTeam != env.team {
		t.Fatalf("editor's cited passage = %+v", ep)
	}
	text := env.base + "/sources/" + p.SourceId.String() + "/documents/" + p.DocumentId.String() + "/text"
	if code, e := env.member.call("GET", text, nil, nil, nil); code != 403 {
		t.Errorf("member's document text = %d %s", code, e)
	}
	var dt apitypes.DocumentText
	code, e = env.editor.call("GET", text+"?around="+ans.Citations[0].ChunkId.String(), nil, &dt, nil)
	if mustCode(t, "around", code, e, 200, ""); len(dt.Items) == 0 || !dt.Items[0].Cited || dt.Total < 1 {
		t.Fatalf("around = %+v", dt)
	}
	code, e = env.editor.call("GET", text+"?from=0&limit=200", nil, &dt, nil)
	if mustCode(t, "from", code, e, 200, ""); int32(len(dt.Items)) != dt.Total || dt.From != 0 || dt.Items[0].Cited {
		t.Fatalf("whole document = %+v", dt)
	}
	if code, e := env.editor.call("GET", text+"?limit=201", nil, nil, nil); code != 400 || e != "invalid_limit" {
		t.Errorf("limit 201 = %d %s", code, e)
	}

	// An answer from before v0.4.0 (no passage ID) finds its passage by its text.
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE messages SET citations = jsonb_set(citations, '{0}', (citations->0) - 'chunkId') WHERE id = $1`, msg); err != nil {
		t.Fatal(err)
	}
	if _, _, p = citedPassage(t, env.member, msg, "1"); p.Status != "available" || !strings.Contains(citedText(p), "parking permit") {
		t.Fatalf("by text = %+v", p)
	}
	// The passage changed since: a clear status, no text.
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE chunks SET content = 'Something else entirely, written later.' WHERE document_id = $1`, p.DocumentId); err != nil {
		t.Fatal(err)
	}
	if _, _, p = citedPassage(t, env.member, msg, "1"); p.Status != "passage_changed" || len(p.Passages) != 0 {
		t.Fatalf("changed = %+v", p)
	}
	// The document deleted since.
	code, e = env.owner.call("DELETE", env.base+"/sources/"+p.SourceId.String()+"/documents/"+p.DocumentId.String(), nil, nil, nil)
	mustCode(t, "delete document", code, e, 200, "")
	if _, _, p = citedPassage(t, env.member, msg, "1"); p.Status != "document_deleted" || len(p.Passages) != 0 || p.Title == "" {
		t.Fatalf("deleted = %+v", p)
	}
	if code, e := env.editor.call("GET", text, nil, nil, nil); code != 404 {
		t.Errorf("deleted document's text = %d %s", code, e)
	}
}

// TestPublicCitedPassage: an anonymous session reads the passages its own
// answers cited, and nobody else's.
func TestPublicCitedPassage(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open viewer")
	v := newVisitor(t, env.app.URL)
	v.start(pub.Id, "", "")
	code, evs, e := v.ask(pub.Id, "Where do students buy a parking permit?")
	if code != 200 {
		t.Fatalf("chat = %d %s", code, e)
	}
	var end agents.MessageEndEvent
	evs.one(t, "message_end", &end)
	path := "/v1/public/agents/" + pub.Id.String() + "/messages/" + end.MessageID.String() + "/sources/1"
	var p apitypes.CitedPassage
	if code, e := v.call("GET", path, nil, &p); code != 200 || p.Status != "available" || citedText(p) == "" || p.DocumentTeam != nil {
		t.Fatalf("own passage = %d %s %+v", code, e, p)
	}
	other := newVisitor(t, env.app.URL)
	other.start(pub.Id, "", "")
	if code, e := other.call("GET", path, nil, nil); code != 404 || e != "message_not_found" {
		t.Errorf("another visitor = %d %s", code, e)
	}
	if code, _ := newVisitor(t, env.app.URL).call("GET", path, nil, nil); code != 401 {
		t.Errorf("without a session = %d", code)
	}
	// Signed-in readers don't reach anonymous answers either.
	if code, e, _ := citedPassage(t, env.owner, end.MessageID.String(), "1"); code != 404 {
		t.Errorf("signed in = %d %s", code, e)
	}
}

// TestCitedPassageClaims: the claims citing a source come with its passage.
func TestCitedPassageClaims(t *testing.T) {
	env, _ := claimsEnv(t)
	ans := askFor(t, env.member, env.chatPath("fees"), "What does a transcript cost?")
	for n, want := range map[string][]string{
		"1": {"supported: Official transcripts cost ten dollars per copy.", "not_supported: Rush orders UNSUPPORTED arrive the same day."},
		"2": {"supported: Official transcripts cost ten dollars per copy."},
	} {
		_, _, p := citedPassage(t, env.member, ans.MessageId.String(), n)
		if got := claimView(&p.Claims); !slicesEqual(got, want) || p.Status != "available" {
			t.Errorf("source %s claims = %q (%s)", n, got, p.Status)
		}
	}
}
