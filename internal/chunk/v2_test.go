package chunk

import (
	"fmt"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/parse"
)

// v2 returns options for chunker version 2 (word counts as tokens: MaxTokens 40 gives a floor of 10).
func v2(max, overlap int) Options {
	o := opts(max, overlap)
	o.Version = Version2
	return o
}

// section is "<heading>\n\n<n words>", the words tagged so each is unique.
func section(heading, tag string, n int) string {
	w := make([]string, n)
	for i := range w {
		w[i] = fmt.Sprintf("%s%d", tag, i)
	}
	return heading + "\n\n" + strings.Join(w, " ")
}

func doc(parts ...string) string { return strings.Join(parts, "\n\n") }

func headingsOf(c Chunk) []string {
	var out []string
	for _, l := range strings.Split(c.Content, "\n") {
		if strings.HasPrefix(l, "#") {
			out = append(out, l)
		}
	}
	return out
}

func TestV2MergesShortNeighbours(t *testing.T) {
	// Words (a heading counts its marker): Guide 2+1=3, Alpha 2+3=5, Beta 2+3=5, Gamma 2+30=32; the floor is 10. Guide and Alpha make 8 (under
	// the floor), Beta is short and fits, so it joins (13); Gamma is not short, so it starts its own chunk.
	md := doc(section("# Guide", "g", 1), section("## Alpha", "a", 3), section("## Beta", "b", 3), section("## Gamma", "c", 30))
	v1 := mustSplit(t, md, opts(40, 0))
	got := mustSplit(t, md, v2(40, 0))
	if len(v1) != 4 || len(got) != 2 {
		t.Fatalf("version 1 %d chunks, version 2 %d; want 4 and 2: %q", len(v1), len(got), contents(got))
	}
	// Guide, Alpha and Beta share a chunk, each with its heading; Gamma (not short) starts its own.
	if h := headingsOf(got[0]); len(h) != 3 || h[1] != "## Alpha" || h[2] != "## Beta" {
		t.Errorf("first chunk headings = %q", h)
	}
	if h := headingsOf(got[1]); len(h) != 1 || h[0] != "## Gamma" {
		t.Errorf("second chunk headings = %q", h)
	}
	if got[0].Ordinal != 0 || got[1].Ordinal != 1 {
		t.Errorf("ordinals = %d, %d", got[0].Ordinal, got[1].Ordinal)
	}
}

func TestV2KeepsEverythingVersion1Keeps(t *testing.T) {
	// With no overlap and nothing dropped, version 2 only joins what version 1 cut at a section: the same text, in the same order.
	docs := append(fixtures(), generatedDoc())
	for _, md := range docs {
		for _, max := range []int{8, 16, 40, 128, 512} {
			a, b := mustSplit(t, md, opts(max, 0)), mustSplit(t, md, v2(max, 0))
			if strings.Join(contents(a), "\n\n") != strings.Join(contents(b), "\n\n") {
				t.Fatalf("max=%d: version 2 changed the text", max)
			}
			if len(b) > len(a) {
				t.Fatalf("max=%d: version 2 made %d chunks, version 1 %d", max, len(b), len(a))
			}
		}
	}
}

func TestV2OnRealPages(t *testing.T) {
	fewer := 0
	for _, d := range goldenCorpus(t) {
		if !strings.HasPrefix(d.name, "page-") {
			continue
		}
		for _, max := range []int{128, 256, 512} {
			a, b := mustSplit(t, d.md, opts(max, 0)), mustSplit(t, d.md, v2(max, 0))
			if strings.Join(contents(a), "\n\n") != strings.Join(contents(b), "\n\n") {
				t.Fatalf("%s max=%d: version 2 changed the text", d.name, max)
			}
			if len(b) > len(a) {
				t.Errorf("%s max=%d: %d chunks, version 1 %d", d.name, max, len(b), len(a))
			}
			if len(b) < len(a) {
				fewer++
			}
			mustSplit(t, d.md, v2(max, max/8)) // with overlap: the maximum and the text still hold
		}
	}
	if fewer == 0 {
		t.Error("version 2 left every real page with as many chunks as version 1; the rule never fired")
	}
}

func TestV2NeverMergesAcrossALevel1Heading(t *testing.T) {
	md := doc(section("# One", "a", 2), section("## Part", "b", 2), section("# Two", "c", 2), section("## Part", "d", 2))
	got := mustSplit(t, md, v2(40, 0))
	if len(got) != 2 {
		t.Fatalf("%d chunks, want 2 (one per level 1 heading): %q", len(got), contents(got))
	}
	if !strings.HasPrefix(got[1].Content, "# Two") {
		t.Errorf("the second chunk should start at '# Two': %q", got[1].Content)
	}
}

func TestV2OnlyMergesSectionsUnderTheChunksParent(t *testing.T) {
	// Words (marker included), floor 10: Doc 2+1=3, A 2+12=14, A1 2+2=4, B 2+2=4, B1 2+2=4.
	// Doc stands alone (A is not short); A fills its chunk, so A1 starts a new one, under parent A. B is a short section too, but it sits under
	// Doc, not under A, so it does not join A1's chunk. B then starts a chunk whose parent is Doc, and B1 (under B) does join it.
	md := doc(section("# Doc", "d", 1), section("## A", "a", 12), section("### A1", "p", 2), section("## B", "b", 2), section("### B1", "q", 2))
	got := mustSplit(t, md, v2(40, 0))
	var shape []string
	for _, c := range got {
		shape = append(shape, strings.Join(headingsOf(c), ","))
	}
	want := []string{"# Doc", "## A", "### A1", "## B,### B1"}
	if strings.Join(shape, " | ") != strings.Join(want, " | ") {
		t.Errorf("chunks by heading:\n  got  %q\n  want %q", shape, want)
	}
}

// The fit is also checked directly: the floor is MaxTokens/4, so a chunk and a section under it always fit and Split cannot reach the guard, but
// it protects any later change to the floor.
func TestMergeableChecksTheFit(t *testing.T) {
	marks := []pageMark{{0, 1}}
	last := &block{text: "a b", marks: marks, path: []string{"Top"}}
	next := &block{level: 2, text: "## C", marks: marks, path: []string{"Top", "C"}}
	sp := &splitter{max: 10, floor: 8, sepTok: 1, base: 6, secTok: []int{3}, parent: nil}
	sp.cur = []unit{{b: last, start: 0, end: 3, tokens: 2}}
	if !sp.mergeable(0, next) {
		t.Fatal("6 + 1 + 3 = 10 fits the maximum of 10, but it was refused")
	}
	sp.secTok[0] = 4 // 6 + 1 + 4 = 11 > 10
	if sp.mergeable(0, next) {
		t.Error("a merge that does not fit the maximum was allowed")
	}
}

func TestV2DoesNotMergeALongSectionIntoAShortOne(t *testing.T) {
	md := doc(section("# Guide", "g", 2), section("## Short", "s", 3), section("## Long", "l", 25))
	got := mustSplit(t, md, v2(40, 0)) // floor 10; Long is 25 words
	if len(got) != 2 || len(headingsOf(got[1])) != 1 || headingsOf(got[1])[0] != "## Long" {
		t.Errorf("a section over the floor should start its own chunk: %q", contents(got))
	}
}

func TestV2DoesNotMergeAcrossAPage(t *testing.T) {
	// Guide 2+1=3, One 2+3=5, Two 2+3=5 words: all three would merge (13 words, under the maximum) but for the page marker.
	md := doc(section("# Guide", "g", 1), section("## One", "a", 3), parse.PageMarker(2), section("## Two", "b", 3))
	got := mustSplit(t, md, v2(40, 0))
	if len(got) != 2 {
		t.Fatalf("%d chunks, want 2 (a page boundary between the sections): %q", len(got), contents(got))
	}
	if got[0].PageStart != 1 || got[0].PageEnd != 1 || got[1].PageStart != 2 {
		t.Errorf("pages = %d-%d, %d-%d", got[0].PageStart, got[0].PageEnd, got[1].PageStart, got[1].PageEnd)
	}
	// The same sections without the page marker do merge: the page is what stopped it.
	same := mustSplit(t, doc(section("# Guide", "g", 1), section("## One", "a", 3), section("## Two", "b", 3)), v2(40, 0))
	if len(same) != 1 {
		t.Errorf("without the page marker: %d chunks, want 1", len(same))
	}
}

func TestV2StaysWithinTheMaximum(t *testing.T) {
	// Short sections everywhere, with overlap, tight budgets and the real tokenizer: no chunk exceeds the maximum.
	for _, max := range []int{6, 12, 40, 200} {
		for _, md := range append(fixtures(), generatedDoc()) {
			mustSplit(t, md, v2(max, max/4))
		}
	}
	counter, err := NewTokenCounter()
	if err != nil {
		t.Fatal(err)
	}
	o := Options{MaxTokens: 64, OverlapTokens: 8, Counter: counter, Version: Version2}
	for _, md := range append(fixtures(), generatedDoc()) {
		mustSplit(t, md, o)
	}
}

func mustCounterSplit(t *testing.T, md string, o Options) []Chunk {
	t.Helper()
	cs, err := Split(md, o)
	if err != nil {
		t.Fatal(err)
	}
	return cs
}

func TestV2DropsChunksWithNoBody(t *testing.T) {
	keep := func(md string, o Options) []Chunk { o.DropImageOnly = true; return mustCounterSplit(t, md, o) }
	body := section("## Real", "r", 12)
	// A title and a rule with nothing under them: version 1 keeps the chunk (it has no image), version 2 drops it.
	md := "# Past Projects\n\n---\n\n" + "# Other\n\n" + strings.Repeat("word ", 30)
	v1 := keep(md, opts(40, 0))
	v2c := keep(md, v2(40, 0))
	if len(v1) == len(v2c) {
		t.Fatalf("version 1 %d chunks, version 2 %d: the bodyless chunk was not dropped", len(v1), len(v2c))
	}
	for _, c := range v2c {
		if bodyless(c.Content) {
			t.Errorf("a chunk with no body survived: %q", c.Content)
		}
	}
	for i, c := range v2c {
		if c.Ordinal != i {
			t.Errorf("ordinals not renumbered: %d at %d", c.Ordinal, i)
		}
	}
	// A real section is kept, and so is a heading and a sentence.
	if got := keep(body, v2(40, 0)); len(got) != 1 {
		t.Errorf("a section with a body was dropped: %q", contents(got))
	}
	// The only chunk of a document is never dropped, even with no body.
	if got := keep("# Only a title\n\n---", v2(40, 0)); len(got) != 1 {
		t.Errorf("the document's only chunk was dropped: %q", contents(got))
	}
	// Without DropImageOnly nothing is dropped, whatever the version.
	if got := mustSplit(t, md, v2(40, 0)); len(got) != len(v1) {
		t.Errorf("without DropImageOnly version 2 made %d chunks, want %d", len(got), len(v1))
	}
	// Version 1 still drops only an image-only chunk.
	img := "# Gallery\n\n![A building](<https://example.edu/b.png>)\n\n# Text\n\n" + strings.Repeat("word ", 30)
	if a, b := keep(img, opts(40, 0)), keep(img, v2(40, 0)); len(a) != len(b) {
		t.Errorf("an image-only chunk: version 1 %d chunks, version 2 %d; both drop it", len(a), len(b))
	}
}

func TestBodyless(t *testing.T) {
	for md, want := range map[string]bool{
		"# Title":                                  true,
		"# Title\n\n---":                           true,
		"## A\n\n## B":                             true,
		"# T\n\n![alt text](<https://x/y.png>)":    true,
		"# T\n\n[](https://example.edu/page)":      true,
		"# T\n\nOne sentence.":                     false,
		"# T\n\n- item":                            false,
		"# T\n\n![alt](<https://x/y.png>) caption": false,
		"2026": false,
		"---":  true,
	} {
		if got := bodyless(md); got != want {
			t.Errorf("bodyless(%q) = %v, want %v", md, got, want)
		}
	}
}

func TestVersions(t *testing.T) {
	md := doc(section("# Guide", "g", 3), section("## Alpha", "a", 4), section("## Beta", "b", 4))
	zero, one := mustSplit(t, md, opts(40, 0)), opts(40, 0)
	one.Version = Version1
	if a := mustSplit(t, md, one); strings.Join(contents(a), "|") != strings.Join(contents(zero), "|") {
		t.Error("version 0 and version 1 differ")
	}
	for _, v := range []int32{-1, 3, 99} {
		o := opts(40, 0)
		o.Version = v
		if _, err := Split(md, o); err == nil || !strings.Contains(err.Error(), "unknown version") {
			t.Errorf("version %d: err = %v, want an unknown version error", v, err)
		}
		if ValidVersion(v) {
			t.Errorf("ValidVersion(%d) = true", v)
		}
	}
	for _, v := range []int32{0, 1, 2} {
		if !ValidVersion(v) {
			t.Errorf("ValidVersion(%d) = false", v)
		}
	}
}

func TestV2IsDeterministicAndIdempotent(t *testing.T) {
	for _, md := range append(fixtures(), generatedDoc()) {
		o := v2(64, 8)
		a, b := mustSplit(t, md, o), mustSplit(t, md, o)
		if strings.Join(contents(a), "\x00") != strings.Join(contents(b), "\x00") {
			t.Fatal("version 2 is not deterministic")
		}
	}
}
