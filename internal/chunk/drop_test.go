package chunk

import (
	"reflect"
	"strings"
	"testing"
)

const siteDoc = `## QUICKLINKS

- [Schedule](<https://example.edu/soc>)
- [Deadlines](<https://example.edu/dates>)

# Drop/Add

Courses may be dropped or added during the first week.

## Late drops

A late drop needs a petition to the college.

Footer © 2026 Example University`

func TestBlocks(t *testing.T) {
	got := Blocks(siteDoc)
	want := []Block{
		{"## QUICKLINKS", true},
		{"- [Schedule](<https://example.edu/soc>)\n- [Deadlines](<https://example.edu/dates>)", false},
		{"# Drop/Add", true},
		{"Courses may be dropped or added during the first week.", false},
		{"## Late drops", true},
		{"A late drop needs a petition to the college.", false},
		{"Footer © 2026 Example University", false},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Blocks =\n%#v\nwant\n%#v", got, want)
	}
	if Blocks("  \n\n ") != nil {
		t.Fatal("empty document has no blocks")
	}
}

func dropTexts(texts ...string) func(string) bool {
	set := map[string]bool{}
	for _, t := range texts {
		set[t] = true
	}
	return func(s string) bool { return set[s] }
}

func TestSplitDropBlock(t *testing.T) {
	o := opts(100, 0)
	o.DropBlock = dropTexts(
		"## QUICKLINKS",
		"- [Schedule](<https://example.edu/soc>)\n- [Deadlines](<https://example.edu/dates>)",
		"Footer © 2026 Example University",
	)
	cs, err := Split(siteDoc, o)
	if err != nil {
		t.Fatal(err)
	}
	all := strings.Join(contents(cs), "\n")
	for _, gone := range []string{"QUICKLINKS", "Schedule", "Footer"} {
		if strings.Contains(all, gone) {
			t.Errorf("dropped block %q still in chunks: %q", gone, all)
		}
	}
	for _, kept := range []string{"# Drop/Add", "first week", "petition"} {
		if !strings.Contains(all, kept) {
			t.Errorf("content %q lost: %q", kept, all)
		}
	}
	if len(cs) != 2 || !reflect.DeepEqual(cs[1].HeadingPath, []string{"Drop/Add", "Late drops"}) {
		t.Fatalf("chunks = %#v", cs)
	}
}

// A repeated heading may be dropped as a block, but the text under it keeps
// the heading in its path (context for embedding and citations), and the
// section still starts a new chunk.
func TestSplitDropHeadingKeepsPathAndBreak(t *testing.T) {
	md := "# Guide\n\nIntro text here.\n\n## Contact us\n\nCall 555-0100 or write to the office."
	o := opts(100, 0)
	o.DropBlock = dropTexts("## Contact us")
	cs, err := Split(md, o)
	if err != nil {
		t.Fatal(err)
	}
	if len(cs) != 2 {
		t.Fatalf("want the dropped section heading to keep its chunk boundary, got %q", contents(cs))
	}
	if strings.Contains(cs[1].Content, "Contact us") {
		t.Fatalf("dropped heading still in content: %q", cs[1].Content)
	}
	if want := []string{"Guide", "Contact us"}; !reflect.DeepEqual(cs[1].HeadingPath, want) {
		t.Fatalf("HeadingPath = %v, want %v", cs[1].HeadingPath, want)
	}
}

func TestImageOnly(t *testing.T) {
	yes := []string{
		"![Front side of Main Hall building](<https://example.edu/a.webp>)",
		"![a](x.png)\n\n![b \\[1\\]](<y.png> \"t\")",
		"## Gallery\n\n![Campus](<https://example.edu/c.jpg>)\n\n---",
		"[![Logo](<https://example.edu/logo.svg>)](<https://example.edu/>)",
	}
	no := []string{
		"Plain text with no image.",
		"![Map](<m.png>) The office is in Main Hall, room S107.",
		"![](<line.svg>)\n\n352-392-2244",
		"## Heading only",
	}
	for _, s := range yes {
		if !ImageOnly(s) {
			t.Errorf("ImageOnly(%q) = false, want true", s)
		}
	}
	for _, s := range no {
		if ImageOnly(s) {
			t.Errorf("ImageOnly(%q) = true, want false", s)
		}
	}
}

func TestSplitDropImageOnly(t *testing.T) {
	md := "# Office\n\n![Front of the building](<https://example.edu/f.webp>)\n\n# Hours\n\nOpen 8-5 weekdays. ![Clock](<c.png>)"
	o := opts(100, 0)
	o.DropImageOnly = true
	cs, err := Split(md, o)
	if err != nil {
		t.Fatal(err)
	}
	if len(cs) != 1 || cs[0].Ordinal != 0 || !strings.Contains(cs[0].Content, "![Clock]") {
		t.Fatalf("want only the text chunk (alt text kept inline), got %#v", cs)
	}
	// A document of nothing but images keeps them.
	only := "![Just a picture](<p.png>)"
	cs, err = Split(only, o)
	if err != nil || len(cs) != 1 {
		t.Fatalf("image-only document: %v %#v", err, cs)
	}
}
