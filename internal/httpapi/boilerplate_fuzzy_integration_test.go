package httpapi_test

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

const statusSwitched = apitypes.ProfileMigrationStatus("switched")

func (env *migEnv) srcPath(src apitypes.DataSource) string {
	return env.base + "/sources/" + src.Id.String()
}

// setFuzzy turns near-duplicate matching on or off for a source and waits for the refresh.
func (env *migEnv) setFuzzy(t *testing.T, src apitypes.DataSource, on bool, done func(apitypes.SourceBoilerplate) bool) apitypes.SourceBoilerplate {
	t.Helper()
	var cur apitypes.DataSource
	env.owner.get(env.srcPath(src), &cur)
	code, e := env.owner.call("PATCH", env.srcPath(src), map[string]any{"boilerplate": map[string]any{"enabled": true, "fuzzy": on}}, &cur, ifMatch(cur.Revision))
	mustCode(t, fmt.Sprintf("fuzzy %v", on), code, e, 200, "")
	if cur.Boilerplate.Fuzzy != on || cur.Boilerplate.Overrides.Fuzzy == nil || *cur.Boilerplate.Overrides.Fuzzy != on {
		t.Fatalf("settings after fuzzy %v: %+v", on, cur.Boilerplate)
	}
	return waitBoilerplate(t, env.owner, env.srcPath(src), done)
}

func repeated(n int64) func(apitypes.SourceBoilerplate) bool {
	return func(b apitypes.SourceBoilerplate) bool { return b.RepeatedBlocks == n }
}

// Near-duplicate matching (#23): a menu with a different highlighted item and a footer with a different date are
// each one block once it is on; blocks that only share words are kept; turning it off puts everything back exactly
// as the exact matching had it (the golden file).
func TestBoilerplateFuzzyMatching(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", fuzzyFiles()...)
	exact := env.setFuzzy(t, src, false, repeated(1))
	if exact.Fuzzy || exact.PagesAffected != fuzzyDocs-1 {
		t.Fatalf("exact matching: %+v", exact)
	}
	// Exact hashing sees ten menus and twelve footers, none on enough pages.
	for _, text := range []string{"Student life", "Last updated"} {
		if got := chunksContaining(t, env.ragEnv, src.Id, text); len(got) != fuzzyDocs {
			t.Fatalf("with exact matching %q is on %d pages", text, len(got))
		}
	}

	bp := env.setFuzzy(t, src, true, repeated(3))
	if bp.PagesAffected != fuzzyDocs-1 || bp.DocumentsCounted != fuzzyDocs || bp.Threshold != 5 {
		t.Fatalf("summary = %+v", bp)
	}
	for _, text := range []string{"Student life", "Last updated", "ZebraSignoff"} {
		if got := chunksContaining(t, env.ragEnv, src.Id, text); len(got) != 1 || got["p01.md"] != 1 {
			t.Errorf("%q: chunks per page = %v, want only the canonical p01.md", text, got)
		}
	}
	// What only looks alike stays: the control sentences (three pages each), the template line, every page's own text.
	for i, control := range fuzzyControls {
		if got := chunksContaining(t, env.ragEnv, src.Id, control[:40]); len(got) != 3 {
			t.Errorf("control %d is on %d pages, want 3: %v", i, len(got), got)
		}
	}
	if got := chunksContaining(t, env.ragEnv, src.Id, "lists the forms for"); len(got) != fuzzyDocs {
		t.Errorf("the template line is on %d pages, want %d", len(got), fuzzyDocs)
	}
	for i := 0; i < fuzzyDocs; i++ {
		if got := chunksContaining(t, env.ragEnv, src.Id, fmt.Sprintf("This is policy %c of the handbook", 'A'+i)); len(got) != 1 {
			t.Errorf("page %d lost its own text: %v", i, got)
		}
	}

	// The list shows each cluster once, with its variants.
	var blocks []apitypes.BoilerplateBlock
	if code := env.owner.get(env.srcPath(src)+"/boilerplate", &blocks); code != 200 || len(blocks) != 3 {
		t.Fatalf("boilerplate list = %d %+v", code, blocks)
	}
	variants := map[int32]string{}
	for _, b := range blocks {
		variants[b.Variants] = b.Text
		if b.Documents != fuzzyDocs || b.Text == "" || strings.Contains(b.Text, "](") {
			t.Errorf("block %+v", b)
		}
	}
	if len(variants) != 3 || variants[1] == "" || variants[10] == "" || variants[12] == "" {
		t.Errorf("variants = %v, want an exact block, the 10 menus and the 12 footers", variants)
	}

	// Off again: every document is as the exact matching left it.
	off := env.setFuzzy(t, src, false, repeated(1))
	checkGolden(t, "boilerplate_exact_golden.json", snapshotBlocks(t, env.ragEnv, src, off))
}

// A source's result does not depend on the order its documents arrived in, nor on whether the setting came before or
// after them: documents indexed before the clusters were known are re-chunked by the refresh.
func TestBoilerplateFuzzyIsOrderIndependent(t *testing.T) {
	env := newMigEnv(t)
	files := fuzzyFiles()
	after := env.source(t, "All at once", files...)
	bpAfter := env.setFuzzy(t, after, true, repeated(3))

	var before apitypes.DataSource
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": "In three batches", "classification": "open",
		"boilerplate": map[string]any{"enabled": true, "fuzzy": true}}, &before, nil)
	mustCode(t, "create source with the setting", code, e, 201, "")
	var reversed []upload
	for i := len(files) - 1; i >= 0; i-- {
		reversed = append(reversed, files[i])
	}
	for _, batch := range [][]upload{reversed[:5], reversed[5:9], reversed[9:]} {
		env.upload(t, before.Id, batch...)
	}
	bpBefore := waitBoilerplate(t, env.owner, env.srcPath(before), repeated(3))
	if bpBefore.PagesAffected != bpAfter.PagesAffected || bpBefore.DocumentsCounted != bpAfter.DocumentsCounted {
		t.Errorf("summaries differ: %+v and %+v", bpBefore, bpAfter)
	}
	a, b := snapshotBlocks(t, env.ragEnv, after, bpAfter), snapshotBlocks(t, env.ragEnv, before, bpBefore)
	if !reflect.DeepEqual(a.Blocks, b.Blocks) || !reflect.DeepEqual(a.Documents, b.Documents) {
		t.Errorf("the order changed the result:\n%+v\n%+v", a, b)
	}
}

// docChunks reads a source's passages for a profile, by document name.
func (env *migEnv) docChunks(t *testing.T, src, profile uuid.UUID) map[string][]string {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(), `SELECT d.filename, c.content FROM chunks c JOIN documents d ON d.id = c.document_id
		WHERE c.source_id = $1 AND c.profile_id = $2 ORDER BY d.filename, c.ordinal`, src, profile)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var name, content string
		if err := rows.Scan(&name, &content); err != nil {
			t.Fatal(err)
		}
		out[name] = append(out[name], content)
	}
	return out
}

// profileChunkIDs is a snapshot of a source's passages of one profile (id -> text).
func (env *migEnv) profileChunkIDs(t *testing.T, src, profile uuid.UUID) map[string]string {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(), `SELECT id::text, content FROM chunks WHERE source_id = $1 AND profile_id = $2`, src, profile)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, c string
		if err := rows.Scan(&id, &c); err != nil {
			t.Fatal(err)
		}
		out[id] = c
	}
	return out
}

// classification is the blocks a classification drops, as "hash -> the document that keeps its copy".
func (env *migEnv) classification(t *testing.T, sql string, args ...any) []string {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(), sql, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var h int64
		var name *string
		if err := rows.Scan(&h, &name); err != nil {
			t.Fatal(err)
		}
		keeper := ""
		if name != nil {
			keeper = *name
		}
		out = append(out, fmt.Sprintf("%d kept in %s", h, keeper))
	}
	sort.Strings(out)
	return out
}

// The index preview with near-duplicate matching on (#23): the candidate drops what the source's own refresh drops
// once the setting is applied (the same blocks, kept in the same documents, the same passages), and the live index
// is not touched until then.
func TestBoilerplateFuzzyPreviewMatchesApply(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", fuzzyFiles()...)
	env.setFuzzy(t, src, false, repeated(1))
	kb := env.kb(t, "Handbook", src.Id)
	live := env.docChunks(t, src.Id, env.from.Id)
	liveDropped := snapshotBlocks(t, env.ragEnv, src, apitypes.SourceBoilerplate{}).Documents

	m := env.waitStatus(t, env.preview(t, kb.Id, map[string]any{"boilerplateFuzzy": true}).Id, statusReady)
	if cand := env.profileByID(t, m.ToProfile.Id); !cand.BoilerplateFuzzy || env.profileByID(t, env.from.Id).BoilerplateFuzzy {
		t.Fatalf("the candidate carries the setting: %+v", cand)
	}
	preview := env.docChunks(t, src.Id, m.ToProfile.Id)
	if reflect.DeepEqual(preview, live) {
		t.Fatal("the preview cut the same passages as the live index: it did not use near-duplicate matching")
	}
	if len(preview) != fuzzyDocs || strings.Contains(strings.Join(preview["p02.md"], ""), "Student life") || !strings.Contains(strings.Join(preview["p01.md"], ""), "Student life") {
		t.Errorf("preview passages: the menu stays on p01.md only: %v", preview["p02.md"])
	}
	// Nothing live changed.
	if !reflect.DeepEqual(env.docChunks(t, src.Id, env.from.Id), live) ||
		!reflect.DeepEqual(snapshotBlocks(t, env.ragEnv, src, apitypes.SourceBoilerplate{}).Documents, liveDropped) {
		t.Error("the live index changed while the preview was built")
	}
	previewBlocks := env.classification(t, `SELECT b.block_hash, d.filename FROM set_boilerplate_blocks b LEFT JOIN documents d ON d.id = b.canonical_document_id
		WHERE b.source_id = $1 AND b.profile_id = $2`, src.Id, m.ToProfile.Id)
	if len(previewBlocks) != 22+1 {
		t.Errorf("the preview drops %d blocks: %v", len(previewBlocks), previewBlocks)
	}

	// Apply the same setting to the source.
	bp := env.setFuzzy(t, src, true, repeated(3))
	applied := env.docChunks(t, src.Id, env.from.Id)
	if !reflect.DeepEqual(applied, preview) {
		t.Errorf("the preview and the applied setting cut different passages:\npreview %v\napplied %v", preview, applied)
	}
	appliedBlocks := env.classification(t, `SELECT b.block_hash, d.filename FROM source_boilerplate_blocks b LEFT JOIN documents d ON d.id = b.canonical_document_id
		WHERE b.source_id = $1`, src.Id)
	if !reflect.DeepEqual(appliedBlocks, previewBlocks) {
		t.Errorf("different blocks dropped:\npreview %v\napplied %v", previewBlocks, appliedBlocks)
	}
	if bp.PagesAffected != fuzzyDocs-1 {
		t.Errorf("summary = %+v", bp)
	}
	env.action(t, env.migration(t, m.Id), "cancel", 200, "")
}

// Switching such a preview makes the setting the source's own, so the settings and the index agree: the refresh that
// follows changes no passage of the index in use and embeds nothing for it.
func TestBoilerplateFuzzyPreviewSwitchAppliesTheSetting(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", fuzzyFiles()...)
	env.setFuzzy(t, src, false, repeated(1))
	kb := env.kb(t, "Handbook", src.Id)

	m := env.waitStatus(t, env.preview(t, kb.Id, map[string]any{"boilerplateFuzzy": true}).Id, statusReady)
	preview := env.docChunks(t, src.Id, m.ToProfile.Id)
	sw := env.action(t, m, "switch", 200, "")
	if sw.Status != statusSwitched {
		t.Fatalf("status = %s", sw.Status)
	}

	var cur apitypes.DataSource
	env.owner.get(env.srcPath(src), &cur)
	if !cur.Boilerplate.Fuzzy || cur.Boilerplate.Overrides.Fuzzy == nil || !*cur.Boilerplate.Overrides.Fuzzy || cur.EmbeddingProfileId != m.ToProfile.Id {
		t.Fatalf("after the switch: profile %s, %+v", cur.EmbeddingProfileId, cur.Boilerplate)
	}
	if env.profileByID(t, m.ToProfile.Id).BoilerplateFuzzy {
		t.Error("a profile in use does not carry the preview's setting")
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'source.boilerplate_update' AND target_id = $1 AND actor_kind = 'system'`, src.Id.String()); n != 1 {
		t.Errorf("system audit entries = %d, want 1", n)
	}
	// The refresh only brings its records up to date: the index in use keeps its rows, and no passage is embedded for it (the old
	// profile's passages, kept for switching back, are cut again with the new drops).
	rechunkEvents := func() int64 {
		return env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'embed_tokens' AND source_id = $1 AND metadata->>'reason' = 'boilerplate'`, src.Id)
	}
	before, events := env.profileChunkIDs(t, src.Id, m.ToProfile.Id), rechunkEvents()
	waitBoilerplate(t, env.owner, env.srcPath(src), repeated(3))
	waitNoRefreshJob(t, env.ragEnv)
	if after := env.profileChunkIDs(t, src.Id, m.ToProfile.Id); fmt.Sprint(after) != fmt.Sprint(before) {
		t.Errorf("the refresh after the switch changed passages:\nbefore %v\nafter  %v", before, after)
	}
	if n := rechunkEvents(); n != events {
		t.Errorf("the refresh after the switch embedded again: %d -> %d", events, n)
	}
	if got := env.docChunks(t, src.Id, m.ToProfile.Id); !reflect.DeepEqual(got, preview) {
		t.Error("the switched index is not the preview")
	}
	// The recorded drops agree with the settings now: no document waits for a re-check.
	pending := env.scalar(t, `SELECT count(*) FROM document_blocks db JOIN source_boilerplate sb ON sb.source_id = db.source_id WHERE db.source_id = $1 AND db.rev < sb.rev`, src.Id)
	if pending != 0 {
		t.Errorf("%d documents wait for a re-check", pending)
	}
}

// A preview that asks for near-duplicate matching does nothing where the source does not remove repeated blocks at all.
func TestBoilerplateFuzzyPreviewOfASourceWithRemovalOff(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", fuzzyFiles()...)
	kb := env.kb(t, "Handbook", src.Id)
	live := env.docChunks(t, src.Id, env.from.Id)
	m := env.waitStatus(t, env.preview(t, kb.Id, map[string]any{"boilerplateFuzzy": true}).Id, statusReady)
	if got := env.docChunks(t, src.Id, m.ToProfile.Id); !reflect.DeepEqual(got, live) {
		t.Errorf("a source with removal off keeps every block in the preview too:\n%v\n%v", got, live)
	}
	if n := env.scalar(t, `SELECT count(*) FROM set_boilerplate_blocks WHERE source_id = $1`, src.Id); n != 0 {
		t.Errorf("%d blocks dropped", n)
	}
	env.action(t, m, "cancel", 200, "")
}
