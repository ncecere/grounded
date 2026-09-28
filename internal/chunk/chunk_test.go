package chunk

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/parse"
)

// words counts whitespace-separated words, so test budgets are readable.
type words struct{}

func (words) Count(s string) int { return len(strings.Fields(s)) }

func opts(max, overlap int) Options {
	return Options{MaxTokens: max, OverlapTokens: overlap, Counter: words{}}
}

func mustSplit(t testing.TB, md string, o Options) []Chunk {
	t.Helper()
	cs, err := Split(md, o)
	if err != nil {
		t.Fatalf("Split: %v", err)
	}
	checkInvariants(t, md, o, cs)
	return cs
}

func contents(cs []Chunk) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.Content
	}
	return out
}

// sentence returns a capitalised n-word sentence tagged with id.
func sentence(id string, n int) string {
	w := make([]string, n)
	w[0] = "S" + id
	for i := 1; i < n; i++ {
		w[i] = fmt.Sprintf("w%s_%d", id, i)
	}
	return strings.Join(w, " ") + "."
}

// checkInvariants verifies the properties every Split result must have.
func checkInvariants(t testing.TB, md string, o Options, cs []Chunk) {
	t.Helper()
	for i, c := range cs {
		if c.Ordinal != i {
			t.Errorf("chunk %d: ordinal %d", i, c.Ordinal)
		}
		if strings.TrimSpace(c.Content) == "" {
			t.Errorf("chunk %d: empty content", i)
		}
		if n := o.Counter.Count(c.Content); c.Tokens != n {
			t.Errorf("chunk %d: Tokens %d, Count %d", i, c.Tokens, n)
		}
		if c.Tokens > o.MaxTokens {
			t.Errorf("chunk %d: %d tokens > max %d: %q", i, c.Tokens, o.MaxTokens, c.Content)
		}
		if c.HeadingPath == nil {
			t.Errorf("chunk %d: nil HeadingPath", i)
		}
		if c.PageStart > c.PageEnd {
			t.Errorf("chunk %d: pages %d-%d", i, c.PageStart, c.PageEnd)
		}
		for _, l := range strings.Split(c.Content, "\n") {
			// Marker-like text inside a longer source line may legitimately
			// end up alone on a line after a hard split.
			if _, ok := parse.ParsePageMarker(l); ok && !markerTextInProse(md) {
				t.Errorf("chunk %d: contains page marker", i)
			}
		}
	}
	// Every word of the input (minus page markers) appears in order; overlap
	// and repeated table headers/fences only add words. The word counter
	// never cuts inside a word; the real one may, so compare characters.
	want := sourceWords(md)
	var got []string
	for _, c := range cs {
		got = append(got, strings.Fields(c.Content)...)
	}
	if _, ok := o.Counter.(words); !ok {
		want = strings.Split(strings.Join(want, ""), "")
		got = strings.Split(strings.Join(got, ""), "")
	}
	j := 0
	for _, w := range got {
		if j < len(want) && w == want[j] {
			j++
		}
	}
	if j < len(want) {
		w := want[j]
		if len(w) > 40 {
			w = w[:40] + "..."
		}
		t.Errorf("text lost or reordered: word %d %q not found in order", j, w)
	}
}

func markerTextInProse(md string) bool {
	for _, l := range strings.Split(md, "\n") {
		if _, ok := parse.ParsePageMarker(l); !ok && parse.MayContainPageMarker(l) {
			return true
		}
	}
	return false
}

func sourceWords(md string) []string {
	md = strings.ReplaceAll(md, "\r\n", "\n")
	md = strings.ReplaceAll(md, "\r", "\n")
	var out []string
	for _, l := range strings.Split(md, "\n") {
		if _, ok := parse.ParsePageMarker(l); ok {
			continue
		}
		out = append(out, strings.Fields(l)...)
	}
	return out
}

func TestOptionsValidation(t *testing.T) {
	for _, tc := range []struct {
		name string
		o    Options
	}{
		{"zero max", Options{MaxTokens: 0, Counter: words{}}},
		{"negative overlap", Options{MaxTokens: 10, OverlapTokens: -1, Counter: words{}}},
		{"overlap not below max", Options{MaxTokens: 10, OverlapTokens: 10, Counter: words{}}},
		{"no counter", Options{MaxTokens: 10}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Split("text", tc.o); err == nil {
				t.Fatal("want error")
			}
		})
	}
	cs, err := Split(" \n\n \r\n ", opts(10, 0))
	if err != nil || len(cs) != 0 {
		t.Fatalf("blank doc: %v %v", cs, err)
	}
}

func TestHeadingsAndSections(t *testing.T) {
	type want struct {
		content string
		path    []string
	}
	tests := []struct {
		name string
		md   string
		max  int
		want []want
	}{
		{
			name: "path tracking and resets",
			md:   "# A\n\nintro\n\n## B\n\nb text\n\n### C\n\nc text\n\n## D\n\nd text\n\n# E\n\ne text",
			max:  100,
			want: []want{
				{"# A\n\nintro", []string{"A"}},
				{"## B\n\nb text", []string{"A", "B"}},
				{"### C\n\nc text", []string{"A", "B", "C"}},
				{"## D\n\nd text", []string{"A", "D"}},
				{"# E\n\ne text", []string{"E"}},
			},
		},
		{
			name: "level 4+ shares chunk with parent section",
			md:   "## A\n\ntext a\n\n#### Sub\n\nsub text\n\n##### Deeper\n\ndeep\n\n## B\n\ntext b",
			max:  100,
			want: []want{
				{"## A\n\ntext a\n\n#### Sub\n\nsub text\n\n##### Deeper\n\ndeep", []string{"A"}},
				{"## B\n\ntext b", []string{"B"}},
			},
		},
		{
			name: "text before first heading has empty path",
			md:   "preamble here\n\n# T\n\nbody",
			max:  100,
			want: []want{
				{"preamble here", []string{}},
				{"# T\n\nbody", []string{"T"}},
			},
		},
		{
			name: "heading with no body carries into next section",
			md:   "# Title\n\n## Intro\n\ntext",
			max:  100,
			want: []want{{"# Title\n\n## Intro\n\ntext", []string{"Title", "Intro"}}},
		},
		{
			name: "document of only headings",
			md:   "# A\n\n## B\n\n### C",
			max:  100,
			want: []want{{"# A\n\n## B\n\n### C", []string{"A", "B", "C"}}},
		},
		{
			name: "trailing heading is kept",
			md:   "# A\n\nbody\n\n## Empty",
			max:  100,
			want: []want{{"# A\n\nbody", []string{"A"}}, {"## Empty", []string{"A", "Empty"}}},
		},
		{
			name: "subheading at a chunk boundary moves to the next chunk",
			md:   "one two three four five six\n\n#### Sub\n\nseven eight nine ten",
			max:  8,
			want: []want{
				{"one two three four five six", []string{}},
				{"#### Sub\n\nseven eight nine ten", []string{"Sub"}},
			},
		},
		{
			name: "closing hashes and indentation",
			md:   "  ## Deadlines ##\n\ntext",
			max:  100,
			want: []want{{"## Deadlines ##\n\ntext", []string{"Deadlines"}}},
		},
		{
			name: "hash without space is not a heading",
			md:   "#hashtag text\n\nmore",
			max:  100,
			want: []want{{"#hashtag text\n\nmore", []string{}}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cs := mustSplit(t, tc.md, opts(tc.max, 3))
			var got []want
			for _, c := range cs {
				got = append(got, want{c.Content, c.HeadingPath})
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got  %q\nwant %q", got, tc.want)
			}
		})
	}
}

func TestSentenceSplit(t *testing.T) {
	var s []string
	for i := range 6 {
		s = append(s, sentence(fmt.Sprint(i), 5))
	}
	md := "## Long\n\n" + strings.Join(s, " ")
	cs := mustSplit(t, md, opts(12, 0))
	if len(cs) < 3 {
		t.Fatalf("want several chunks, got %q", contents(cs))
	}
	for i, c := range cs {
		if !strings.HasSuffix(c.Content, ".") {
			t.Errorf("chunk %d does not end at a sentence: %q", i, c.Content)
		}
		body := strings.TrimPrefix(c.Content, "## Long\n\n")
		if !strings.HasPrefix(body, "S") {
			t.Errorf("chunk %d does not start at a sentence: %q", i, c.Content)
		}
		if !reflect.DeepEqual(c.HeadingPath, []string{"Long"}) {
			t.Errorf("chunk %d path %q", i, c.HeadingPath)
		}
	}
	if !strings.HasPrefix(cs[0].Content, "## Long\n\nS0") {
		t.Errorf("heading should lead the first chunk: %q", cs[0].Content)
	}
	if strings.Contains(cs[1].Content, "## Long") {
		t.Errorf("heading must not be repeated: %q", cs[1].Content)
	}
}

func TestSentenceBoundaries(t *testing.T) {
	text := `He said "Stop." Then left. See e.g. the docs! Really? Yes 3.14 is pi.`
	var got []string
	for _, s := range sentenceSpans(text, span{0, len(text)}) {
		got = append(got, text[s.start:s.end])
	}
	want := []string{`He said "Stop."`, "Then left.", "See e.g. the docs!", "Really?", "Yes 3.14 is pi."}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestListSplitAtItems(t *testing.T) {
	var items []string
	for i := range 6 {
		items = append(items, fmt.Sprintf("- item%d alpha beta gamma", i))
		if i == 2 {
			items = append(items, "  - nested2 child words", "  - nested2 second child")
		}
	}
	md := strings.Join(items, "\n")
	cs := mustSplit(t, md, opts(14, 0))
	if len(cs) < 2 {
		t.Fatalf("want split, got %q", contents(cs))
	}
	for i, c := range cs {
		if !strings.HasPrefix(c.Content, "- item") {
			t.Errorf("chunk %d does not start at a top-level item: %q", i, c.Content)
		}
		for _, l := range strings.Split(c.Content, "\n") {
			if !strings.HasPrefix(strings.TrimLeft(l, " "), "- ") {
				t.Errorf("chunk %d has a broken item line %q", i, l)
			}
		}
		if strings.Contains(c.Content, "item2") != strings.Contains(c.Content, "nested2 second") {
			t.Errorf("chunk %d separates item2 from its children: %q", i, c.Content)
		}
	}
}

func TestLongListItemSplitsAtNestedLines(t *testing.T) {
	md := "- parent one two\n  - child a b c d\n  - child e f g h\n  - child i j k l\n- next item"
	cs := mustSplit(t, md, opts(8, 0))
	for i, c := range cs {
		for _, l := range strings.Split(c.Content, "\n") {
			if !strings.HasPrefix(strings.TrimLeft(l, " "), "- ") {
				t.Errorf("chunk %d: line split mid-item: %q", i, l)
			}
		}
	}
}

func TestTableSplitRepeatsHeader(t *testing.T) {
	header := "| Name | Deadline |\n| --- | --- |"
	rows := []string{}
	for i := range 10 {
		rows = append(rows, fmt.Sprintf("| row%d | day%d |", i, i))
	}
	md := "Intro text.\n\n" + header + "\n" + strings.Join(rows, "\n") + "\n\nAfter text."
	cs := mustSplit(t, md, opts(24, 0))
	seen := map[string]int{}
	tableChunks := 0
	for _, c := range cs {
		if !strings.Contains(c.Content, "| row") {
			continue
		}
		tableChunks++
		idx := strings.Index(c.Content, "| Name")
		if idx < 0 || !strings.HasPrefix(c.Content[idx:], header+"\n| row") {
			t.Errorf("table piece without header: %q", c.Content)
		}
		for _, l := range strings.Split(c.Content, "\n") {
			if strings.HasPrefix(l, "| row") {
				seen[l]++
			}
		}
	}
	if tableChunks < 2 {
		t.Fatalf("expected table split, got %q", contents(cs))
	}
	for _, r := range rows {
		if seen[r] != 1 {
			t.Errorf("row %q seen %d times", r, seen[r])
		}
	}
}

func TestTableWithoutSeparatorHasNoLead(t *testing.T) {
	md := "| a b | c |\n| d e | f |\n| g h | i |\n| j k | l |"
	cs := mustSplit(t, md, opts(10, 0))
	if len(cs) < 2 || strings.HasPrefix(cs[1].Content, "| a b") {
		t.Fatalf("unexpected: %q", contents(cs))
	}
}

func TestCodeFences(t *testing.T) {
	t.Run("kept intact", func(t *testing.T) {
		md := "Before.\n\n```go\n# not a heading\nfunc main() {\n\n\tfmt.Println(1)\n}\n```\n\nAfter."
		cs := mustSplit(t, md, opts(100, 0))
		if len(cs) != 1 || !strings.Contains(cs[0].Content, "```go\n# not a heading\nfunc main() {\n\n\tfmt.Println(1)\n}\n```") {
			t.Fatalf("got %q", contents(cs))
		}
		if len(cs[0].HeadingPath) != 0 {
			t.Fatalf("heading inside fence changed path: %q", cs[0].HeadingPath)
		}
	})
	t.Run("tilde fence with backticks inside", func(t *testing.T) {
		md := "~~~\n```\n## nope\n~~~\n\n## Yes\n\ntext"
		cs := mustSplit(t, md, opts(100, 0))
		if len(cs) != 2 || cs[0].Content != "~~~\n```\n## nope\n~~~" || cs[1].HeadingPath[0] != "Yes" {
			t.Fatalf("got %q", contents(cs))
		}
	})
	t.Run("split only at lines and re-fenced", func(t *testing.T) {
		var lines []string
		for i := range 20 {
			lines = append(lines, fmt.Sprintf("  call(a%d, b%d)", i, i))
		}
		md := "```python\n" + strings.Join(lines, "\n") + "\n```"
		cs := mustSplit(t, md, opts(12, 0))
		if len(cs) < 3 {
			t.Fatalf("want split, got %q", contents(cs))
		}
		seen := map[string]int{}
		for i, c := range cs {
			ls := strings.Split(c.Content, "\n")
			if ls[0] != "```python" || ls[len(ls)-1] != "```" {
				t.Errorf("chunk %d not fenced: %q", i, c.Content)
			}
			for _, l := range ls[1 : len(ls)-1] {
				seen[l]++
			}
		}
		for _, l := range lines {
			if seen[l] != 1 {
				t.Errorf("line %q seen %d times", l, seen[l])
			}
		}
	})
	t.Run("unclosed fence runs to end", func(t *testing.T) {
		md := "```\n# still code\n\nmore code"
		cs := mustSplit(t, md, opts(100, 0))
		if len(cs) != 1 || cs[0].Content != md || len(cs[0].HeadingPath) != 0 {
			t.Fatalf("got %q", contents(cs))
		}
	})
}

func TestHardSplitGiantRun(t *testing.T) {
	w := make([]string, 1000)
	for i := range w {
		w[i] = fmt.Sprintf("tok%d", i)
	}
	md := strings.Join(w, " ")
	cs := mustSplit(t, md, opts(50, 0))
	if len(cs) != 20 {
		t.Fatalf("want 20 chunks, got %d", len(cs))
	}
	for i, c := range cs {
		if c.Tokens != 50 {
			t.Errorf("chunk %d: %d tokens", i, c.Tokens)
		}
	}
	// One enormous word with the real counter.
	tc := realCounter(t)
	giant := strings.Repeat("abcdefghij", 5000)
	cs = mustSplit(t, giant, Options{MaxTokens: 100, Counter: tc})
	if len(cs) < 5 || strings.Join(contents(cs), "") != giant {
		t.Fatalf("giant word: %d chunks, text preserved=%v", len(cs), strings.Join(contents(cs), "") == giant)
	}
}

func TestOverlap(t *testing.T) {
	var s []string
	for i := range 8 {
		s = append(s, sentence(fmt.Sprint(i), 4))
	}
	t.Run("within a section", func(t *testing.T) {
		md := "## Sec\n\n" + strings.Join(s, " ")
		cs := mustSplit(t, md, opts(13, 4))
		if len(cs) < 3 {
			t.Fatalf("got %q", contents(cs))
		}
		for i := 1; i < len(cs); i++ {
			prev := cs[i-1].Content
			last := prev[strings.LastIndex(prev, "S"):]
			if !strings.HasPrefix(cs[i].Content, last+" ") {
				t.Errorf("chunk %d should start with overlap %q: %q", i, last, cs[i].Content)
			}
		}
	})
	t.Run("across paragraphs in a section", func(t *testing.T) {
		md := strings.Join(s[:3], " ") + "\n\n" + strings.Join(s[3:5], " ")
		cs := mustSplit(t, md, opts(14, 4))
		if len(cs) != 2 || !strings.HasPrefix(cs[1].Content, s[2]+"\n\n"+s[3]) {
			t.Fatalf("got %q", contents(cs))
		}
	})
	t.Run("absent across headings", func(t *testing.T) {
		md := "## A\n\n" + strings.Join(s[:3], " ") + "\n\n## B\n\n" + strings.Join(s[3:5], " ") +
			"\n\n#### C\n\n" + strings.Join(s[5:], " ")
		cs := mustSplit(t, md, opts(14, 4))
		want := []string{
			"## A\n\n" + strings.Join(s[:3], " "),
			"## B\n\n" + strings.Join(s[3:5], " "),
			"#### C\n\n" + strings.Join(s[5:], " "),
		}
		if !reflect.DeepEqual(contents(cs), want) {
			t.Fatalf("got  %q\nwant %q", contents(cs), want)
		}
	})
	t.Run("table overlap keeps header", func(t *testing.T) {
		md := "| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |\n| e | f |\n| g | h |\n| i | j |"
		cs := mustSplit(t, md, opts(20, 5))
		if len(cs) < 2 {
			t.Fatalf("got %q", contents(cs))
		}
		for _, c := range cs[1:] {
			if !strings.HasPrefix(c.Content, "| h1 | h2 |\n|---|---|\n") {
				t.Errorf("missing header: %q", c.Content)
			}
		}
	})
}

func TestPages(t *testing.T) {
	m := parse.PageMarker
	tests := []struct {
		name      string
		md        string
		max       int
		wantPages [][2]int
	}{
		{
			name:      "no markers",
			md:        "# A\n\none\n\n## B\n\ntwo",
			max:       100,
			wantPages: [][2]int{{0, 0}, {0, 0}},
		},
		{
			name:      "text before first marker is page 1; chunk spans pages",
			md:        "intro\n\n" + m(2) + "\n\npage two\n\n" + m(3) + "\n\npage three",
			max:       100,
			wantPages: [][2]int{{1, 3}},
		},
		{
			name: "sections across markers",
			md: m(1) + "\n\n# A\n\ntext\n\n" + m(2) + "\n\nmore\n\n## B\n\n" + m(3) +
				"\n\nb body\n\n## C\n\nc body",
			max:       100,
			wantPages: [][2]int{{1, 2}, {2, 3}, {3, 3}},
		},
		{
			name:      "split paragraph pages",
			md:        m(4) + "\n\nOne two three. Four five six.\n\n" + m(5) + "\n\nSeven eight nine.",
			max:       4,
			wantPages: [][2]int{{4, 4}, {4, 4}, {5, 5}},
		},
		{
			name:      "marker inside code fence",
			md:        m(1) + "\n\n```\nline1\n" + m(2) + "\nline2\n```",
			max:       100,
			wantPages: [][2]int{{1, 2}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cs := mustSplit(t, tc.md, opts(tc.max, 0))
			var got [][2]int
			for _, c := range cs {
				got = append(got, [2]int{c.PageStart, c.PageEnd})
			}
			if !reflect.DeepEqual(got, tc.wantPages) {
				t.Fatalf("pages %v want %v; chunks %q", got, tc.wantPages, contents(cs))
			}
		})
	}
	cs := mustSplit(t, m(1)+"\n\n```\nline1\n"+m(2)+"\nline2\n```", opts(100, 0))
	if cs[0].Content != "```\nline1\nline2\n```" {
		t.Fatalf("marker leaked into code: %q", cs[0].Content)
	}
}

// Parsed text stored before the rename to Grounded has legacy
// "<!-- ragd:page N -->" markers, and re-chunking (boilerplate suppression)
// reads that stored text: its pages must still be found, alone or mixed with
// current markers, and the markers must not leak into chunk text.
func TestLegacyPageMarkers(t *testing.T) {
	legacy := func(n int) string { return fmt.Sprintf("<!-- ragd:page %d -->", n) }
	for name, md := range map[string]string{
		"legacy only": legacy(1) + "\n\n# A\n\ntext\n\n" + legacy(2) + "\n\nmore\n\n## B\n\n" + legacy(3) + "\n\nb body",
		"mixed":       legacy(1) + "\n\n# A\n\ntext\n\n" + parse.PageMarker(2) + "\n\nmore\n\n## B\n\n" + legacy(3) + "\n\nb body",
	} {
		t.Run(name, func(t *testing.T) {
			cs := mustSplit(t, md, opts(100, 0))
			var got [][2]int
			for _, c := range cs {
				got = append(got, [2]int{c.PageStart, c.PageEnd})
				if strings.Contains(c.Content, ":page") {
					t.Errorf("marker leaked into chunk: %q", c.Content)
				}
			}
			if want := [][2]int{{1, 2}, {2, 3}}; !reflect.DeepEqual(got, want) {
				t.Fatalf("pages %v want %v; chunks %q", got, want, contents(cs))
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	cs := mustSplit(t, "\r\n\r\n# A\r\n\r\n\r\n\r\npara one   \r\nline two\r\n\n\n\n\npara two\r\n\r\n", opts(100, 0))
	if len(cs) != 1 || cs[0].Content != "# A\n\npara one\nline two\n\npara two" {
		t.Fatalf("got %q", contents(cs))
	}
}

func fixtures() []string {
	var s []string
	for i := range 12 {
		s = append(s, sentence(fmt.Sprint(i), 3+i%5))
	}
	return []string{
		"# A\n\nintro\n\n## B\n\nb text\n\n### C\n\nc text\n\n#### D\n\nd text",
		"# Title\n\n## Intro\n\n" + strings.Join(s, " "),
		"- a one\n- b two\n  - nested three\n  continuation\n\n- after blank\n\nparagraph",
		"| h | i |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\ntext after table",
		"```go\nfunc x() {\n\treturn\n}\n```\n\n~~~\nraw ``` inside\n~~~",
		parse.PageMarker(1) + "\n\ntext\n\n" + parse.PageMarker(2) + "\n\n## H\n\nmore " + strings.Join(s[:4], " "),
		strings.Repeat("word ", 300),
		strings.Repeat("x", 3000),
		"#\n\n##\n\n###### deep\n\n####### seven",
		"para line\n- interrupt list\n1. one\n2) two\n| t |",
		"```\nunclosed " + strings.Join(s, "\n"),
		"",
	}
}

func TestDeterminismAndInvariants(t *testing.T) {
	var sb strings.Builder
	for i := range 200 {
		fmt.Fprintf(&sb, "## Section %d\n\n%s\n\n", i, strings.Repeat(sentence(fmt.Sprint(i), 7)+" ", i%9))
		if i%7 == 0 {
			fmt.Fprintf(&sb, "%s\n\n| a | b |\n|---|---|\n%s\n", parse.PageMarker(i/7+1), strings.Repeat("| x y | z |\n", i%13))
		}
	}
	docs := append(fixtures(), sb.String())
	for _, md := range docs {
		for _, o := range []Options{opts(1, 0), opts(5, 2), opts(16, 4), opts(64, 16), opts(512, 64)} {
			a := mustSplit(t, md, o)
			b := mustSplit(t, md, o)
			if !reflect.DeepEqual(a, b) {
				t.Fatalf("non-deterministic for max=%d", o.MaxTokens)
			}
		}
	}
}

func TestEmbedText(t *testing.T) {
	c := Chunk{Content: "Body.", HeadingPath: []string{"Registration", "Late registration"}}
	for _, tc := range []struct {
		title string
		c     Chunk
		want  string
	}{
		{"Student Handbook", c, "Student Handbook\nRegistration > Late registration\n\nBody."},
		{"", c, "Registration > Late registration\n\nBody."},
		{"  Student\nHandbook ", Chunk{Content: "Body."}, "Student Handbook\n\nBody."},
		{"", Chunk{Content: "Body.", HeadingPath: []string{}}, "Body."},
		{"T", Chunk{HeadingPath: []string{"", "H"}}, "T\nH"},
	} {
		if got := EmbedText(tc.title, tc.c); got != tc.want {
			t.Errorf("EmbedText(%q) = %q, want %q", tc.title, got, tc.want)
		}
	}
}

func realCounter(t testing.TB) TokenCounter {
	t.Helper()
	tc, err := NewTokenCounter()
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

func TestRealCounter(t *testing.T) {
	tc := realCounter(t)
	for s, want := range map[string]int{
		"":                   0,
		"hello world":        2,
		"tiktoken is great!": 6,
		"<|endoftext|>":      7, // counted as ordinary text, never a special token
	} {
		if got := tc.Count(s); got != want {
			t.Errorf("Count(%q) = %d, want %d", s, got, want)
		}
	}
	var sb strings.Builder
	for i := range 40 {
		fmt.Fprintf(&sb, "## Part %d\n\n%s\n\n- item one for part %d\n- item two\n\n| k | v |\n|---|---|\n| a | %d |\n\n",
			i, strings.Repeat("Students must register before the deadline. Late fees apply. ", 1+i%12), i, i)
	}
	sb.WriteString(strings.Repeat("漢字テキスト", 2000))
	o := Options{MaxTokens: 128, OverlapTokens: 16, Counter: tc}
	cs := mustSplit(t, sb.String(), o)
	if len(cs) < 40 {
		t.Fatalf("got %d chunks", len(cs))
	}
}

func BenchmarkSplit30MB(b *testing.B) {
	tc := realCounter(b)
	var sb strings.Builder
	for i := 0; sb.Len() < 30<<20; i++ {
		fmt.Fprintf(&sb, "%s\n\n## Section %d\n\n%s\n\n- item a %d\n- item b\n\n",
			parse.PageMarker(i+1), i, strings.Repeat("The registrar publishes deadlines each term, and students should check them early. ", 1+i%20), i)
	}
	md := sb.String()
	b.SetBytes(int64(len(md)))
	for b.Loop() {
		if _, err := Split(md, Options{MaxTokens: 512, OverlapTokens: 64, Counter: tc}); err != nil {
			b.Fatal(err)
		}
	}
}

func FuzzSplit(f *testing.F) {
	for i, md := range fixtures() {
		f.Add(md, uint16(8+i*7), uint16(i))
	}
	f.Fuzz(func(t *testing.T, md string, max, overlap uint16) {
		if len(md) > 1<<16 {
			return
		}
		m := 1 + int(max%300)
		o := opts(m, int(overlap)%m)
		cs, err := Split(md, o)
		if err != nil {
			t.Fatal(err)
		}
		checkInvariants(t, md, o, cs)
	})
}
