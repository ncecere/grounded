package httpapi_test

import (
	"fmt"
	"testing"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/kbs"
)

// An old worker still moves kept rows to negative ordinals before assigning
// their new positions. A new range constraint must not break that writer.
func TestParentReviewOldWorkerCanReorderRows(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	tx, err := env.app.Pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context()) // the fixture's live rows remain unchanged
	for range 2 {
		if _, err := tx.Exec(t.Context(), `UPDATE chunks SET ordinal = -1 - ordinal WHERE source_id = $1 AND profile_id = $2`, env.source.Id, env.profile.Id); err != nil {
			t.Fatalf("old-worker ordinal transition rejected on parent schema: %v", err)
		}
	}
}

// Agent evaluation must score the same child ranking as passage retrieval,
// not the sibling-collapsed ranking used to assemble a generation prompt.
func TestParentReviewEvaluationKeepsChildRanking(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	question := "parking0x parking1x parking2x parking3x"
	_, want := env.search(t, env.kbOn.Id, question, 4, false, kbs.MetadataFilter{})
	if len(want) != 4 || env.distinctParents(env.rows(t, env.source.Id, env.profile.Id), want) >= 4 {
		t.Fatal("fixture must return four children including siblings")
	}
	target, err := env.app.Svc.Agents.LoadEvalTarget(t.Context(), env.agent.Id, true)
	if err != nil {
		t.Fatal(err)
	}
	got, err := env.app.Svc.Agents.EvalRetrieve(t.Context(), authz.Actor{UserID: env.editor.me.User.Id}, target, question, 4, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Fatalf("evaluation has %d hits, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i].ChunkID != want[i].ChunkID || got[i].Parent != nil {
			t.Errorf("evaluation rank %d = %s parent=%+v, want child %s", i, got[i].ChunkID, got[i].Parent, want[i].ChunkID)
		}
	}
}

func TestParentReviewViewerRejectsNarrowingOverflow(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	end := env.ask(t, "What does the parking3x rule say?")
	c := end.Citations[0]
	if c.Parent == nil || c.ChunkId == nil {
		t.Fatal("fixture has no parent citation")
	}
	for _, n := range []string{"2147483648", "4294967296", "9223372036854775808"} {
		path := fmt.Sprintf("%s/sources/%s/documents/%s/text?around=%s&parentFirst=%s&parentLast=%s&parentSha256=%s", env.base, c.SourceId, c.DocumentId, c.ChunkId, n, n, c.Parent.Sha256)
		code, e := env.editor.call("GET", path, nil, nil, nil)
		mustCode(t, "overflow "+n, code, e, 400, "invalid_parent")
	}
}

// Parent context is an input to generation, not a grant of more verbatim
// source text to members, anonymous sessions or public share recipients.
func TestParentReviewCitedViewersKeepExistingWindow(t *testing.T) {
	pub := newPublishEnv(t)
	env := &parentEnv{agentEnv: pub.agentEnv}
	ix := env.addIndex(t, "large-parents", 4096, 24)
	env.profile, env.source, env.kbOn = ix.profile, ix.source, ix.kb
	pub.setPublic(t, true)
	pub.publicPolicy(t)
	ag := pub.draftAgent(t, "Public parent help", ix.kb.Id.String(), "public")
	if code, raw := pub.publish(env.tadmin, ag); code != 201 {
		t.Fatalf("publish = %d %s", code, raw)
	}
	question := "What does the parking12x rule say?"
	check := func(label string, code int, view apitypes.CitedPassage, citation apitypes.Citation) {
		t.Helper()
		if code != 200 || view.Status != "available" || view.Parent == nil {
			t.Fatalf("%s viewer = %d %+v", label, code, view)
		}
		if view.Parent.Passages <= 7 {
			t.Fatalf("%s fixture parent only has %d passages", label, view.Parent.Passages)
		}
		if len(view.Passages) > 7 || len(view.Passages) >= int(view.Parent.Passages) {
			t.Errorf("%s viewer exposed %d of %d parent passages, want bounded child context", label, len(view.Passages), view.Parent.Passages)
		}
		cited := 0
		for _, p := range view.Passages {
			if p.Cited {
				cited++
			}
		}
		if citation.ChunkId == nil {
			t.Fatal("fixture citation has no matched chunk ID")
		}
		// The fake model is not a quality oracle: bind the view to the child
		// that actually ranked, not to an assumed keyword match.
		var stored string
		if err := env.app.Pool.QueryRow(t.Context(), `SELECT content FROM chunks WHERE id = $1 AND document_id = $2`, citation.ChunkId, citation.DocumentId).Scan(&stored); err != nil {
			t.Fatal(err)
		}
		if cited != 1 || citedText(view) != stored {
			t.Errorf("%s: cited=%d, matched text=%q, want actual child %q", label, cited, citedText(view), stored)
		}
	}
	answer := askFor(t, env.member, env.chatPath(ag.Slug), question)
	if answer.ConversationId == nil {
		t.Fatal("no stored conversation")
	}
	var memberView apitypes.CitedPassage
	code := env.member.get("/v1/messages/"+answer.MessageId.String()+"/sources/1", &memberView)
	check("member", code, memberView, answer.Citations[0])

	anon := newVisitor(t, env.app.URL)
	anon.start(ag.Id, "", "")
	code, events, e := anon.ask(ag.Id, question)
	mustCode(t, "anonymous chat", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	events.one(t, "message_end", &end)
	var anonView apitypes.CitedPassage
	code, e = anon.call("GET", "/v1/public/agents/"+ag.Id.String()+"/messages/"+end.MessageId.String()+"/sources/1", nil, &anonView)
	mustCode(t, "anonymous viewer", code, e, 200, "")
	check("anonymous", code, anonView, end.Citations[0])

	var share apitypes.ConversationShareCreated
	code, e = env.member.call("POST", "/v1/conversations/"+answer.ConversationId.String()+"/shares", map[string]any{"audience": "anyone"}, &share, nil)
	mustCode(t, "public share", code, e, 201, "")
	var sharedView apitypes.CitedPassage
	code, e = anon.call("GET", "/v1/shared/"+share.Token+"/messages/"+answer.MessageId.String()+"/sources/1", nil, &sharedView)
	mustCode(t, "public shared viewer", code, e, 200, "")
	check("public share", code, sharedView, answer.Citations[0])
}
