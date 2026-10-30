package httpapi_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/kbs"
)

// search runs a knowledge base's own search as an agent does (CollapseParents) or as /retrieve does, and returns the resolved KB too.
func (env *parentEnv) search(t *testing.T, kbID uuid.UUID, q string, k int, collapse bool, f kbs.MetadataFilter) (kbs.KB, []kbs.Hit) {
	t.Helper()
	resolved, err := env.app.Svc.KBs.ResolveKBs(context.Background(), []uuid.UUID{kbID})
	if err != nil || len(resolved) != 1 {
		t.Fatalf("resolve = %v %v", resolved, err)
	}
	res, err := env.app.Svc.KBs.Search(context.Background(), resolved[0], kbs.SearchParams{Text: q, TopK: k, Filter: f, User: "test", CollapseParents: collapse})
	if err != nil {
		t.Fatal(err)
	}
	return resolved[0], res.Hits
}

func hitPtrs(hits []kbs.Hit) []*kbs.Hit {
	out := make([]*kbs.Hit, len(hits))
	for i := range hits {
		out[i] = &hits[i]
	}
	return out
}

// distinctParents counts the parents the hits are in, by the ranges stored on their rows.
func (env *parentEnv) distinctParents(rows []parentRow, hits []kbs.Hit) int {
	byID := map[uuid.UUID]parentRow{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	seen := map[string]bool{}
	for _, h := range hits {
		r := byID[h.ChunkID]
		seen[fmt.Sprintf("%s/%d", r.Document, *r.First)] = true
	}
	return len(seen)
}

// Several passages of one section that all match do not take the places of other matches: the search returns as many distinct parents as it
// was asked for, in the order of their best passage, and says how many passages each stands for (#20, ranking and deduplication).
func TestSiblingsDoNotCrowdOutOtherMatches(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	rows := env.rows(t, env.source.Id, env.profile.Id)
	q := "parking0x parking1x parking2x parking3x"

	_, plain := env.search(t, env.kbOn.Id, q, 4, false, kbs.MetadataFilter{})
	_, collapsed := env.search(t, env.kbOn.Id, q, 4, true, kbs.MetadataFilter{})
	if len(plain) != 4 || len(collapsed) != 4 {
		t.Fatalf("hits: %d without collapse, %d with", len(plain), len(collapsed))
	}
	if got := env.distinctParents(rows, plain); got >= 4 {
		t.Fatalf("without collapse the four best passages are in %d parents; the question should make siblings crowd", got)
	}
	if got := env.distinctParents(rows, collapsed); got != 4 {
		t.Errorf("with collapse the hits are in %d distinct parents, want 4", got)
	}
	// The best-ranked passage leads, as without collapse, and stands for its siblings.
	if collapsed[0].ChunkID != plain[0].ChunkID || collapsed[0].Parent == nil || collapsed[0].Parent.Matched < 2 {
		t.Errorf("first hit %v (parent %v), plain first %v", collapsed[0].ChunkID, collapsed[0].Parent, plain[0].ChunkID)
	}
	for _, h := range collapsed {
		if h.Parent == nil || h.Parent.Text != "" || h.Parent.ProfileID != env.profile.Id {
			t.Errorf("a collapsed hit has parent %+v (the text is built later, by ExpandParents)", h.Parent)
		}
	}
	// The ranking of passages is the same with and without the setting: the same KB content on a profile without parents, asked as /retrieve does.
	plainIx := env.addIndex(t, "plain", 0, 6)
	for _, query := range []string{q, "housing4x", "visitor registrar committee", "exceptions for part-time students", "parking5x housing0x"} {
		_, with := env.search(t, env.kbOn.Id, query, 6, false, kbs.MetadataFilter{})
		_, without := env.search(t, plainIx.kb.Id, query, 6, false, kbs.MetadataFilter{})
		if len(with) != len(without) {
			t.Fatalf("%q: %d hits with parents, %d without", query, len(with), len(without))
		}
		for i := range with {
			if with[i].Content != without[i].Content || with[i].Parent != nil {
				t.Errorf("%q: hit %d differs: %q vs %q (parent %v)", query, i, with[i].Content, without[i].Content, with[i].Parent)
			}
		}
	}
}

// ExpandParents reads nothing the search could not: not another profile's rows, not a source outside the knowledge base or the agent's
// filter, not a document that is not ready; and a range that its rows do not bear out is refused (#20, permissions).
func TestExpansionNeverWidensTheSearch(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	// A second source in the same KB makes "outside the search's sources" meaningful.
	other := env.addIndex(t, "other", 512, 6)
	ctx := context.Background()
	expand := func(kb kbs.KB, f kbs.MetadataFilter, hits []kbs.Hit) {
		t.Helper()
		if err := env.app.Svc.KBs.ExpandParents(ctx, kb, f, hitPtrs(hits)); err != nil {
			t.Fatal(err)
		}
	}
	fresh := func() (kbs.KB, []kbs.Hit) {
		kb, hits := env.search(t, env.kbOn.Id, "parking3x", 3, true, kbs.MetadataFilter{})
		if len(hits) == 0 || hits[0].Parent == nil {
			t.Fatalf("hits = %+v", hits)
		}
		return kb, hits
	}
	skipped := func(why string, hits []kbs.Hit, want kbs.SkipReason) {
		t.Helper()
		checked := 0
		defer func() {
			if checked == 0 {
				t.Errorf("%s: no hit of the first source was checked", why)
			}
		}()
		for _, h := range hits {
			if h.SourceID != env.source.Id { // hits of the second source may be expanded: only the first one is out of scope in these cases
				continue
			}
			checked++
			if h.Parent != nil && (h.Parent.Text != "" || h.Parent.Skipped != want) {
				t.Errorf("%s: hit %v has parent text %q, skipped %q; want none, %q", why, h.ChunkID, h.Parent.Text, h.Parent.Skipped, want)
			}
		}
	}

	// The control: the same call expands.
	kb, hits := fresh()
	expand(kb, kbs.MetadataFilter{}, hits)
	if hits[0].Parent.Text == "" || hits[0].Parent.Skipped != kbs.SkipNone {
		t.Fatalf("control: %+v", hits[0].Parent)
	}

	// The search's filter leaves the hit's source out: nothing is read. The KB has a second source on the same profile, so the filter is not
	// empty, and the query itself (not only the check before it) has to keep the hit's rows out.
	var second apitypes.DataSource
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": "Second", "classification": "open", "embeddingProfileId": env.profile.Id}, &second, nil)
	mustCode(t, "second source", code, e, 201, "")
	env.uploadHandbook(t, second.Id, "second.md", strings.ReplaceAll(parentDoc(6), "parking", "garage"))
	code, e = env.owner.call("PUT", env.base+"/kbs/"+env.kbOn.Id.String()+"/sources/"+second.Id.String(), nil, nil, nil)
	mustCode(t, "attach the second source", code, e, 200, "")
	kb, hits = fresh()
	if len(kb.Sources) != 2 {
		t.Fatalf("the KB has %d sources", len(kb.Sources))
	}
	expand(kb, kbs.MetadataFilter{SourceIDs: []uuid.UUID{second.Id}}, hits)
	skipped("filter", hits, kbs.SkipIncomplete)
	kb.Sources = []kbs.SourceRef{{ID: second.Id}} // the KB lost the hit's source after the search, and has another
	expand(kb, kbs.MetadataFilter{}, hits)
	skipped("source detached", hits, kbs.SkipIncomplete)

	// No sources at all: nothing is read.
	kb, hits = fresh()
	kb.Sources = nil
	expand(kb, kbs.MetadataFilter{}, hits)
	skipped("no sources", hits, kbs.SkipIncomplete)

	// Another knowledge base, on another profile, cannot expand these hits.
	kb, hits = fresh()
	otherKB, _ := env.search(t, other.kb.Id, "parking3x", 3, true, kbs.MetadataFilter{})
	expand(otherKB, kbs.MetadataFilter{}, hits)
	for _, h := range hits {
		if h.Parent.Text != "" {
			t.Errorf("a knowledge base on another profile expanded a hit of this one: %q", h.Parent.Text)
		}
	}
	_ = kb

	// A document that is not ready (re-processing, failed, deleted) has no parent text.
	kb, hits = fresh()
	env.sql(t, `UPDATE documents SET status = 'failed' WHERE source_id = $1`, env.source.Id)
	expand(kb, kbs.MetadataFilter{}, hits)
	skipped("document not ready", hits, kbs.SkipIncomplete)
	env.sql(t, `UPDATE documents SET status = 'ready' WHERE source_id = $1`, env.source.Id)

	// A range that reaches past the passages the search saw, forged on the hit's row alone, is refused: the rows are not the range.
	kb, hits = fresh()
	id, first, last := hits[0].ChunkID, hits[0].Parent.First, hits[0].Parent.Last
	env.sql(t, `UPDATE chunks SET parent_last = $2 WHERE id = $1`, id, last+30)
	expand(kb, kbs.MetadataFilter{}, hits[:1])
	skipped("forged range", hits[:1], kbs.SkipIncomplete)
	env.sql(t, `UPDATE chunks SET parent_last = $2 WHERE id = $1`, id, last)

	// A sibling that records another range than the hit means the document was cut again since the search: refused.
	kb, hits = fresh()
	sibling := first + 1
	if env.scalar(t, `SELECT ordinal FROM chunks WHERE id = $1`, id) == int64(sibling) {
		sibling = first
		env.sql(t, `UPDATE chunks SET parent_last = $2 WHERE document_id = (SELECT document_id FROM chunks WHERE id = $1) AND ordinal = $3 AND profile_id = $4`, id, first, sibling, env.profile.Id)
	} else {
		env.sql(t, `UPDATE chunks SET parent_first = $2 WHERE document_id = (SELECT document_id FROM chunks WHERE id = $1) AND ordinal = $2 AND profile_id = $3`, id, sibling, env.profile.Id)
	}
	expand(kb, kbs.MetadataFilter{}, hits[:1])
	skipped("sibling disagrees", hits[:1], kbs.SkipStale)

	// Other documents of the source are never read: a passage of the second source's document gets its own document's text only.
	kb, hits = env.search(t, env.kbOn.Id, "garage2x", 3, true, kbs.MetadataFilter{})
	expand(kb, kbs.MetadataFilter{}, hits)
	if hits[0].Parent == nil || hits[0].Parent.Text == "" || strings.Contains(hits[0].Parent.Text, "parking") || !strings.Contains(hits[0].Parent.Text, "garage") {
		t.Errorf("the parent of a passage of the second document = %+v", hits[0].Parent)
	}
}

// sql runs a statement as the database owner.
func (env *agentEnv) sql(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := env.app.Pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// A document that changes or goes after an answer was written is never shown as the section the answer used: the viewer says so (#20,
// missing, deleted and stale parents).
func TestViewerRefusesAParentThatChanged(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	ask := func() (apitypes.ChatEventMessageEnd, apitypes.CitedPassage) {
		end := env.ask(t, "What does the parking3x rule say?")
		var cited apitypes.CitedPassage
		if code := env.member.get("/v1/messages/"+end.MessageId.String()+"/sources/1", &cited); code != 200 {
			t.Fatalf("viewer = %d", code)
		}
		return end, cited
	}
	_, cited := ask()
	if string(cited.Status) != "available" || cited.Parent == nil {
		t.Fatalf("viewer = %+v", cited)
	}

	// The same file uploaded again is unchanged: its passages are the same, and the section is still the cited one.
	end := env.ask(t, "What does the parking3x rule say?")
	if st := env.uploadStatus(t, env.source.Id, "handbook.md", parentDoc(6)); st != "unchanged" {
		t.Fatalf("the same file uploaded again was %s", st)
	}
	var again apitypes.CitedPassage
	if code := env.member.get("/v1/messages/"+end.MessageId.String()+"/sources/1", &again); code != 200 || string(again.Status) != "available" {
		t.Fatalf("after an unchanged upload: %d %+v", code, again.Status)
	}

	// Another passage of the same section is edited: the section the model read is gone, though the matched passage is still there.
	edited := strings.Replace(parentDoc(6), "parking2x rule applies", "parking2x rule no longer applies", 1)
	env.uploadHandbook(t, env.source.Id, "handbook.md", edited)
	var changed apitypes.CitedPassage
	if code := env.member.get("/v1/messages/"+end.MessageId.String()+"/sources/1", &changed); code != 200 {
		t.Fatalf("viewer = %d", code)
	}
	checkRanges(t, env.rows(t, env.source.Id, env.profile.Id)) // the replaced document's passages carry ranges of their own, not the old ones
	if string(changed.Status) != "passage_changed" || len(changed.Passages) != 0 || changed.Parent == nil {
		t.Errorf("after the section was edited: %+v", changed)
	}
	for _, p := range changed.Passages {
		if strings.Contains(p.Content, "no longer applies") {
			t.Error("the viewer showed the new text as the cited section")
		}
	}

	// A new answer from the new text is fine; deleting the document then says so.
	end2, fresh := ask()
	if string(fresh.Status) != "available" {
		t.Fatalf("a new answer's viewer = %+v", fresh.Status)
	}
	env.deleteFrom(t, env.source.Id, "handbook.md")
	var gone apitypes.CitedPassage
	if code := env.member.get("/v1/messages/"+end2.MessageId.String()+"/sources/1", &gone); code != 200 || string(gone.Status) != "document_deleted" {
		t.Fatalf("after the document was deleted: %d %+v", code, gone.Status)
	}
	if n := env.scalar(t, `SELECT count(*) FROM chunks WHERE source_id = $1`, env.source.Id); n != 0 {
		t.Errorf("%d passages are left of a deleted document", n)
	}
}

// A parent too large for the answer's context budget is not cut: the model is given the passage and the citation has no parent. A platform
// switch turns parents off without touching the index (#20, hard bounds and rollback).
func TestBudgetAndSwitchFallBackToPassages(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	cfg := env.agentConfig(env.kbOn.Id.String())
	cfg["contextTokenBudget"] = 500
	small := env.publishAgent(t, "Small budget", cfg)
	code, evs, e := env.member.stream(env.chatPath(small.Slug), map[string]any{"message": "What does the parking3x rule say?"})
	mustCode(t, "chat", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if len(end.Citations) == 0 || end.Citations[0].Parent != nil || end.Citations[0].ChunkId == nil {
		t.Fatalf("citations = %+v", end.Citations)
	}
	body := sourceBody(t, env.lastSources(t), 1)
	if strings.Contains(body, "parking2x") || !strings.Contains(body, "parking3x") {
		t.Errorf("the model was given %q, want the passage alone", body)
	}

	off := newParentEnvWith(t, func(c *config.Config) { c.ParentExpansion = false }, 512, 6)
	if len(off.rows(t, off.source.Id, off.profile.Id)) == 0 || off.rows(t, off.source.Id, off.profile.Id)[0].First == nil {
		t.Fatal("the index of the profile with parents has no ranges (the switch must not change what is indexed)")
	}
	end = off.ask(t, "What does the parking3x rule say?")
	if len(end.Citations) == 0 || end.Citations[0].Parent != nil {
		t.Fatalf("with the switch off: %+v", end.Citations)
	}
	if body := sourceBody(t, off.lastSources(t), 1); strings.Contains(body, "parking2x") && strings.Contains(body, "parking4x") {
		t.Errorf("with the switch off the model was given a parent: %q", body)
	}
	_, hits := off.search(t, off.kbOn.Id, "parking3x", 3, true, kbs.MetadataFilter{})
	for _, h := range hits {
		if h.Parent != nil {
			t.Error("a search with the switch off collapsed parents")
		}
	}
}

// A huge section is cut into parents of at most the profile's size: whichever passage matches, the model is given at most that, never the
// section (#20, huge parents).
func TestAHugeSectionIsBounded(t *testing.T) {
	env := newParentEnv(t, 256, 30)
	rows := env.rows(t, env.source.Id, env.profile.Id)
	widest := int32(0)
	for _, r := range rows {
		widest = max(widest, *r.Last-*r.First+1)
	}
	if widest != 2 {
		t.Fatalf("the widest parent has %d passages; 256 tokens hold two of 128", widest)
	}
	for _, q := range []string{"parking0x", "parking17x", "housing29x"} {
		end := env.ask(t, "What does the "+q+" rule say?")
		if len(end.Citations) == 0 || end.Citations[0].Parent == nil {
			t.Fatalf("%s: citations = %+v", q, end.Citations)
		}
		body := sourceBody(t, env.lastSources(t), 1)
		if p := end.Citations[0].Parent; p.Passages > 2 || len(body) > 256*8 {
			t.Errorf("%s: the model was given %d passages, %d characters", q, p.Passages, len(body))
		}
	}
}

// Try it and the widget preview read a cited section through the team's document endpoint, by the range and the hash of its text: the team's
// editors only, and only while the document still has exactly that text (#20).
func TestTeamEndpointReadsASectionByItsHash(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	end := env.ask(t, "What does the parking3x rule say?")
	c := end.Citations[0]
	if c.Parent == nil || c.ChunkId == nil {
		t.Fatalf("citation = %+v", c)
	}
	path := fmt.Sprintf("%s/sources/%s/documents/%s/text", env.base, c.SourceId, c.DocumentId)
	query := func(sha string) string {
		return fmt.Sprintf("%s?around=%s&parentFirst=%d&parentLast=%d&parentSha256=%s", path, c.ChunkId, c.Parent.First, c.Parent.Last, sha)
	}

	var text apitypes.DocumentText
	if code := env.editor.get(query(c.Parent.Sha256), &text); code != 200 || len(text.Items) != int(c.Parent.Passages) {
		t.Fatalf("section = %d, %d passages", code, len(text.Items))
	}
	var joined []string
	for _, p := range text.Items {
		joined = append(joined, p.Content)
		if !p.Cited || (p.Matched != nil && *p.Matched) != strings.Contains(p.Content, "parking3x") {
			t.Errorf("passage %d: cited %v matched %v", p.Ordinal, p.Cited, p.Matched)
		}
	}
	if got, want := strings.Join(joined, "\n\n"), sourceBody(t, env.lastSources(t), 1); got != want {
		t.Errorf("the endpoint's text is not what the model was given:\n got  %q\n want %q", got, want)
	}

	// Another hash, and a half-named parent, are refused; members never open documents this way.
	code, e := env.editor.call("GET", query(strings.Repeat("0", 64)), nil, nil, nil)
	mustCode(t, "another hash", code, e, 404, "passage_not_found")
	code, e = env.editor.call("GET", fmt.Sprintf("%s?parentFirst=1&parentLast=2", path), nil, nil, nil)
	mustCode(t, "a parent without a hash", code, e, 400, "invalid_parent")
	code, e = env.editor.call("GET", fmt.Sprintf("%s?parentFirst=5&parentLast=2&parentSha256=%s", path, c.Parent.Sha256), nil, nil, nil)
	mustCode(t, "a range that runs backwards", code, e, 400, "invalid_parent")
	code, e = env.editor.call("GET", fmt.Sprintf("%s?parentFirst=0&parentLast=%d&parentSha256=%s", path, 70, c.Parent.Sha256), nil, nil, nil)
	mustCode(t, "a range wider than a parent can be", code, e, 400, "invalid_parent")
	code, e = env.member.call("GET", query(c.Parent.Sha256), nil, nil, nil)
	mustCode(t, "a member", code, e, 403, "forbidden")
}

// A document replaced or deleted between the search and the expansion leaves nothing to expand: the hits keep no text and a reason, and a
// document replaced by one that cuts into other passages never lends its new text to the old hit (#20, stale and missing parents).
func TestExpansionAfterTheDocumentChanged(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	kb, hits := env.search(t, env.kbOn.Id, "parking3x", 3, true, kbs.MetadataFilter{})
	if len(hits) == 0 || hits[0].Parent == nil {
		t.Fatalf("hits = %+v", hits)
	}
	// The same document with a different second passage onwards: new rows, so the hit's passage is gone.
	env.uploadHandbook(t, env.source.Id, "handbook.md", strings.ReplaceAll(parentDoc(6), "parking", "driving"))
	if err := env.app.Svc.KBs.ExpandParents(context.Background(), kb, kbs.MetadataFilter{}, hitPtrs(hits)); err != nil {
		t.Fatal(err)
	}
	for _, h := range hits {
		if h.Parent.Text != "" || h.Parent.Skipped != kbs.SkipIncomplete {
			t.Errorf("a hit of the replaced document: text %q, skipped %q", h.Parent.Text, h.Parent.Skipped)
		}
	}

	// And a deleted one.
	kb, hits = env.search(t, env.kbOn.Id, "driving3x", 3, true, kbs.MetadataFilter{})
	if len(hits) == 0 || hits[0].Parent == nil {
		t.Fatalf("hits = %+v", hits)
	}
	env.deleteFrom(t, env.source.Id, "handbook.md")
	if err := env.app.Svc.KBs.ExpandParents(context.Background(), kb, kbs.MetadataFilter{}, hitPtrs(hits)); err != nil {
		t.Fatal(err)
	}
	for _, h := range hits {
		if h.Parent.Text != "" || h.Parent.Skipped != kbs.SkipIncomplete {
			t.Errorf("a hit of the deleted document: text %q, skipped %q", h.Parent.Text, h.Parent.Skipped)
		}
	}
}
