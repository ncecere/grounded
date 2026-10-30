package chunk

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"testing"
)

// The golden test of parents pins, over the same corpus and option sets as version 1's golden test and for chunker versions 1 and 2, how a
// document's chunks are grouped into parents at a parent size of four chunks' worth: the number of parents and a hash of every chunk's range. A
// change to how parents are made moves what an agent's model is given for every profile that has them, so it is a deliberate change: run
// `go test ./internal/chunk -run TestGoldenParents -update-golden` for one. Profiles without parents do not run this code at all
// (TestParentsOffAndEmpty), and version 1's own golden file is untouched by it.
const goldenParentsFile = "testdata/golden-parents.txt"

func goldenParentLines(t *testing.T) []string {
	t.Helper()
	var lines []string
	for _, doc := range goldenCorpus(t) {
		for _, o := range goldenOptions() {
			for _, version := range []int32{Version1, Version2} {
				o.Version = version
				cs := mustSplit(t, doc.md, o)
				size := 4 * o.MaxTokens
				rs := Parents(cs, size)
				h := sha256.New()
				parents := map[Range]bool{}
				for i, r := range rs {
					fmt.Fprintf(h, "%d|%d-%d\x00", i, r.First, r.Last)
					parents[r] = true
				}
				lines = append(lines, fmt.Sprintf("%s v%d max=%d overlap=%d dropImageOnly=%t parent=%d: chunks=%d parents=%d sha256=%s",
					doc.name, version, o.MaxTokens, o.OverlapTokens, o.DropImageOnly, size, len(cs), len(parents), hex.EncodeToString(h.Sum(nil))))
			}
		}
	}
	return lines
}

func TestGoldenParents(t *testing.T) {
	got := strings.Join(goldenParentLines(t), "\n") + "\n"
	if *updateGolden {
		if err := os.WriteFile(goldenParentsFile, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", goldenParentsFile)
		return
	}
	want, err := os.ReadFile(goldenParentsFile)
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
			t.Errorf("parents changed:\n  now:    %s\n  golden: %s", g[i], w[i])
			shown++
		}
	}
}
