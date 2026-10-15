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

// The golden test pins version 1's output, byte for byte, over the test fixtures, a generated document and five real pages of the documentation
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

func goldenLines(t *testing.T) []string {
	t.Helper()
	var lines []string
	for _, doc := range goldenCorpus(t) {
		for _, o := range goldenOptions() {
			lines = append(lines, goldenLine(doc, o, mustSplit(t, doc.md, o)))
		}
	}
	return lines
}

func TestGoldenV1(t *testing.T) {
	got := strings.Join(goldenLines(t), "\n") + "\n"
	if *updateGolden {
		if err := os.WriteFile(goldenFile, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", goldenFile)
		return
	}
	want, err := os.ReadFile(goldenFile)
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
			t.Errorf("version 1 output changed:\n  now:    %s\n  golden: %s", g[i], w[i])
			shown++
		}
	}
}
