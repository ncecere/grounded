package chunk

import (
	"fmt"
	"math/rand"
	"regexp"
	"strings"
	"testing"
)

// Property test for chunker version 3: over random documents of headings, prose, lists and tables (in the shapes the parsers write, with captions, in
// list items, with no header row, with very long cells), no cell of any table is ever lost or repeated, every passage is within the limit, every
// passage with rows of a table has the table's header above them (when the header is small enough to repeat), and a table that fits a passage is
// never cut. The words of table cells are unique ("T<table>r<row>c<col>w<n>"), so "lost or repeated" is a count of exactly one.

var cellWord = regexp.MustCompile(`^T\d+r\d+c\d+w\d+$`)

type genTable struct {
	id         int
	cols       int
	rows       int
	caption    string // "" for none
	indent     string // "  " for a table in a list item
	headerless bool
	header     string // the header line, "" when headerless
	leadWords  int    // words of what repeats in every piece: caption, header and separator
	words      int    // words of the whole block: the lead and the rows
	cellWords  []string
}

// genDoc writes a random document for passages of limit tokens and describes its tables.
func genDoc(rng *rand.Rand, limit int) (string, []*genTable) {
	var sb strings.Builder
	var tables []*genTable
	prevPara := 0 // words of the paragraph just written, which a table without a caption of its own takes as one
	for part := range 1 + rng.Intn(8) {
		para := 0
		switch rng.Intn(6) {
		case 0:
			fmt.Fprintf(&sb, "%s Heading%d\n\n", strings.Repeat("#", 1+rng.Intn(4)), part)
		case 1:
			para = 3 + rng.Intn(30)
			fmt.Fprintf(&sb, "%s\n\n", sentence(fmt.Sprintf("p%d", part), para))
		case 2:
			fmt.Fprintf(&sb, "- item %d one\n- item %d two\n\n", part, part)
		default:
			t := genTableDoc(rng, len(tables))
			if t.caption == "" && !t.headerless && t.indent == "" && prevPara > 0 && prevPara <= max(min(48, limit/4), 1) {
				t.leadWords += prevPara
				t.words += prevPara
			}
			tables = append(tables, t)
			sb.WriteString(t.render(rng, part))
		}
		prevPara = para
	}
	return sb.String(), tables
}

// genTableDoc chooses a table's shape; render writes its text.
func genTableDoc(rng *rand.Rand, id int) *genTable {
	t := &genTable{id: id, cols: 1 + rng.Intn(5), rows: rng.Intn(41), headerless: rng.Intn(6) == 0}
	if rng.Intn(3) == 0 && !t.headerless {
		t.caption = fmt.Sprintf("Table %d: caption.", id)
	}
	if rng.Intn(4) == 0 {
		t.indent = "  "
	}
	return t
}

func (t *genTable) render(rng *rand.Rand, part int) string {
	var sb strings.Builder
	if t.indent != "" {
		fmt.Fprintf(&sb, "- list item %d\n\n", part)
	}
	if t.caption != "" {
		sb.WriteString(t.indent + t.caption + "\n\n")
		t.leadWords += len(strings.Fields(t.caption))
	}
	if !t.headerless {
		cols := make([]string, t.cols)
		for c := range cols {
			cols[c] = fmt.Sprintf("H%dc%d", t.id, c)
		}
		t.header = t.indent + "| " + strings.Join(cols, " | ") + " |"
		sep := t.indent + "|" + strings.Repeat(" --- |", t.cols)
		sb.WriteString(t.header + "\n" + sep + "\n")
		t.leadWords += len(strings.Fields(t.header)) + len(strings.Fields(sep))
	}
	t.words = t.leadWords
	for r := range t.rows {
		line := t.indent + "|"
		for c := range t.cols {
			n := 1 + rng.Intn(4)
			if rng.Intn(40) == 0 {
				n = 40 + rng.Intn(60) // a cell bigger than many passages
			}
			var ws []string
			for k := range n {
				w := fmt.Sprintf("T%dr%dc%dw%d", t.id, r, c, k)
				ws = append(ws, w)
				t.cellWords = append(t.cellWords, w)
				if rng.Intn(15) == 0 {
					ws = append(ws, `\|`)
				}
			}
			line += " " + strings.Join(ws, " ") + " |"
		}
		t.words += len(strings.Fields(line))
		sb.WriteString(line + "\n")
	}
	sb.WriteString("\n")
	return sb.String()
}

// checkTableProperty cuts a random document with version 3 and checks everything the property says.
func checkTableProperty(t *testing.T, seed int64, max, overlap int, dropImageOnly bool) {
	t.Helper()
	rng := rand.New(rand.NewSource(seed))
	md, tables := genDoc(rng, max)
	o := v3(max, overlap)
	cs := mustSplit(t, md, o) // the limit, the order and every word of the text
	if dropImageOnly {
		// As ingestion cuts: a passage with no body (a last heading, say) is dropped, but never one with a table row in it.
		o.DropImageOnly = true
		var err error
		if cs, err = Split(md, o); err != nil {
			t.Fatal(err)
		}
	}
	where := func() string {
		return fmt.Sprintf("seed %d max %d overlap %d drop %v\n%s", seed, max, overlap, dropImageOnly, md)
	}

	counts := map[string]int{}
	for _, c := range cs {
		for _, w := range strings.Fields(c.Content) {
			if cellWord.MatchString(w) {
				counts[w]++
			}
		}
	}
	for _, tb := range tables {
		for _, w := range tb.cellWords {
			if counts[w] != 1 {
				t.Fatalf("%s appears %d times, want once\n%s", w, counts[w], where())
			}
		}
		tablePassages(t, tb, cs, max, where)
	}
}

// tablePassages checks one table's passages: the header above its rows and a table that fits kept whole.
func tablePassages(t *testing.T, tb *genTable, cs []Chunk, max int, where func() string) {
	t.Helper()
	prefix := fmt.Sprintf("T%dr", tb.id)
	holding := 0
	for _, c := range cs {
		first := strings.Index(c.Content, prefix)
		if first < 0 {
			continue
		}
		holding++
		// Rows without the header above them are only allowed when the header was too big to repeat, and then it is a piece of its own.
		if tb.header != "" && 2*tb.leadWords <= max {
			at := strings.Index(c.Content, tb.header)
			if at < 0 || at > first || !strings.HasPrefix(c.Content[at+len(tb.header)+1:], tb.indent+"| ---") {
				t.Fatalf("a passage has rows of table %d with no header above them:\n%s\n%s", tb.id, c.Content, where())
			}
			if tb.caption != "" && !strings.Contains(c.Content[:at], tb.caption) {
				t.Fatalf("a passage has table %d under its header with no caption:\n%s\n%s", tb.id, c.Content, where())
			}
		}
	}
	if tb.rows > 0 && tb.words <= max && holding > 1 {
		t.Fatalf("table %d (%d words) fits a passage of %d but is in %d passages\n%s", tb.id, tb.words, max, holding, where())
	}
}

func TestV3TablePropertyRandomDocuments(t *testing.T) {
	rng := rand.New(rand.NewSource(24))
	n := 400
	if testing.Short() {
		n = 60
	}
	for i := range n {
		max := 12 + rng.Intn(240)
		checkTableProperty(t, int64(i), max, rng.Intn(max/2), i%3 == 0)
	}
}

func FuzzV3TableProperty(f *testing.F) {
	for i, s := range []struct {
		seed         int64
		max, overlap uint16
	}{{1, 40, 0}, {2, 24, 6}, {3, 120, 30}, {4, 12, 2}, {5, 200, 0}, {6, 64, 8}} {
		f.Add(s.seed+int64(i), s.max, s.overlap)
	}
	f.Fuzz(func(t *testing.T, seed int64, max, overlap uint16) {
		m := 12 + int(max%240)
		checkTableProperty(t, seed, m, int(overlap)%(m/2), seed%2 == 0)
	})
}
