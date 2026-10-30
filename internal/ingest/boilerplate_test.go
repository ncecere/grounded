package ingest

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

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

func TestSketchBlocks(t *testing.T) {
	md := "# Policy\n\n- [Home](/h)\n- [Admissions](/a)\n- [Academics](/c)\n- [Registrar](/r)\n- [Student life](/s)\n- [Contact us](/u)\n\n" +
		"Last updated March 3, 2026 by the Office of the Test Registrar, 101 Main Hall.\n\n---\n\n" +
		"Last updated March 3, 2026 by the Office of the Test Registrar, 101 Main Hall.\n\nShort line."
	got := sketchBlocks(chunk.Blocks(md))
	if len(got.hashes) != 2 || len(got.packed) != 2*boilerplate.SketchValues {
		t.Fatalf("eligible blocks = %d hashes, %d bytes: the heading, the separator, the short line and the repeat are left out", len(got.hashes), len(got.packed))
	}
	menu := chunk.Blocks(md)[1].Text
	want, _ := boilerplate.SketchOf(menu)
	if got.hashes[0] != boilerplate.Hash(menu) || !reflect.DeepEqual(got.packed[:boilerplate.SketchValues], want[:]) {
		t.Fatal("the first eligible block is the menu, in document order")
	}
	if empty := sketchBlocks(chunk.Blocks("# Only a heading")); empty.hashes == nil || empty.packed == nil || len(empty.hashes) != 0 {
		t.Fatal("a document with no eligible block records empty, not nil, lists")
	}
}

func TestSettingsOfFuzzy(t *testing.T) {
	yes, no := pgtype.Bool{Bool: true, Valid: true}, pgtype.Bool{Bool: false, Valid: true}
	if s := SettingsOf(pgtype.Bool{}, pgtype.Bool{}, nil, nil); !s.IsZero() {
		t.Fatalf("nothing stored overrides nothing: %+v", s)
	}
	if s := SettingsOf(yes, no, nil, nil); s.Enabled == nil || !*s.Enabled || s.Fuzzy == nil || *s.Fuzzy {
		t.Fatalf("stored overrides: %+v", s)
	}
	if s := SettingsOf(pgtype.Bool{}, yes, nil, nil); s.Enabled != nil || s.Fuzzy == nil || !*s.Fuzzy {
		t.Fatalf("fuzzy alone: %+v", s)
	}
}
