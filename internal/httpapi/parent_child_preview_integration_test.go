package httpapi_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/kbs"
)

// shape is a source's passages under a profile as the index preview and an ordinary ingestion must agree on: what each passage says and the
// range of its parent, in document and ordinal order (ids differ by nature).
func (env *migEnv) shape(t *testing.T, src, profile uuid.UUID) []string {
	t.Helper()
	rows, err := env.app.Pool.Query(context.Background(), `SELECT d.filename, c.ordinal, c.token_count, coalesce(c.parent_first, -1), coalesce(c.parent_last, -1), c.content
FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.source_id = $1 AND c.profile_id = $2 ORDER BY d.filename, c.ordinal`, src, profile)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var file, content string
		var ord, tokens, first, last int
		if err := rows.Scan(&file, &ord, &tokens, &first, &last, &content); err != nil {
			t.Fatal(err)
		}
		out = append(out, fmt.Sprintf("%s#%d (%d tokens) parent %d-%d: %s", file, ord, tokens, first, last, content))
	}
	return out
}

func (env *migEnv) searchAs(t *testing.T, kbID uuid.UUID, q string) []kbs.Hit {
	t.Helper()
	resolved, err := env.app.Svc.KBs.ResolveKBs(context.Background(), []uuid.UUID{kbID})
	if err != nil || len(resolved) != 1 {
		t.Fatalf("resolve = %v %v", resolved, err)
	}
	res, err := env.app.Svc.KBs.Search(context.Background(), resolved[0], kbs.SearchParams{Text: q, TopK: 4, User: "test", CollapseParents: true})
	if err != nil {
		t.Fatal(err)
	}
	return res.Hits
}

// An index preview that sets a parent size builds, beside the live index, exactly the passages and parent ranges that ingesting the same
// documents under the same settings would build: by copying the live passages when only the parent size changes, and by cutting the text again
// when the passage size changes too. The live index, its ranges and its searches are untouched until the switch; the switch makes the candidate
// the knowledge base's index, and the old rows stay for the grace period (#20, preview and apply equivalence).
func TestPreviewOfParentsEqualsIngestingWithThem(t *testing.T) {
	env := newMigEnv(t)
	files := []upload{{"handbook.md", []byte(parentDoc(6))}, {"notes.md", []byte(longText("notes", 40))}}
	src := env.source(t, "Handbook", files...)
	kb := env.kb(t, "Handbook", src.Id)
	liveShape := env.shape(t, src.Id, env.from.Id)
	if len(liveShape) == 0 || strings.Contains(strings.Join(liveShape, "\n"), "parent 0-") {
		t.Fatalf("the live index has parent ranges, or none: %d rows", len(liveShape))
	}
	liveVectors := env.vectors(t, src.Id, env.from.Id)

	for _, tc := range []struct {
		name    string
		changes map[string]any
		profile map[string]any // what the fresh ingestion's profile sets, besides the live profile's settings
	}{
		{"only the parent size", map[string]any{"parentTokens": 512}, map[string]any{"parentTokens": 512}},
		{"a smaller passage and a parent", map[string]any{"chunkSize": 64, "chunkOverlap": 8, "parentTokens": 512},
			map[string]any{"chunkSize": 64, "chunkOverlap": 8, "parentTokens": 512}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := env.waitStatus(t, env.preview(t, kb.Id, tc.changes).Id, statusReady)
			cand := env.profileByID(t, m.ToProfile.Id)
			if cand.ParentTokens != 512 {
				t.Fatalf("the candidate has parentTokens %d", cand.ParentTokens)
			}
			got := env.shape(t, src.Id, cand.Id)
			if len(got) == 0 {
				t.Fatal("the preview built no passages")
			}
			if strings.Contains(strings.Join(got, "\n"), "parent -1--1") {
				t.Error("a passage of the candidate has no parent range")
			}

			// The same documents ingested under the same settings.
			body := map[string]any{"modelId": env.from.Model.Id, "chunkSize": env.from.ChunkSize, "chunkOverlap": env.from.ChunkOverlap,
				"documentPrefix": env.from.DocumentPrefix, "queryPrefix": env.from.QueryPrefix}
			for k, v := range tc.profile {
				body[k] = v
			}
			fresh := env.newProfile(t, "fresh-"+strings.ReplaceAll(tc.name, " ", "-"), withKey(body, "fresh-"+strings.ReplaceAll(tc.name, " ", "-")), 201, "")
			var src2 = env.sourceOn(t, "Fresh "+tc.name, fresh.Id, files...)
			want := env.shape(t, src2.Id, fresh.Id)
			if strings.Join(got, "\n") != strings.Join(want, "\n") {
				t.Errorf("the preview built other passages than an ingestion would:\n preview %d rows, ingestion %d rows\n first preview row:   %.200s\n first ingested row:  %.200s",
					len(got), len(want), first(got), first(want))
			}

			// The live index did not move.
			if now := env.shape(t, src.Id, env.from.Id); strings.Join(now, "\n") != strings.Join(liveShape, "\n") || env.vectors(t, src.Id, env.from.Id) != liveVectors {
				t.Error("the live index changed while the preview was built")
			}
			for _, h := range env.searchAs(t, kb.Id, "parking3x") {
				if h.Parent != nil {
					t.Error("the knowledge base, still on its live profile, searched with parents")
				}
			}
			env.action(t, m, "cancel", 200, "")
		})
	}

	// Switching makes the candidate the index: searches collapse and expand there, and the old rows are kept.
	m := env.waitStatus(t, env.preview(t, kb.Id, map[string]any{"parentTokens": 512}).Id, statusReady)
	env.action(t, m, "switch", 200, "")
	if got := env.getKB(t, kb.Id).EmbeddingProfileId; got != m.ToProfile.Id {
		t.Fatalf("the knowledge base is on profile %s, want the candidate %s", got, m.ToProfile.Id)
	}
	hits := env.searchAs(t, kb.Id, "parking3x")
	if len(hits) == 0 || hits[0].Parent == nil || hits[0].Parent.Last <= hits[0].Parent.First {
		t.Fatalf("after the switch the first hit has parent %+v", hits)
	}
	resolved, _ := env.app.Svc.KBs.ResolveKBs(context.Background(), []uuid.UUID{kb.Id})
	if err := env.app.Svc.KBs.ExpandParents(context.Background(), resolved[0], kbs.MetadataFilter{}, hitPtrs(hits)); err != nil || hits[0].Parent.Text == "" {
		t.Errorf("expand after the switch: %v, %+v", err, hits[0].Parent)
	}
	if n := env.chunks(t, src.Id, env.from.Id); n != int64(len(liveShape)) {
		t.Errorf("the old index has %d passages after the switch, want the %d it had (kept for the grace period)", n, len(liveShape))
	}
	if n := env.scalar(t, `SELECT count(*) FROM chunks WHERE source_id = $1 AND profile_id = $2 AND parent_first IS NOT NULL`, src.Id, env.from.Id); n != 0 {
		t.Errorf("%d rows of the old index gained a range", n)
	}
}

// A preview whose parent size does not fit the passage size is refused before anything is built, and leaves no candidate behind (#20).
func TestPreviewRefusesAParentSmallerThanTwoPassages(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", upload{"handbook.md", []byte(parentDoc(3))})
	kb := env.kb(t, "Handbook", src.Id)
	rows := env.profileRows(t)
	for _, changes := range []map[string]any{
		{"parentTokens": 100},
		{"parentTokens": 9000},
		{"parentTokens": -1},
		{"chunkSize": 512, "parentTokens": 512},
	} {
		code, e := env.admin.call("POST", "/v1/admin/profile-migrations/preview", map[string]any{"kbId": kb.Id, "changes": changes}, nil, nil)
		mustCode(t, fmt.Sprint(changes), code, e, 400, "invalid_parent_tokens")
	}
	if env.profileRows(t) != rows {
		t.Errorf("refused previews left profiles behind: %d -> %d", rows, env.profileRows(t))
	}
	// A profile that has parents keeps them in a preview that does not mention them (a candidate copies the live settings), and a preview can
	// turn them off with 0.
	with := env.newProfile(t, "with-parents", map[string]any{"key": "with-parents", "name": "With", "modelId": env.from.Model.Id, "chunkSize": 128, "chunkOverlap": 16, "parentTokens": 512}, 201, "")
	kb2 := env.kbOn(t, "On parents", with.Id)
	keep := env.preview(t, kb2.Id, map[string]any{"chunkOverlap": 8})
	if got := env.profileByID(t, keep.ToProfile.Id); got.ParentTokens != 512 {
		t.Errorf("a candidate of a profile with parents has parentTokens %d", got.ParentTokens)
	}
	env.action(t, env.waitStatus(t, keep.Id, statusReady), "cancel", 200, "")
	off := env.preview(t, kb2.Id, map[string]any{"parentTokens": 0})
	if got := env.profileByID(t, off.ToProfile.Id); got.ParentTokens != 0 {
		t.Errorf("a preview that asks for 0 has parentTokens %d", got.ParentTokens)
	}
	env.action(t, env.waitStatus(t, off.Id, statusReady), "cancel", 200, "")
}

func withKey(body map[string]any, key string) map[string]any {
	body["key"], body["name"] = key, key
	return body
}

func first(rows []string) string {
	if len(rows) == 0 {
		return ""
	}
	return rows[0]
}

// sourceOn creates an upload source on a profile with the files, waiting until they are ready.
func (env *migEnv) sourceOn(t *testing.T, name string, profile uuid.UUID, files ...upload) apitypes.DataSource {
	t.Helper()
	var src apitypes.DataSource
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": name, "classification": "open", "embeddingProfileId": profile}, &src, nil)
	mustCode(t, "create source on a profile", code, e, 201, "")
	env.upload(t, src.Id, files...)
	return src
}
