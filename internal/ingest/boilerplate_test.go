package ingest

import (
	"reflect"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestDecideCanonicalCopy(t *testing.T) {
	blocks := chunk.Blocks("## QUICKLINKS\n\n- [A](<a>)\n\nReal page text.\n\nFooter text © 2026")
	nav, foot := boilerplate.Hash("- [A](<a>)"), boilerplate.Hash("Footer text © 2026")
	home, other := uuid.New(), uuid.New()
	set := map[int64]uuid.NullUUID{
		nav:  {UUID: home, Valid: true},
		foot: {UUID: home, Valid: true},
	}
	p := decide(blocks, set, other)
	if len(p.dropped) != 2 || !p.drop["- [A](<a>)"] || !p.drop["Footer text © 2026"] || p.drop["Real page text."] {
		t.Fatalf("other page: %+v", p)
	}
	if len(p.hashes) != 4 {
		t.Fatalf("hashes = %v", p.hashes)
	}
	// The canonical page keeps its copy.
	if p := decide(blocks, set, home); len(p.dropped) != 0 || p.drop != nil {
		t.Fatalf("canonical page: %+v", p)
	}
	// Canonical document deleted (NULL): everyone drops it.
	set[foot] = uuid.NullUUID{}
	if p := decide(blocks, set, home); !reflect.DeepEqual(p.dropped, []int64{foot}) {
		t.Fatalf("no canonical copy: %+v", p.dropped)
	}
	// Suppression off: hashes recorded, nothing dropped.
	if p := decide(blocks, nil, other); len(p.dropped) != 0 || len(p.hashes) != 4 {
		t.Fatalf("off: %+v", p)
	}
}

func TestCandidateAndSameDrops(t *testing.T) {
	doc, home := uuid.New(), uuid.New()
	set := map[int64]uuid.NullUUID{1: {UUID: home, Valid: true}, 2: {UUID: doc, Valid: true}}
	if got := candidateDrops([]int64{1, 2, 3}, set, doc); !reflect.DeepEqual(got, []int64{1}) {
		t.Fatalf("candidateDrops = %v", got)
	}
	if !sameDrops([]int64{3, 1}, []int64{1, 3}) || sameDrops([]int64{1}, []int64{1, 2}) || !sameDrops(nil, []int64{}) {
		t.Fatal("sameDrops compares as sets")
	}
}

func TestMatchChunks(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	existing := []dbgen.DocumentChunkKeysRow{
		{ID: a, Content: "Intro", HeadingPath: []string{"Guide"}},
		{ID: b, Content: "Body\n\nFooter", HeadingPath: []string{"Guide", "More"}},
	}
	chunks := []chunk.Chunk{
		{Content: "Intro", HeadingPath: []string{"Guide"}},
		{Content: "Body", HeadingPath: []string{"Guide", "More"}},
		{Content: "Intro", HeadingPath: []string{"Other"}}, // same text, other context: embedded again
	}
	reuse, fresh := matchChunks(chunks, existing)
	if reuse[0] != a || reuse[1] != uuid.Nil || reuse[2] != uuid.Nil || !reflect.DeepEqual(fresh, []int{1, 2}) {
		t.Fatalf("reuse = %v fresh = %v", reuse, fresh)
	}
	// A row is reused at most once.
	reuse, fresh = matchChunks([]chunk.Chunk{chunks[0], chunks[0]}, existing)
	if reuse[0] != a || reuse[1] != uuid.Nil || !reflect.DeepEqual(fresh, []int{1}) {
		t.Fatalf("duplicate: reuse = %v fresh = %v", reuse, fresh)
	}
}
