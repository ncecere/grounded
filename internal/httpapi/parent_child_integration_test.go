package httpapi_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The parent size is a setting of the embedding profile: 0 (the default) is off, anything else is at least two passages and at most 8192
// tokens, and it is fixed once the profile exists, like the chunker (#20).
func TestParentTokensIsAProfileSetting(t *testing.T) {
	env := newMigEnv(t)
	base := func() map[string]any {
		return map[string]any{"name": "P", "modelId": env.from.Model.Id, "chunkSize": 128, "chunkOverlap": 16}
	}
	with := func(key string, parent any) map[string]any {
		b := base()
		b["key"] = key
		if parent != nil {
			b["parentTokens"] = parent
		}
		return b
	}
	if env.from.ParentTokens != 0 {
		t.Errorf("an existing profile has parentTokens %d, want 0", env.from.ParentTokens)
	}
	if p := env.newProfile(t, "no-parent", with("no-parent", nil), 201, ""); p.ParentTokens != 0 {
		t.Errorf("a profile that does not ask has parentTokens %d", p.ParentTokens)
	}
	if p := env.newProfile(t, "zero-parent", with("zero-parent", 0), 201, ""); p.ParentTokens != 0 {
		t.Errorf("parentTokens 0 made %d", p.ParentTokens)
	}
	p := env.newProfile(t, "parent-512", with("parent-512", 512), 201, "")
	if p.ParentTokens != 512 {
		t.Errorf("parentTokens = %d, want 512", p.ParentTokens)
	}
	// Two passages is the smallest parent, and 8192 the largest.
	env.newProfile(t, "parent-256", with("parent-256", 256), 201, "")
	for _, bad := range []any{255, 1, -1, 8193, 100000} {
		env.newProfile(t, fmt.Sprintf("bad-%v", bad), with(fmt.Sprintf("bad-%v", bad), bad), 400, "invalid_parent_tokens")
	}
	big := with("big", 8192)
	big["chunkSize"], big["chunkOverlap"] = 4097, 0
	env.newProfile(t, "big", big, 400, "invalid_parent_tokens") // 8192 is less than two passages of 4097
	// Fixed once created: the field is not updatable.
	code, e := env.admin.call("PATCH", "/v1/admin/embedding-profiles/"+p.Id.String(), map[string]any{"parentTokens": 0, "name": "Renamed"}, nil, ifMatch(p.Revision))
	mustCode(t, "patch parentTokens", code, e, 400, "invalid_json")
	if got := env.profileByID(t, p.Id); got.ParentTokens != 512 {
		t.Errorf("the setting changed after creation: %d", got.ParentTokens)
	}
	// The audit log's snapshot carries it.
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.embedding_profile_create' AND target_id = $1 AND after_state->>'parentTokens' = '512'`, p.Id.String()); n != 1 {
		t.Errorf("audit rows with the parent size = %d, want 1", n)
	}
}

// Passages of a profile with parents record their parent as consecutive ordinals: every passage is in the range it records, ranges tile the
// document, hold one heading path and stay within the profile's size. A profile without parents records none (#20).
func TestParentRangesAreWrittenWithThePassages(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	rows := env.rows(t, env.source.Id, env.profile.Id)
	if len(rows) < 12 {
		t.Fatalf("the handbook made %d passages; the fixture should make at least one per paragraph", len(rows))
	}
	checkRanges(t, rows)
	multi := 0
	for i, r := range rows {
		if r.First == nil || r.Last == nil || *r.First > r.Ordinal || r.Ordinal > *r.Last {
			t.Fatalf("passage %d has range %v-%v", r.Ordinal, r.First, r.Last)
		}
		if i > 0 && r.Ordinal == rows[i-1].Ordinal+1 && *r.First != *rows[i-1].First && *r.First != rows[i-1].Ordinal+1 {
			t.Errorf("passages %d and %d: ranges %d-%d and %d-%d overlap or leave a gap", rows[i-1].Ordinal, r.Ordinal, *rows[i-1].First, *rows[i-1].Last, *r.First, *r.Last)
		}
		sum := int32(0)
		for _, k := range rows[*r.First : *r.Last+1] {
			sum += k.Tokens
		}
		if sum > 512 && *r.Last > *r.First {
			t.Errorf("the parent %d-%d has %d tokens, over the profile's 512", *r.First, *r.Last, sum)
		}
		if *r.Last > *r.First {
			multi++
		}
	}
	if multi == 0 {
		t.Error("no passage has a parent of more than one passage: the fixture does not exercise parents")
	}
	// The default profile's source, indexed before and without the setting, has no ranges at all.
	def := env.scalar(t, `SELECT count(*) FROM chunks c JOIN data_sources s ON s.id = c.source_id WHERE s.id = $1 AND (c.parent_first IS NOT NULL OR c.parent_last IS NOT NULL)`, env.upload.Id)
	all := env.scalar(t, `SELECT count(*) FROM chunks WHERE source_id = $1`, env.upload.Id)
	if def != 0 || all == 0 {
		t.Errorf("a source on a profile without parents has %d passages, %d with a range", all, def)
	}
}

// The matched passage ranks and the parent is given to generation. Its hash
// binds the editor section view; cited viewers retain bounded child context.
func TestAnAnswerIsGivenTheParentAndCitesIt(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	rows := env.rows(t, env.source.Id, env.profile.Id)
	end := env.ask(t, "What does the parking3x rule say?")
	if len(end.Citations) != 1 || end.Citations[0].Parent == nil || end.Citations[0].ChunkId == nil {
		t.Fatalf("citations = %+v", end.Citations)
	}
	c, p := end.Citations[0], *end.Citations[0].Parent
	var matched *parentRow
	for i := range rows {
		if rows[i].ID == *c.ChunkId {
			matched = &rows[i]
		}
	}
	if matched == nil || !strings.Contains(matched.Content, "parking3x") {
		t.Fatalf("the cited passage %v is not the one with the word asked about: %+v", c.ChunkId, matched)
	}
	if p.First != *matched.First || p.Last != *matched.Last || p.Passages != p.Last-p.First+1 || p.Passages < 2 || p.Matched < 1 || len(p.Sha256) != 64 {
		t.Fatalf("parent = %+v, passage %d has range %d-%d", p, matched.Ordinal, *matched.First, *matched.Last)
	}
	// The model was given the whole parent as source 1: a word from every passage of the range, and nothing of the other section.
	sources := env.lastSources(t)
	body := sourceBody(t, sources, 1)
	for _, r := range rows[p.First : p.Last+1] {
		if !strings.Contains(body, strings.Fields(r.Content)[1]) { // each paragraph starts "The <word> rule"
			t.Errorf("the model was not given passage %d (%q)", r.Ordinal, r.Content[:40])
		}
	}
	if strings.Contains(body, "housing") {
		t.Error("the model was given text of the other section")
	}
	if !strings.Contains(c.Snippet, "rule applies to every student") && !strings.Contains(c.Snippet, "parking") {
		t.Errorf("snippet = %q", c.Snippet)
	}

	// The cited viewer records parent provenance but grants no larger text window.
	var cited apitypes.CitedPassage
	if code := env.member.get("/v1/messages/"+end.MessageId.String()+"/sources/1", &cited); code != 200 {
		t.Fatalf("viewer = %d", code)
	}
	if string(cited.Status) != "available" || cited.Parent == nil || cited.Parent.Sha256 != p.Sha256 || len(cited.Passages) > 7 {
		t.Fatalf("viewer = %+v", cited)
	}
	for i, ps := range cited.Passages {
		if ps.Cited != (ps.Ordinal == matched.Ordinal) || (ps.Matched != nil && *ps.Matched) != ps.Cited {
			t.Errorf("viewer passage %d = %+v", i, ps)
		}
	}
	// The full, hash-validated section is still available to an editor through
	// the document-text route. It, not the cited viewer, matches the source body.
	path := fmt.Sprintf("%s/sources/%s/documents/%s/text?around=%s&parentFirst=%d&parentLast=%d&parentSha256=%s", env.base, c.SourceId, c.DocumentId, c.ChunkId, p.First, p.Last, p.Sha256)
	var full apitypes.DocumentText
	if code := env.editor.get(path, &full); code != 200 || len(full.Items) != int(p.Passages) {
		t.Fatalf("editor section = %d %+v", code, full)
	}
	parts := make([]string, len(full.Items))
	for i, ps := range full.Items {
		parts[i] = ps.Content
		if !ps.Cited || ps.Ordinal != p.First+int32(i) {
			t.Errorf("editor section passage %d = %+v", i, ps)
		}
	}
	shown := strings.Join(parts, "\n\n")
	if shown != body {
		t.Errorf("the viewer's text is not the text the model was given:\n viewer: %q\n model: %q", shown, body)
	}
}

// The same answer from every way in: stream, no stream, and the OpenAI-compatible endpoint give the model the parent and cite it (#20).
func TestEveryAnswerPathGivesTheParent(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	model := "agent:" + env.team + "/" + env.agent.Slug
	var k apitypes.APIKeyCreated
	code, e := env.member.call("POST", env.base+"/api-keys", map[string]any{"name": "sdk", "scopes": []string{"query"}}, &k, nil)
	mustCode(t, "key", code, e, 201, "")
	q := "What does the housing2x rule say?"

	check := func(path string, cites []apitypes.Citation) {
		t.Helper()
		if len(cites) != 1 || cites[0].Parent == nil || cites[0].Parent.Passages < 2 {
			t.Fatalf("%s: citations = %+v", path, cites)
		}
		givenParent(t, path, sourceBody(t, env.lastSources(t), int(cites[0].N)), cites[0])
	}
	// Streaming.
	check("stream", env.ask(t, q).Citations)
	// Not streaming.
	var ans apitypes.ChatAnswer
	code, e = env.member.call("POST", env.chatPath(env.agent.Slug), map[string]any{"message": q, "stream": false}, &ans, nil)
	mustCode(t, "no stream", code, e, 200, "")
	check("json", ans.Citations)
	// OpenAI-compatible, without streaming (the citations come with the completion) and with it (the model is given the same parent).
	code, raw, _ := openaiCall(t, env.app.URL, k.Secret, map[string]any{"model": model, "messages": []map[string]string{{"role": "user", "content": q}}})
	var comp struct{ Citations []apitypes.Citation }
	if code != 200 || json.Unmarshal(raw, &comp) != nil {
		t.Fatalf("completion = %d %s", code, raw)
	}
	check("openai", comp.Citations)
	before := len(env.proxy.ChatRequests())
	code, raw, _ = openaiCall(t, env.app.URL, k.Secret, map[string]any{"model": model, "stream": true, "messages": []map[string]string{{"role": "user", "content": q}}})
	if code != 200 || len(env.proxy.ChatRequests()) <= before {
		t.Fatalf("streamed completion = %d %.300s", code, raw)
	}
	givenParent(t, "openai stream", sourceBody(t, env.lastSources(t), 1), apitypes.Citation{Parent: &apitypes.CitationParent{Passages: -1}})
}

// givenParent fails unless the source text the model received holds the whole parent the citation records: one paragraph per passage of it (or,
// for a stream that returns no citation record here, at least two).
func givenParent(t *testing.T, path, body string, c apitypes.Citation) {
	t.Helper()
	n := strings.Count(body, "rule applies to every student")
	if c.Parent.Passages < 0 && n >= 2 || c.Parent.Passages >= 2 && n == int(c.Parent.Passages) {
		return
	}
	t.Errorf("%s: the model was given %d paragraphs for a parent of %d passages: %.300s", path, n, c.Parent.Passages, body)
}

// A profile without parents answers exactly as before: no range on any passage, the model is given the passage and nothing else, and the
// citation has no parent (#20, off by default).
func TestWithoutParentsNothingChanges(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Student help", env.agentConfig(env.kb.Id.String()))
	code, evs, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Where do students buy a parking permit?"})
	mustCode(t, "chat", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if len(end.Citations) != 1 || end.Citations[0].Parent != nil {
		t.Fatalf("citations = %+v", end.Citations)
	}
	var raw struct{ Citations []map[string]any }
	for _, ev := range evs.all("message_end") {
		_ = json.Unmarshal(ev.data, &raw)
	}
	for _, c := range raw.Citations {
		if _, ok := c["parent"]; ok {
			t.Errorf("a citation without parents carries a parent key: %v", c)
		}
	}
	if n := env.scalar(t, `SELECT count(*) FROM chunks WHERE parent_first IS NOT NULL OR parent_last IS NOT NULL`); n != 0 {
		t.Errorf("%d passages have a parent range on an install without the setting", n)
	}
	// The source is the matched passage, whole, as stored.
	var stored string
	if err := env.app.Pool.QueryRow(t.Context(), `SELECT content FROM chunks WHERE id = $1`, end.Citations[0].ChunkId).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	reqs := env.proxy.ChatRequests()
	last := string(reqs[len(reqs)-1])
	if !strings.Contains(lastSources(t, env.proxy), strings.TrimSpace(stored)) {
		t.Errorf("the model was not given the stored passage as it is: %q in %.400s", stored, last)
	}
}
