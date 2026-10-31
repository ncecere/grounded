package httpapi_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Synthetic mechanics only: fake embeddings do not establish retrieval quality.
func TestChunkerV4PreviewApplyParents(t *testing.T) {
	env := newMigEnv(t)
	doc := []byte("# Services\n\n**Same**\n\n1. Submit alpha.\n\n**Same**\n\n1. Submit beta.")
	src := env.source(t, "Structure", upload{"services.md", doc})
	kb := env.kb(t, "Structure", src.Id)
	before := strings.Join(env.shape(t, src.Id, env.from.Id), "\n")
	m := env.waitStatus(t, env.preview(t, kb.Id, map[string]any{"chunkerVersion": 4, "parentTokens": 512}).Id, statusReady)
	candidate := env.profileByID(t, m.ToProfile.Id)
	preview := env.shape(t, src.Id, candidate.Id)
	if len(preview) != 2 {
		t.Fatalf("mixed or fragmented: %q", preview)
	}
	for i, p := range preview {
		if !strings.Contains(p, fmt.Sprintf("parent %d-%d:", i, i)) {
			t.Fatalf("parent crossed structural boundary: %s", p)
		}
		if strings.Contains(p, "alpha") && strings.Contains(p, "beta") {
			t.Fatal("mixed procedures")
		}
	}
	if strings.Join(env.shape(t, src.Id, env.from.Id), "\n") != before {
		t.Fatal("preview changed live index")
	}
	fresh := env.newProfile(t, "structure-fresh", map[string]any{
		"modelId": env.from.Model.Id, "chunkSize": env.from.ChunkSize, "chunkOverlap": env.from.ChunkOverlap,
		"documentPrefix": env.from.DocumentPrefix, "queryPrefix": env.from.QueryPrefix,
		"chunkerVersion": 4, "parentTokens": 512,
	}, 201, "")
	direct := env.sourceOn(t, "Direct structure", fresh.Id, upload{"services.md", doc})
	if got := env.shape(t, direct.Id, fresh.Id); strings.Join(got, "\n") != strings.Join(preview, "\n") {
		t.Fatalf("preview/direct mismatch: %q vs %q", preview, got)
	}
	// Matching v4 chunk settings still need structural identities when parents change.
	kb2 := env.kbOn(t, "Direct structure", fresh.Id)
	code, apiErr := env.owner.call("PUT", env.base+"/kbs/"+kb2.Id.String()+"/sources/"+direct.Id.String(), nil, &kb2, nil)
	mustCode(t, "attach v4 source", code, apiErr, 200, "")
	m2 := env.waitStatus(t, env.preview(t, kb2.Id, map[string]any{"parentTokens": 1024}).Id, statusReady)
	if !m2.Estimate.Rechunk {
		t.Fatal("v4 estimate did not report re-cutting")
	}
	if got := env.shape(t, direct.Id, m2.ToProfile.Id); strings.Join(got, "\n") != strings.Join(preview, "\n") {
		t.Fatalf("matching-profile migration lost boundaries: %q", got)
	}
	env.action(t, m, "switch", 200, "")
	if env.getKB(t, kb.Id).EmbeddingProfileId != candidate.Id {
		t.Fatal("explicit switch failed")
	}
	// The retained old profile remains available for an explicit rollback migration.
	rollback := env.start(t, kb.Id, env.from.Id, nil)
	env.waitStatus(t, rollback.Id, apitypes.ProfileMigrationStatusSwitched)
	if env.getKB(t, kb.Id).EmbeddingProfileId != env.from.Id {
		t.Fatal("rollback failed")
	}
}
