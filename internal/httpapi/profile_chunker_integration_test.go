package httpapi_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// shortSections is a document of many short sections: a title and a sentence each, far under a 128-token passage, so chunker version 1 makes one
// passage per section and version 2 joins neighbours.
func shortSections(n int) []byte {
	var b strings.Builder
	b.WriteString("# Student handbook\n\n")
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "## Policy %d\n\nPolicy %d says that requests go to the office, which answers within %d business days.\n\n", i, i, i%7+2)
	}
	return []byte(b.String())
}

func (env *migEnv) newProfile(t *testing.T, key string, body map[string]any, wantCode int, wantErr string) apitypes.EmbeddingProfile {
	t.Helper()
	body["key"], body["name"] = key, key
	var p apitypes.EmbeddingProfile
	code, e := env.admin.call("POST", "/v1/admin/embedding-profiles", body, &p, nil)
	mustCode(t, "create profile "+key, code, e, wantCode, wantErr)
	return p
}

// A profile carries its chunker version: 1 unless one is chosen, 1, 2 or 3 as chosen, anything else refused; the version is fixed once the profile is
// made, and a preview's candidate keeps the live profile's version unless the preview changes it (#19).
func TestProfileChunkerVersion(t *testing.T) {
	env := newMigEnv(t)
	model := env.from.Model.Id
	base := func() map[string]any { return map[string]any{"modelId": model, "chunkSize": 128, "chunkOverlap": 16} }

	if p := env.newProfile(t, "v-default", base(), 201, ""); p.ChunkerVersion != 1 {
		t.Errorf("default chunker version = %d, want 1", p.ChunkerVersion)
	}
	b2 := base()
	b2["chunkerVersion"] = 2
	two := env.newProfile(t, "v-two", b2, 201, "")
	if two.ChunkerVersion != 2 {
		t.Errorf("chunker version = %d, want 2", two.ChunkerVersion)
	}
	b3 := base()
	b3["chunkerVersion"] = 3
	if p := env.newProfile(t, "v-three", b3, 201, ""); p.ChunkerVersion != 3 {
		t.Errorf("chunker version = %d, want 3", p.ChunkerVersion)
	}
	zero := base()
	zero["chunkerVersion"] = 0 // "not given": version 1, like leaving it out
	if p := env.newProfile(t, "v-zero", zero, 201, ""); p.ChunkerVersion != 1 {
		t.Errorf("chunkerVersion 0 made version %d, want 1", p.ChunkerVersion)
	}
	for _, bad := range []int{4, 99, -1} {
		b := base()
		b["chunkerVersion"] = bad
		env.newProfile(t, fmt.Sprintf("v-bad%d", bad), b, 400, "invalid_chunker_version")
	}

	// The version cannot be edited afterwards: it is not an updatable field (like the sizes), and a request that carries it is refused, not ignored.
	code, e := env.admin.call("PATCH", "/v1/admin/embedding-profiles/"+two.Id.String(), map[string]any{"chunkerVersion": 1, "name": "Renamed"}, nil, ifMatch(two.Revision))
	mustCode(t, "patch the version", code, e, 400, "invalid_json")
	code, e = env.admin.call("PATCH", "/v1/admin/embedding-profiles/"+two.Id.String(), map[string]any{"name": "Renamed"}, nil, ifMatch(two.Revision))
	mustCode(t, "rename", code, e, 200, "")
	if got := env.profileByID(t, two.Id); got.ChunkerVersion != 2 || got.Name != "Renamed" {
		t.Errorf("after the patches: version %d, name %q", got.ChunkerVersion, got.Name)
	}

	// A candidate keeps the live profile's version, and a preview can change it.
	kb := env.kbOn(t, "On two", two.Id)
	keep := env.preview(t, kb.Id, map[string]any{"chunkSize": 256, "chunkOverlap": 32})
	if got := env.profileByID(t, keep.ToProfile.Id); got.ChunkerVersion != 2 {
		t.Errorf("the candidate of a version 2 profile has version %d, want 2", got.ChunkerVersion)
	}
	env.action(t, env.waitStatus(t, keep.Id, statusReady), "cancel", 200, "")
	back := env.preview(t, kb.Id, map[string]any{"chunkerVersion": 1})
	if got := env.profileByID(t, back.ToProfile.Id); got.ChunkerVersion != 1 {
		t.Errorf("a preview that asks for version 1 made version %d", got.ChunkerVersion)
	}
	env.action(t, env.waitStatus(t, back.Id, statusReady), "cancel", 200, "")
	rows := env.profileRows(t)
	code, e = env.admin.call("POST", "/v1/admin/profile-migrations/preview", map[string]any{"kbId": kb.Id, "changes": map[string]any{"chunkerVersion": 7}}, nil, nil)
	mustCode(t, "an unknown version in a preview", code, e, 400, "invalid_chunker_version")
	if env.profileRows(t) != rows {
		t.Errorf("a refused preview left a profile: %d -> %d", rows, env.profileRows(t))
	}
}

// kbOn makes a knowledge base on a given profile.
func (env *migEnv) kbOn(t *testing.T, name string, profile uuid.UUID) apitypes.KnowledgeBase {
	t.Helper()
	var kb apitypes.KnowledgeBase
	code, e := env.owner.call("POST", env.base+"/kbs", map[string]any{"name": name, "embeddingProfileId": profile}, &kb, nil)
	mustCode(t, "kb on "+profile.String(), code, e, 201, "")
	return kb
}

// An index preview that only changes the chunker version builds a candidate with fewer passages from a document of short sections, the live index
// untouched; the same document uploaded to a source on a version 2 profile is cut by version 2 straight away (#19).
func TestChunkerVersion2CutsFewerPassages(t *testing.T) {
	env := newMigEnv(t)
	src := env.source(t, "Handbook", upload{"policies.md", shortSections(40)})
	kb := env.kb(t, "Handbook", src.Id)
	live := env.chunks(t, src.Id, env.from.Id)
	if live < 40 {
		t.Fatalf("version 1 made %d passages of 40 short sections; the fixture does not exercise the merge", live)
	}

	m := env.preview(t, kb.Id, map[string]any{"chunkerVersion": 2})
	m = env.waitStatus(t, m.Id, statusReady)
	cand := env.chunks(t, src.Id, m.ToProfile.Id)
	if cand == 0 || cand >= live || env.vectors(t, src.Id, m.ToProfile.Id) != cand {
		t.Fatalf("passages: live %d, candidate %d (%d vectors): version 2 should make fewer", live, cand, env.vectors(t, src.Id, m.ToProfile.Id))
	}
	if env.chunks(t, src.Id, env.from.Id) != live {
		t.Error("the live index changed while the candidate was built")
	}
	// The candidate differs from the live profile only in the version, so without it the passages would have been copied, not cut again.
	liveP, candP := env.profileByID(t, env.from.Id), env.profileByID(t, m.ToProfile.Id)
	if candP.ChunkSize != liveP.ChunkSize || candP.ChunkOverlap != liveP.ChunkOverlap || candP.ChunkerVersion != 2 || liveP.ChunkerVersion != 1 {
		t.Errorf("candidate %+v, live %+v", candP, liveP)
	}
	env.action(t, m, "cancel", 200, "")

	// Ingestion of a new document uses the profile's version.
	prof := env.newProfile(t, "ingest-two", map[string]any{"modelId": env.from.Model.Id, "chunkSize": liveP.ChunkSize, "chunkOverlap": liveP.ChunkOverlap, "chunkerVersion": 2}, 201, "")
	var src2 apitypes.DataSource
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": "On two", "classification": "open", "embeddingProfileId": prof.Id}, &src2, nil)
	mustCode(t, "source on a version 2 profile", code, e, 201, "")
	env.upload(t, src2.Id, upload{"policies.md", shortSections(40)})
	if direct := env.chunks(t, src2.Id, prof.Id); direct == 0 || direct >= live {
		t.Errorf("a document uploaded to a version 2 profile made %d passages; version 1 makes %d", direct, live)
	}
}
