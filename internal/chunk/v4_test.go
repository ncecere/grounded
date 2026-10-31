package chunk

import (
	"github.com/ncecere/grounded/internal/htmlmd"
	"math/rand"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

func TestV4StructuralBoundaries(t *testing.T) {
	for _, doc := range []string{
		"# Services\n\n## Routine\n\nSubmit form alpha.\n\n## Exception\n\nSubmit form beta.",
		"# Services\n\n#### Routine\n\nSubmit form alpha.\n\n#### Exception\n\nSubmit form beta.",
		"# Services\n\n**Routine**\n\n1. Submit form alpha.\n\n**Exception**\n\n1. Submit form beta.",
	} {
		t.Run(doc, func(t *testing.T) {
			o := v3(200, 10)
			old := mustSplit(t, doc, o)
			if len(old) != 1 {
				t.Fatalf("v3 reproduction changed: %q", contents(old))
			}
			o.Version = 4
			got := mustSplit(t, doc, o)
			if len(got) != 2 {
				t.Fatalf("mixed procedures: %q", contents(got))
			}
			if strings.Contains(got[0].Content, "beta") || strings.Contains(got[1].Content, "alpha") {
				t.Fatal("cross-boundary content")
			}
			if !reflect.DeepEqual(got, mustSplit(t, doc, o)) {
				t.Fatal("nondeterministic")
			}
		})
	}
}

func TestV4AdjacentProseControl(t *testing.T) {
	doc := "# Services\n\nSubmit form alpha.\n\nKeep the receipt for your records."
	o := v3(200, 10)
	want := mustSplit(t, doc, o)
	o.Version = 4
	got := mustSplit(t, doc, o)
	if len(got) != 1 || !reflect.DeepEqual(contents(got), contents(want)) {
		t.Fatalf("prose fragmented: %q", contents(got))
	}
}

func TestV4LabelEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, doc string
		count     int
	}{
		{"misleading labels still structural", "**Not a procedure:**\n\n- alpha\n\n__Still not a procedure__:\n\n- beta", 2},
		{"unicode", "**通常の申請**\n\n1. 提出します。\n\n**特殊な申請**\n\n1. 連絡します。", 2},
		{"inline emphasis", "Use **alpha** here.\n\n- first\n\nUse **beta** there.\n\n- second", 1},
		{"bold prose without list", "**Alpha**\n\nFirst paragraph.\n\n**Beta**\n\nSecond paragraph.", 1},
		{"plain colon labels ambiguous", "Alpha:\n\n- first\n\nBeta:\n\n- second", 1},
		{"nested labels", "- **Alpha**\n  1. first\n- **Beta**\n  1. second", 1},
		{"code", "```\n**Alpha**\n\n- first\n**Beta**\n\n- second\n```", 1},
		{"table cells", "| Label | Step |\n| --- | --- |\n| **Alpha** | first |\n| **Beta** | second |", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o := v3(500, 10)
			o.Version = 4
			got := mustSplit(t, tc.doc, o)
			if len(got) != tc.count {
				t.Fatalf("got %q", contents(got))
			}
		})
	}
}

func TestV4ParentsPagesDropsAndTables(t *testing.T) {
	doc := "<!-- grounded:page 1 -->\n# Services\n\n**Same**\n\n1. alpha\n   - nested step\n\n| Item | Cost |\n| --- | --- |\n| apple | 2 |\n\n<!-- grounded:page 2 -->\n**Same**\n\n1. beta"
	for _, drop := range []bool{false, true} {
		o := v3(100, 10)
		o.Version = 4
		if drop {
			o.DropBlock = func(s string) bool { return s == "**Same**" }
		}
		got, err := Split(doc, o)
		if err != nil {
			t.Fatal(err)
		}
		expected := doc
		if drop {
			expected = strings.ReplaceAll(expected, "**Same**\n\n", "")
		}
		checkInvariants(t, expected, o, got)
		if len(got) != 2 {
			t.Fatalf("drop=%v: %q", drop, contents(got))
		}
		parents := Parents(got, 1000)
		if parents[0].Last != 0 || parents[1].First != 1 {
			t.Fatalf("distinct identical labels reunited: %+v", parents)
		}
		if got[0].PageStart != 1 || got[0].PageEnd != 1 || got[1].PageStart != 2 {
			t.Fatalf("pages: %+v", got)
		}
		if !strings.Contains(got[0].Content, "| apple | 2 |") || strings.Contains(got[1].Content, "apple") {
			t.Fatal("table crossed boundary")
		}
	}
}

func TestV4OversizedUnits(t *testing.T) {
	counter, err := NewTokenCounter()
	if err != nil {
		t.Fatal(err)
	}
	doc := "# Services\n\n**Alpha**\n\n1. " + strings.Repeat("Long sentence with Unicode 日本語. ", 80) + "\n\n**Beta**\n\n1. final unique step"
	o := Options{Version: 4, MaxTokens: 64, OverlapTokens: 8, Counter: counter}
	got := mustSplit(t, doc, o)
	if len(got) < 3 {
		t.Fatal("oversize not split")
	}
	for i, c := range got {
		if c.Ordinal != i || c.Tokens > 64 || c.Tokens != counter.Count(c.Content) {
			t.Fatalf("invalid chunk: %+v", c)
		}
		if strings.Contains(c.Content, "final unique") && strings.Contains(c.Content, "Long sentence") {
			t.Fatal("oversize crossed boundary")
		}
	}
	if !reflect.DeepEqual(got, mustSplit(t, doc, o)) {
		t.Fatal("nondeterministic")
	}
}

func TestV4CrawledHTMLStructure(t *testing.T) {
	base, _ := url.Parse("https://example.edu/services")
	raw := `<html><body><main><h1>Services</h1><p><strong>Routine</strong></p><ol><li>Submit alpha.</li></ol><p><strong>Exception</strong></p><ol><li>Submit beta.</li></ol></main></body></html>`
	parsed, err := htmlmd.Convert([]byte(raw), htmlmd.Options{BaseURL: base})
	if err != nil {
		t.Fatal(err)
	}
	original := parsed.Markdown
	o := v3(200, 10)
	if old := mustSplit(t, original, o); len(old) != 1 {
		t.Fatalf("not reproduced: %q", contents(old))
	}
	o.Version = 4
	got := mustSplit(t, original, o)
	if len(got) != 2 || !strings.Contains(got[0].Content, "alpha") || !strings.Contains(got[1].Content, "beta") {
		t.Fatalf("mixed: %q", contents(got))
	}
	if parsed.Markdown != original {
		t.Fatal("parsed source changed")
	}
}

func TestV4GeneratedStructureProperties(t *testing.T) {
	for seed := int64(0); seed < 60; seed++ {
		md, _ := genDoc(rand.New(rand.NewSource(seed)), 64)
		o := v3(64, int(seed%12))
		o.Version = 4
		got := mustSplit(t, md, o)
		if !reflect.DeepEqual(got, mustSplit(t, md, o)) {
			t.Fatalf("seed %d nondeterministic", seed)
		}
		parents := Parents(got, 512)
		for i, r := range parents {
			for j := r.First; j <= r.Last; j++ {
				if got[i].section != got[j].section {
					t.Fatalf("seed %d crossed section", seed)
				}
			}
		}
	}
}
