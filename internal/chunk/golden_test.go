package chunk

import (
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/parse"
)

// The golden tests pin each version's output, byte for byte, over the test fixtures, a generated document and five real pages of the documentation
// site (testdata/docs): every profile uses version 1 unless an admin chooses another, and an index that moves without anyone choosing it would be
// a silent change to what a knowledge base finds. Each line of testdata/golden-v1.txt is a document, an option set, the number of chunks and
// tokens, and the hash of every chunk's ordinal, heading path, pages, token count and text. Run `go test ./internal/chunk -run TestGoldenV1
// -update-golden` only for a change that is meant to move version 1 (there should not be one: add a version instead).
var updateGolden = flag.Bool("update-golden", false, "rewrite testdata/golden-v1.txt from the current output")

const goldenFile = "testdata/golden-v1.txt"

type goldenDoc struct{ name, md string }

func generatedDoc() string {
	var sb strings.Builder
	for i := range 200 {
		fmt.Fprintf(&sb, "## Section %d\n\n%s\n\n", i, strings.Repeat(sentence(fmt.Sprint(i), 7)+" ", i%9))
		if i%7 == 0 {
			fmt.Fprintf(&sb, "%s\n\n| a | b |\n|---|---|\n%s\n", parse.PageMarker(i/7+1), strings.Repeat("| x y | z |\n", i%13))
		}
	}
	return sb.String()
}

func goldenCorpus(t *testing.T) []goldenDoc {
	t.Helper()
	var out []goldenDoc
	for i, md := range fixtures() {
		out = append(out, goldenDoc{fmt.Sprintf("fixture-%02d", i), md})
	}
	out = append(out, goldenDoc{"generated-sections", generatedDoc()})
	pages, err := filepath.Glob("testdata/docs/*.md")
	if err != nil || len(pages) == 0 {
		t.Fatalf("no real pages in testdata/docs: %v", err)
	}
	for _, p := range pages { // Glob returns them sorted
		b, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, goldenDoc{"page-" + strings.TrimSuffix(filepath.Base(p), ".md"), string(b)})
	}
	return out
}

// goldenOptions are the option sets each document is cut with (word counts as tokens, so the budgets are readable); the last two are how ingestion
// calls the chunker (it drops chunks that are only images).
func goldenOptions() []Options {
	imageOnly := opts(128, 32)
	imageOnly.DropImageOnly = true
	small := opts(48, 8)
	small.DropImageOnly = true
	return []Options{opts(16, 4), opts(64, 16), opts(128, 32), opts(512, 64), imageOnly, small}
}

func goldenLine(doc goldenDoc, o Options, cs []Chunk) string {
	h := sha256.New()
	tokens := 0
	for _, c := range cs {
		fmt.Fprintf(h, "%d|%s|%d|%d|%d|%s\x00", c.Ordinal, strings.Join(c.HeadingPath, " > "), c.PageStart, c.PageEnd, c.Tokens, c.Content)
		tokens += c.Tokens
	}
	return fmt.Sprintf("%s max=%d overlap=%d dropImageOnly=%t: chunks=%d tokens=%d sha256=%s", doc.name, o.MaxTokens, o.OverlapTokens, o.DropImageOnly, len(cs), tokens, hex.EncodeToString(h.Sum(nil)))
}

// tableCorpus is documents rich in tables, in the shapes the parsers write (internal/htmlmd, the DOCX and PPTX parsers) and the ways a table can sit in
// a page: a caption above, inside a list item, several to a section, with no header row, on a paginated page, with one very long row.
func tableCorpus() []goldenDoc {
	rows := func(n int, cols int, tag string) string {
		var sb strings.Builder
		for i := range n {
			sb.WriteString("|")
			for c := range cols {
				fmt.Fprintf(&sb, " %s%d.%d value %d |", tag, i, c, i*c)
			}
			sb.WriteString("\n")
		}
		return sb.String()
	}
	header := func(cols ...string) string {
		return "| " + strings.Join(cols, " | ") + " |\n|" + strings.Repeat(" --- |", len(cols)) + "\n"
	}
	indent := func(s string) string {
		return "  " + strings.ReplaceAll(strings.TrimRight(s, "\n"), "\n", "\n  ") + "\n"
	}
	long := strings.Repeat("The committee reviews every request in writing. ", 40)
	return []goldenDoc{
		{"table-fits", "# Fees\n\nTuition and fees for the year.\n\n" + header("Item", "Amount") + rows(5, 2, "f") + "\nPayment is due on the first day of term.\n"},
		{"table-over-long", "# Schedule\n\n## Fall\n\nCourses by day.\n\n" + header("Course", "Day", "Room") + rows(60, 3, "c") + "\nSee the registrar for changes.\n"},
		{"table-sections", "# Guide\n\n## One\n\nIntro one.\n\n" + header("A", "B") + rows(3, 2, "p") + "\n## Two\n\nIntro two.\n\n" + header("C", "D") + rows(30, 2, "q") + "\nBetween tables.\n\n" + header("E", "F") + rows(4, 2, "r") + "\n## Three\n\nEnd.\n"},
		{"table-in-list", "# Steps\n\n- Check the fees\n\n" + indent("Fee table\n\n"+header("Item", "Amount")+rows(25, 2, "l")) + "\n- Pay online\n- Keep the receipt\n"},
		{"table-headerless", "# Notes\n\n" + rows(30, 2, "h") + "\nAfter the rows.\n"},
		{"table-paged", parse.PageMarker(1) + "\n\n# Report\n\nResults by term.\n\n" + header("Term", "Count") + rows(20, 2, "t") + "\n" + parse.PageMarker(2) + "\n\nSummary.\n\n" + header("Total", "Share") + rows(20, 2, "u")},
		{"table-long-row", "# Policies\n\nSummary of policies.\n\n| Policy | Text | Owner |\n| --- | --- | --- |\n| Late work | " + long + " | Registrar |\n| Appeals | short | Dean |\n"},
		{"table-wide", "# Wide\n\n" + header("a", "b", "c", "d", "e", "f", "g", "h") + rows(15, 8, "w")},
	}
}

func goldenLines(t *testing.T, version int32, corpus []goldenDoc) []string {
	t.Helper()
	var lines []string
	for _, doc := range corpus {
		for _, o := range goldenOptions() {
			o.Version = version
			lines = append(lines, goldenLine(doc, o, mustSplit(t, doc.md, o)))
		}
	}
	return lines
}

func checkGolden(t *testing.T, file string, lines []string, what string) {
	t.Helper()
	got := strings.Join(lines, "\n") + "\n"
	if *updateGolden {
		if err := os.WriteFile(file, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", file)
		return
	}
	want, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("%v (generate it with -update-golden)", err)
	}
	if got == string(want) {
		return
	}
	g, w := strings.Split(got, "\n"), strings.Split(string(want), "\n")
	if len(g) != len(w) {
		t.Errorf("%d lines, golden has %d", len(g), len(w))
	}
	shown := 0
	for i := 0; i < len(g) && i < len(w) && shown < 8; i++ {
		if g[i] != w[i] {
			t.Errorf("%s output changed:\n  now:    %s\n  golden: %s", what, g[i], w[i])
			shown++
		}
	}
}

func TestGoldenV1(t *testing.T) {
	checkGolden(t, goldenFile, goldenLines(t, 0, goldenCorpus(t)), "version 1")
}

// Version 2 is pinned over the same documents and the table documents (golden-v2.txt was written before version 3 existed, from the code of version 2
// as released, so a table change that leaked into it would show here), and version 1 over the table documents.
func TestGoldenV2(t *testing.T) {
	checkGolden(t, "testdata/golden-v2.txt", goldenLines(t, Version2, append(goldenCorpus(t), tableCorpus()...)), "version 2")
}

func TestGoldenTablesV1(t *testing.T) {
	checkGolden(t, "testdata/golden-tables-v1.txt", goldenLines(t, Version1, tableCorpus()), "version 1 on tables")
}

// Version 3 is pinned over everything: documents without a table come out as version 2 cuts them (TestV3EqualsV2WithoutTables), and the table documents
// show what version 3 changes.
func TestGoldenV3(t *testing.T) {
	checkGolden(t, "testdata/golden-v3.txt", goldenLines(t, Version3, append(goldenCorpus(t), tableCorpus()...)), "version 3")
}
