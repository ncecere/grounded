package httpapi_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The three opt-in changes must compose through the actual preview/apply path:
// fuzzy classification cuts the same table-aware children and parent ranges
// as ordinary ingestion, while the old index stays untouched until switch.
func TestCombinedTableFuzzyParentPreviewMatchesApply(t *testing.T) {
	env := newMigEnv(t)
	files := fuzzyFiles()
	words := []string{"pine", "maple", "birch", "cedar", "spruce", "willow", "elm", "aspen", "beech", "larch", "oak", "poplar"}
	for i := range files {
		w := words[i]
		files[i].data = append(files[i].data, []byte(fmt.Sprintf("\n\n| Request | Timing |\n| --- | --- |\n| %s %swood | %s %sbranch |\n| %s %sleaf | %s %scone |\n", w, w, w, w, w, w, w, w))...)
	}
	src := env.source(t, "Combined preview", files...)
	env.setFuzzy(t, src, false, repeated(1))
	kb := env.kb(t, "Combined preview", src.Id)
	live := env.shape(t, src.Id, env.from.Id)
	vectors := env.vectors(t, src.Id, env.from.Id)
	m := env.waitStatus(t, env.preview(t, kb.Id, map[string]any{
		"chunkerVersion": 3, "parentTokens": 512, "boilerplateFuzzy": true,
	}).Id, statusReady)
	candidate := env.profileByID(t, m.ToProfile.Id)
	if candidate.ChunkerVersion != 3 || candidate.ParentTokens != 512 || !candidate.BoilerplateFuzzy {
		t.Fatalf("combined candidate settings were not retained: %+v", candidate)
	}
	got := env.shape(t, src.Id, candidate.Id)
	if len(got) == 0 || strings.Contains(strings.Join(got, "\n"), "parent -1--1") {
		t.Fatal("candidate has no children or missing parent ranges")
	}
	fresh := env.newProfile(t, "combined-fresh", map[string]any{
		"key": "combined-fresh", "name": "Combined fresh", "modelId": env.from.Model.Id,
		"chunkSize": env.from.ChunkSize, "chunkOverlap": env.from.ChunkOverlap,
		"documentPrefix": env.from.DocumentPrefix, "queryPrefix": env.from.QueryPrefix,
		"chunkerVersion": 3, "parentTokens": 512,
	}, 201, "")
	other := env.sourceOn(t, "Applied directly", fresh.Id, files...)
	env.setFuzzy(t, other, true, repeated(3))
	want := env.shape(t, other.Id, fresh.Id)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("combined preview and direct apply disagree: preview %d rows, direct %d", len(got), len(want))
	}
	if strings.Join(env.shape(t, src.Id, env.from.Id), "\n") != strings.Join(live, "\n") || env.vectors(t, src.Id, env.from.Id) != vectors {
		t.Fatal("building the combined preview changed the live index")
	}
	var before apitypes.DataSource
	if code := env.owner.get(env.srcPath(src), &before); code != 200 || before.Boilerplate.Fuzzy {
		t.Fatalf("preview changed the source's live fuzzy setting: %d %+v", code, before.Boilerplate)
	}
	env.action(t, m, "switch", 200, "")
	waitBoilerplate(t, env.owner, env.srcPath(src), repeated(3))
	if env.getKB(t, kb.Id).EmbeddingProfileId != candidate.Id || strings.Join(env.shape(t, src.Id, candidate.Id), "\n") != strings.Join(got, "\n") {
		t.Fatal("switch/refresh changed the combined candidate's passages or parent ranges")
	}
}
