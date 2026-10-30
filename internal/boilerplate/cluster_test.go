package boilerplate

import (
	"fmt"
	"math/rand"
	"os"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"
)

func sliceStream(docs []FuzzyDoc) DocStream {
	return func(yield func(FuzzyDoc) bool) error {
		for _, d := range docs {
			if !yield(d) {
				return nil
			}
		}
		return nil
	}
}

func fuzzyBlock(text string) FuzzyBlock {
	s, ok := SketchOf(text)
	if !ok || Hash(text) == 0 {
		panic("not eligible: " + text)
	}
	return FuzzyBlock{Hash: Hash(text), Sketch: s}
}

// siteDocs are n pages: a menu with page i's item highlighted (a different exact hash for each of the 12 items), a
// paragraph that is only on that page, and a footer with a date that differs per page.
func siteDocs(n int) []FuzzyDoc {
	docs := make([]FuzzyDoc, n)
	months := []string{"January", "March", "May", "July", "September", "November"}
	r := rand.New(rand.NewSource(int64(n)))
	for i := range docs {
		footer := fmt.Sprintf("Last updated %s %d, 202%d by the Office of the Test Registrar, 101 Main Hall, 555-0100.", months[i%len(months)], i%28+1, i%5)
		page := randomText(r, 20+r.Intn(10), 2000) // its own words
		docs[i] = FuzzyDoc{Ref: i, Blocks: []FuzzyBlock{fuzzyBlock(menu(i%12, false)), fuzzyBlock(footer), fuzzyBlock(page)}}
	}
	return docs
}

func TestClustersFindMenuAndFooterVariants(t *testing.T) {
	docs := siteDocs(60)
	got, exceeded, err := Clusters(sliceStream(docs), 12, DefaultLimits)
	if err != nil || exceeded {
		t.Fatalf("err %v, exceeded %v", err, exceeded)
	}
	if len(got) != 2 {
		t.Fatalf("clusters = %+v, want the menu and the footer", got)
	}
	for _, c := range got {
		if c.Docs != 60 || c.First != 0 || len(c.Members) < 2 {
			t.Errorf("cluster %+v: want every page, the first one keeping the copy", c)
		}
		if !slices.Contains(c.Members, c.Center) || !slices.IsSorted(c.Members) {
			t.Errorf("members %v, center %d", c.Members, c.Center)
		}
	}
	// 12 menu variants, and 6 footers (exact hashing folds the digits of the dates, not the months).
	sizes := []int{len(got[0].Members), len(got[1].Members)}
	slices.Sort(sizes)
	if !slices.Equal(sizes, []int{6, 12}) {
		t.Errorf("cluster sizes = %v, want the 6 footers and the 12 menus", sizes)
	}
	// None of the page paragraphs is in a cluster.
	in := map[int64]bool{}
	for _, c := range got {
		for _, h := range c.Members {
			in[h] = true
		}
	}
	for _, d := range docs {
		if in[d.Blocks[2].Hash] {
			t.Errorf("page %d's own paragraph was clustered", d.Ref)
		}
	}
}

func TestClustersNeedTheThreshold(t *testing.T) {
	docs := siteDocs(30)
	for _, c := range []struct {
		threshold int
		want      int
	}{{30, 2}, {31, 0}, {5, 2}} {
		got, _, err := Clusters(sliceStream(docs), c.threshold, DefaultLimits)
		if err != nil || len(got) != c.want {
			t.Errorf("threshold %d: %d clusters (%v), want %d", c.threshold, len(got), err, c.want)
		}
	}
}

func TestClustersLeaveDifferentBlocksAlone(t *testing.T) {
	// Every page has a paragraph on the same subject in other words: shared vocabulary, not near-duplicates.
	r := rand.New(rand.NewSource(3))
	vocab := strings.Fields("students office registrar deadline petition transcript enrollment hold dean course drop semester account request form fee policy record advisor credit grade")
	docs := make([]FuzzyDoc, 80)
	for i := range docs {
		words := make([]string, 22)
		for j := range words {
			words[j] = vocab[r.Intn(len(vocab))]
		}
		docs[i] = FuzzyDoc{Ref: i, Blocks: []FuzzyBlock{fuzzyBlock(strings.Join(words, " "))}}
	}
	got, exceeded, err := Clusters(sliceStream(docs), 5, DefaultLimits)
	if err != nil || exceeded || len(got) != 0 {
		t.Fatalf("clusters = %+v, exceeded %v, err %v", got, exceeded, err)
	}
}

// A star, not a chain: B is within reach of A and C of B, but C is not within reach of A, so C is not in A's cluster.
func TestClustersDoNotChain(t *testing.T) {
	var a, b, c Sketch
	for i := range a {
		a[i], b[i], c[i] = 1, 1, 1
	}
	for i := 16; i < 24; i++ {
		b[i], c[i] = 2, 2 // B differs from A in 8 values (agrees on 24)
	}
	for i := 24; i < 32; i++ {
		c[i] = 3 // C differs from B in 8 more: from A in 16 (agrees on 16)
	}
	if !Similar(a, b) || !Similar(b, c) || Similar(a, c) {
		t.Fatal("the fixture is not a chain")
	}
	docs := make([]FuzzyDoc, 10)
	for i := range docs {
		docs[i] = FuzzyDoc{Ref: i, Blocks: []FuzzyBlock{{Hash: 1, Sketch: a}, {Hash: 2, Sketch: b}, {Hash: 3, Sketch: c}}}
	}
	got, _, err := Clusters(sliceStream(docs), 2, DefaultLimits)
	if err != nil || len(got) != 1 || !reflect.DeepEqual(got[0].Members, []int64{1, 2}) {
		t.Fatalf("clusters = %+v, err %v: want {1, 2} only", got, err)
	}
}

func TestClustersLimits(t *testing.T) {
	docs := siteDocs(40)
	tight := DefaultLimits
	tight.Candidates = 3
	if got, exceeded, err := Clusters(sliceStream(docs), 2, tight); err != nil || !exceeded || got != nil {
		t.Errorf("too many candidates: %+v, exceeded %v, err %v", got, exceeded, err)
	}
	tight = DefaultLimits
	tight.Comparisons = 5
	if got, exceeded, err := Clusters(sliceStream(docs), 2, tight); err != nil || !exceeded || got != nil {
		t.Errorf("too many comparisons: %+v, exceeded %v, err %v", got, exceeded, err)
	}
	// The same input and limits always give the same answer.
	again, e1, _ := Clusters(sliceStream(docs), 2, tight)
	if e1 != true || again != nil {
		t.Error("the outcome at a limit changed between runs")
	}
}

// A small count-min sketch only adds candidates: what qualifies is found either way.
func TestClustersPrefilterNeverLosesACluster(t *testing.T) {
	docs := siteDocs(60)
	small := DefaultLimits
	small.CountMinBits = 3
	want, _, _ := Clusters(sliceStream(docs), 12, DefaultLimits)
	got, exceeded, err := Clusters(sliceStream(docs), 12, small)
	if err != nil || exceeded {
		t.Fatalf("err %v exceeded %v", err, exceeded)
	}
	members := func(cs []Cluster) (out []string) {
		for _, c := range cs {
			out = append(out, fmt.Sprint(c.Members))
		}
		slices.Sort(out)
		return out
	}
	if !reflect.DeepEqual(members(got), members(want)) {
		t.Errorf("with collisions: %v, without: %v", members(got), members(want))
	}
}

// The classification does not depend on the order documents, or blocks within them, arrive in (the property the
// refresh relies on): shuffled streams of random sites give the same clusters, with the same counts.
func TestClustersAreOrderIndependent(t *testing.T) {
	r := rand.New(rand.NewSource(11))
	for round := 0; round < 25; round++ {
		docs := siteDocs(20 + r.Intn(60))
		// Some pages lack the menu or have a second near-duplicate block, and each has some random block.
		for i := range docs {
			switch r.Intn(4) {
			case 0:
				docs[i].Blocks = docs[i].Blocks[1:]
			case 1:
				docs[i].Blocks = append(docs[i].Blocks, fuzzyBlock(menu((i+5)%12, true)))
			}
		}
		threshold := 3 + r.Intn(15)
		want, _, err := Clusters(sliceStream(docs), threshold, DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		shuffled := slices.Clone(docs)
		r.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
		for i := range shuffled {
			shuffled[i].Blocks = slices.Clone(shuffled[i].Blocks)
			r.Shuffle(len(shuffled[i].Blocks), func(a, b int) {
				shuffled[i].Blocks[a], shuffled[i].Blocks[b] = shuffled[i].Blocks[b], shuffled[i].Blocks[a]
			})
		}
		got, _, err := Clusters(sliceStream(shuffled), threshold, DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		strip := func(cs []Cluster) []Cluster { // which document keeps the copy is decided by the stream order, on purpose
			out := slices.Clone(cs)
			for i := range out {
				out[i].First = 0
			}
			return out
		}
		if !reflect.DeepEqual(strip(got), strip(want)) {
			t.Fatalf("round %d: shuffled %+v, in order %+v", round, got, want)
		}
	}
}

func TestClustersStreamErrors(t *testing.T) {
	boom := fmt.Errorf("boom")
	for failAt := 1; failAt <= 3; failAt++ {
		calls := 0
		stream := func(yield func(FuzzyDoc) bool) error {
			if calls++; calls == failAt {
				return boom
			}
			return sliceStream(siteDocs(20))(yield)
		}
		if _, _, err := Clusters(stream, 2, DefaultLimits); err != boom {
			t.Errorf("failing pass %d: err = %v", failAt, err)
		}
	}
}

// TestClustersAtScale measures a source of 100,000 documents of 30 eligible blocks each, streamed without being held:
// GROUNDED_FUZZY_SCALE=1 go test ./internal/boilerplate -run AtScale -v. The documents have a menu (12 variants), a
// footer (a date) and 28 blocks of their own.
func TestClustersAtScale(t *testing.T) {
	if os.Getenv("GROUNDED_FUZZY_SCALE") == "" {
		t.Skip("set GROUNDED_FUZZY_SCALE=1 to measure 100,000 documents")
	}
	const n = 100_000
	menus := make([]FuzzyBlock, 12)
	for i := range menus {
		menus[i] = fuzzyBlock(menu(i, false))
	}
	footer := fuzzyBlock("Last updated March 3, 2026 by the Office of the Test Registrar, 101 Main Hall, 555-0100.")
	footer2 := fuzzyBlock("Last updated June 9, 2025 by the Office of the Test Registrar, 101 Main Hall, 555-0100.")
	stream := func(yield func(FuzzyDoc) bool) error {
		r := rand.New(rand.NewSource(1))
		for i := 0; i < n; i++ {
			blocks := make([]FuzzyBlock, 0, 30)
			blocks = append(blocks, menus[i%12], []FuzzyBlock{footer, footer2}[i%2])
			for j := 0; j < 28; j++ {
				var s Sketch
				for k := range s {
					s[k] = byte(r.Intn(256))
				}
				blocks = append(blocks, FuzzyBlock{Hash: int64(i)*100 + int64(j) + 1000, Sketch: s})
			}
			if !yield(FuzzyDoc{Ref: i, Blocks: blocks}) {
				return nil
			}
		}
		return nil
	}
	// What generating the documents costs on its own (three passes), and the peak heap while clustering.
	genStart := time.Now()
	for range 3 {
		_ = stream(func(FuzzyDoc) bool { return true })
	}
	generating := time.Since(genStart)
	var peak uint64
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		var m runtime.MemStats
		for {
			runtime.ReadMemStats(&m)
			peak = max(peak, m.HeapAlloc)
			select {
			case <-stop:
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
	}()
	runtime.GC()
	start := time.Now()
	got, exceeded, err := Clusters(stream, 20_000, DefaultLimits)
	took := time.Since(start)
	close(stop)
	<-done
	if err != nil || exceeded || len(got) != 2 || got[0].Docs != n || got[1].Docs != n {
		t.Fatalf("clusters = %d, exceeded %v, err %v", len(got), exceeded, err)
	}
	t.Logf("%d documents of 30 blocks: %s in all, of which %s is generating them; peak heap %d MB", n, took.Round(10*time.Millisecond), generating.Round(10*time.Millisecond), peak>>20)
}
