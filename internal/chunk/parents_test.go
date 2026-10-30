package chunk

import (
	"fmt"
	"strings"
	"testing"
)

// kids makes chunks with the given heading paths (one string per chunk, "/"-separated) and tokens each.
func kids(tokens int, paths ...string) []Chunk {
	out := make([]Chunk, len(paths))
	for i, p := range paths {
		var hp []string
		if p != "" {
			hp = strings.Split(p, "/")
		}
		out[i] = Chunk{Ordinal: i, Content: fmt.Sprintf("child %d", i), HeadingPath: hp, Tokens: tokens}
	}
	return out
}

func ranges(rs []Range) string {
	parts := make([]string, len(rs))
	for i, r := range rs {
		parts[i] = fmt.Sprintf("%d-%d", r.First, r.Last)
	}
	return strings.Join(parts, " ")
}

func TestParentsOffAndEmpty(t *testing.T) {
	if got := Parents(kids(10, "A", "A"), 0); got != nil {
		t.Errorf("parent size 0 made %v, want none (the profile has no parents)", got)
	}
	if got := Parents(kids(10, "A"), -5); got != nil {
		t.Errorf("a negative size made %v", got)
	}
	if got := Parents(nil, 100); got != nil {
		t.Errorf("no chunks made %v", got)
	}
}

func TestParentsFollowSections(t *testing.T) {
	// Same heading path: one parent. A different path, including a deeper one, starts a new parent.
	got := Parents(kids(10, "A", "A", "A/B", "A/B", "A", "C"), 1000)
	if want := "0-1 0-1 2-3 2-3 4-4 5-5"; ranges(got) != want {
		t.Errorf("ranges = %s, want %s", ranges(got), want)
	}
}

func TestParentsHugeSectionIsCutGreedilyFromItsStart(t *testing.T) {
	// Ten children of 10 tokens in one section, parent size 35: three children fit (30), a fourth would make 40.
	got := Parents(kids(10, "A", "A", "A", "A", "A", "A", "A", "A", "A", "A"), 35)
	if want := "0-2 0-2 0-2 3-5 3-5 3-5 6-8 6-8 6-8 9-9"; ranges(got) != want {
		t.Errorf("ranges = %s, want %s", ranges(got), want)
	}
}

func TestParentsNoHeadingsAreWindows(t *testing.T) {
	got := Parents(kids(10, "", "", "", "", ""), 20)
	if want := "0-1 0-1 2-3 2-3 4-4"; ranges(got) != want {
		t.Errorf("ranges = %s, want %s", ranges(got), want)
	}
}

func TestParentsNeverExceedTheBoundOrTheChildCap(t *testing.T) {
	cs := kids(1, make([]string, 200)...)
	for _, r := range Parents(cs, 1000) {
		if r.Passages() > MaxParentChildren {
			t.Fatalf("a parent has %d children, the cap is %d", r.Passages(), MaxParentChildren)
		}
	}
	// A child larger than the bound is a parent of its own (the profile checks sizes, but the function must not loop or merge it).
	big := kids(10, "A", "A", "A")
	big[1].Tokens = 500
	if want := "0-0 1-1 2-2"; ranges(Parents(big, 100)) != want {
		t.Errorf("ranges = %s, want %s", ranges(Parents(big, 100)), want)
	}
	// The bound itself is capped.
	if got := Parents(kids(MaxParentTokens, "A", "A"), MaxParentTokens*4); ranges(got) != "0-0 1-1" {
		t.Errorf("the parent size is not capped at %d: %s", MaxParentTokens, ranges(got))
	}
}

func TestParentsBreakAtAGapInOrdinals(t *testing.T) {
	cs := kids(10, "A", "A", "A", "A")
	cs[2].Ordinal, cs[3].Ordinal = 7, 8 // a chunk list that skips ordinals is never joined across the gap
	if want := "0-1 0-1 7-8 7-8"; ranges(Parents(cs, 1000)) != want {
		t.Errorf("ranges = %s, want %s", ranges(Parents(cs, 1000)), want)
	}
}

// Every chunk is in exactly one parent, parents are contiguous, ordered and within the bound, for whatever the chunker makes of a real document,
// in every chunker version.
func TestParentsPartitionWhatTheChunkerMakes(t *testing.T) {
	var b strings.Builder
	for s := 0; s < 14; s++ {
		fmt.Fprintf(&b, "## Section %d\n\n", s)
		for p := 0; p < 1+s%4; p++ {
			fmt.Fprintf(&b, "%s\n\n", strings.Repeat(fmt.Sprintf("word%d_%d ", s, p), 20+10*(s%5)))
		}
		if s%3 == 0 {
			fmt.Fprintf(&b, "### Detail %d\n\n%s\n\n", s, strings.Repeat("detail ", 30))
		}
		if s%5 == 0 {
			b.WriteString("| a | b |\n|---|---|\n" + strings.Repeat("| 1 | 2 |\n", 30) + "\n")
		}
	}
	for _, version := range []int32{0, Version1, Version2} {
		for _, overlap := range []int{0, 5} {
			o := opts(40, overlap)
			o.Version = version
			cs := mustSplit(t, b.String(), o)
			rs := Parents(cs, 120)
			if len(rs) != len(cs) {
				t.Fatalf("v%d: %d ranges for %d chunks", version, len(rs), len(cs))
			}
			again := Parents(cs, 120)
			for i, c := range cs {
				if rs[i] != again[i] {
					t.Fatalf("v%d: not deterministic at %d", version, i)
				}
				if !rs[i].Contains(c.Ordinal) {
					t.Fatalf("v%d: chunk %d is outside its parent %v", version, c.Ordinal, rs[i])
				}
				sum := 0
				for _, k := range cs[rs[i].First : rs[i].Last+1] {
					sum += k.Tokens
					if !samePath(k.HeadingPath, c.HeadingPath) {
						t.Fatalf("v%d: parent %v mixes heading paths %q and %q", version, rs[i], k.HeadingPath, c.HeadingPath)
					}
				}
				if sum > 120 && rs[i].Passages() > 1 {
					t.Fatalf("v%d: parent %v has %d tokens, the bound is 120", version, rs[i], sum)
				}
				if i > 0 && rs[i] != rs[i-1] && rs[i].First != rs[i-1].Last+1 {
					t.Fatalf("v%d: parents %v and %v are not adjacent", version, rs[i-1], rs[i])
				}
			}
		}
	}
}

func TestParentTextRemovesOverlapAndKeepsEverythingElse(t *testing.T) {
	tail := "the fee is due on the first day of term"
	a := "Fees\n\nPayment details: " + tail
	b := tail + " and late fees apply after that."
	c := "Refunds are described below."
	if got, want := ParentText([]string{a, b, c}), a+"\n\n"+"and late fees apply after that."+"\n\n"+c; got != want {
		t.Errorf("ParentText = %q, want %q", got, want)
	}
	// Repeated table headers are not overlap: neither piece ends with what the next one starts with.
	p1 := "| name | fee |\n|---|---|\n| a | 1 |\n| b | 2 |"
	p2 := "| name | fee |\n|---|---|\n| c | 3 |"
	if got, want := ParentText([]string{p1, p2}), p1+"\n\n"+p2; got != want {
		t.Errorf("table pieces: %q, want %q", got, want)
	}
	if got := ParentText(nil); got != "" {
		t.Errorf("ParentText(nil) = %q", got)
	}
}
