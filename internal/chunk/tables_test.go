package chunk

import (
	"fmt"
	"regexp"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/parse"
)

// v3 returns options for chunker version 3 (word counts as tokens, so a pipe counts as a word).
func v3(max, overlap int) Options {
	o := opts(max, overlap)
	o.Version = Version3
	return o
}

// pipeTable renders a table the way the parsers do: a header, a separator and n rows whose cells are the unique words "<tag>r<row>c<col>".
func pipeTable(tag string, cols []string, n int, indent string) string {
	var sb strings.Builder
	sb.WriteString(indent + "| " + strings.Join(cols, " | ") + " |\n")
	sb.WriteString(indent + "|" + strings.Repeat(" --- |", len(cols)) + "\n")
	for r := range n {
		sb.WriteString(indent + "|")
		for c := range cols {
			fmt.Fprintf(&sb, " %sr%dc%d |", tag, r, c)
		}
		sb.WriteString("\n")
	}
	return strings.TrimRight(sb.String(), "\n")
}

// countIn counts the chunks whose content has the text.
func countIn(cs []Chunk, text string) int {
	n := 0
	for _, c := range cs {
		if strings.Contains(c.Content, text) {
			n++
		}
	}
	return n
}

// occurrences counts a unique word across all chunks.
func occurrences(cs []Chunk, word string) int {
	n := 0
	for _, c := range cs {
		for _, w := range strings.Fields(c.Content) {
			if w == word {
				n++
			}
		}
	}
	return n
}

// A table that fits a passage stays whole in version 3. Version 1 cuts it when headings with no body yet leave too little room, though it would fit a
// passage of its own.
func TestV3KeepsATableWholeWhenItFits(t *testing.T) {
	// Words: the three headings 2+3+3 = 8; the table 5 (header) + 5 (separator) + 5 rows of 5 = 35. Together 8 + 35 + separator > 40, the table alone fits.
	md := "# Fees\n\n## Term\n\n### Undergraduate\n\n" + pipeTable("f", []string{"Item", "Amount"}, 5, "") + "\n\nPay early."
	one, three := mustSplit(t, md, opts(40, 0)), mustSplit(t, md, v3(40, 0))
	if n := countIn(one, "| f"); n < 2 {
		t.Fatalf("version 1 kept the table in %d passage(s); the fixture does not exercise the rule: %q", n, contents(one))
	}
	if n := countIn(three, "| f"); n != 1 {
		t.Fatalf("version 3 spread the table over %d passages: %q", n, contents(three))
	}
	whole := three[len(three)-1]
	if !strings.Contains(whole.Content, pipeTable("f", []string{"Item", "Amount"}, 5, "")) {
		t.Errorf("the table is not whole: %q", whole.Content)
	}
	// The headings are in the table's path even though they are no longer in its text.
	if got := strings.Join(whole.HeadingPath, " > "); got != "Fees > Term > Undergraduate" {
		t.Errorf("heading path = %q", got)
	}
}

func TestV3HeadingsLeftOutAreDroppedLikeAnyBodylessPassage(t *testing.T) {
	md := "# Fees\n\n## Term\n\n### Undergraduate\n\n" + pipeTable("f", []string{"Item", "Amount"}, 5, "")
	keep := v3(40, 0)
	all := mustSplit(t, md, keep)
	if len(all) != 2 || !strings.HasPrefix(all[0].Content, "# Fees") || strings.Contains(all[0].Content, "| ") {
		t.Fatalf("without dropping: %q", contents(all))
	}
	keep.DropImageOnly = true
	got := mustSplit(t, md, keep)
	if len(got) != 1 || !strings.HasPrefix(got[0].Content, "| Item") {
		t.Fatalf("with dropping: %q", contents(got))
	}
}

// A one-line paragraph above a table is its caption: it moves with the table, and every piece of a long table repeats it.
func TestV3CaptionTravelsWithTheTable(t *testing.T) {
	prose := sentence("p", 30)
	md := prose + "\n\nTable 1: Fees.\n\n" + pipeTable("f", []string{"Item", "Amount"}, 5, "")
	one, three := mustSplit(t, md, opts(40, 0)), mustSplit(t, md, v3(40, 0))
	if !strings.HasSuffix(one[0].Content, "Table 1: Fees.") {
		t.Fatalf("version 1 should leave the caption at the end of the previous passage: %q", contents(one))
	}
	if len(three) != 2 || !strings.HasPrefix(three[1].Content, "Table 1: Fees.\n\n| Item | Amount |\n| --- | --- |\n| fr0c0") {
		t.Fatalf("version 3: %q", contents(three))
	}

	long := "## Fees\n\nTable 1: Fees.\n\n" + pipeTable("f", []string{"Item", "Amount"}, 12, "")
	cs := mustSplit(t, long, v3(40, 0))
	if len(cs) < 3 {
		t.Fatalf("the long table was not split: %q", contents(cs))
	}
	for i, c := range cs {
		if !strings.Contains(c.Content, "Table 1: Fees.\n\n| Item | Amount |\n| --- | --- |\n| f") {
			t.Errorf("piece %d lacks the caption and header: %q", i, c.Content)
		}
		if got := strings.Join(c.HeadingPath, ">"); got != "Fees" {
			t.Errorf("piece %d heading path = %q", i, got)
		}
	}
	for r := range 12 {
		for c := range 2 {
			if n := occurrences(cs, fmt.Sprintf("fr%dc%d", r, c)); n != 1 {
				t.Errorf("fr%dc%d appears %d times", r, c, n)
			}
		}
	}
}

func TestV3CaptionRules(t *testing.T) {
	table := pipeTable("f", []string{"Item", "Amount"}, 2, "")
	sp := newSplitter(v3(40, 0)) // a caption is at most 10 words
	for name, tc := range map[string]struct {
		md     string
		blocks int  // blocks after joining
		joined bool // the table starts with the caption
	}{
		"short line":       {"Fees.\n\n" + table, 1, true},
		"two lines":        {"Fees\nfor the year.\n\n" + table, 2, false},
		"too long":         {strings.Repeat("word ", 11) + "\n\n" + table, 2, false},
		"exactly the max":  {strings.Repeat("word ", 10) + "\n\n" + table, 1, true},
		"heading":          {"## Fees\n\n" + table, 2, false},
		"list":             {"- Fees\n\n" + table, 2, false},
		"code":             {"```\nFees\n```\n\n" + table, 2, false},
		"nearest only":     {"First.\n\nFees.\n\n" + table, 2, true},
		"headerless table": {"Fees.\n\n| a | b |\n| c | d |", 2, false},
		"no caption":       {table, 1, false},
	} {
		blocks, _ := parseBlocksFor(normalize(tc.md), true)
		got := sp.joinCaptions(blocks)
		last := got[len(got)-1]
		if len(got) != tc.blocks || last.kind != kindTable || !strings.HasPrefix(last.text, "|") != tc.joined {
			t.Errorf("%s: %d blocks (want %d), last %q", name, len(got), tc.blocks, last.text)
		}
		if tc.joined && last.lead != strings.TrimSuffix(last.text[:last.headerEnd], "\n")+"\n" || tc.joined && !strings.Contains(last.lead, "| --- | --- |") {
			t.Errorf("%s: the lead is %q", name, last.lead)
		}
	}
}

func TestV3CaptionPagesFollowTheText(t *testing.T) {
	md := parse.PageMarker(1) + "\n\nTable 1.\n\n" + parse.PageMarker(2) + "\n\n" + pipeTable("f", []string{"A", "B"}, 2, "")
	cs := mustSplit(t, md, v3(100, 0))
	if len(cs) != 1 || cs[0].PageStart != 1 || cs[0].PageEnd != 2 {
		t.Fatalf("pages: %+v", cs)
	}
}

// A table bigger than a passage is cut by rows, each piece under the repeated header; no row is lost or repeated, with or without overlap.
func TestV3TableBiggerThanAPassage(t *testing.T) {
	header := "| Name | Deadline | Room |\n| --- | --- | --- |"
	md := "# Dates\n\nIntro words here.\n\n" + pipeTable("d", []string{"Name", "Deadline", "Room"}, 30, "") + "\n\nAfter the table."
	for _, overlap := range []int{0, 6} {
		cs := mustSplit(t, md, v3(36, overlap))
		pieces := 0
		for _, c := range cs {
			if !strings.Contains(c.Content, "| d") {
				continue
			}
			pieces++
			if !strings.Contains(c.Content, header+"\n| dr") {
				t.Errorf("overlap %d: a piece lacks the header: %q", overlap, c.Content)
			}
		}
		if pieces < 5 {
			t.Fatalf("overlap %d: the table made %d pieces", overlap, pieces)
		}
		for r := range 30 {
			for c := range 3 {
				if n := occurrences(cs, fmt.Sprintf("dr%dc%d", r, c)); n != 1 {
					t.Errorf("overlap %d: dr%dc%d appears %d times", overlap, r, c, n)
				}
			}
		}
		if !strings.HasSuffix(cs[len(cs)-1].Content, "After the table.") {
			t.Errorf("the text after the table is lost: %q", cs[len(cs)-1].Content)
		}
	}
	// The table starts a passage of its own: the chunk before it is the prose only.
	cs := mustSplit(t, md, v3(36, 0))
	if !strings.HasPrefix(cs[1].Content, "| Name") && !strings.HasPrefix(cs[0].Content, "# Dates\n\nIntro words here.") {
		t.Errorf("the table does not start its own passage: %q", contents(cs[:2]))
	}
}

// A row bigger than a passage is cut into fragment rows that keep their cells in their own columns, under the repeated header.
func TestV3SingleHugeRow(t *testing.T) {
	var cell []string
	for i := range 90 {
		cell = append(cell, fmt.Sprintf("hw%d", i))
	}
	md := "| Policy | Text | Owner |\n| --- | --- | --- |\n| Appeals | " + strings.Join(cell, " ") + " | Dean |\n| Late work | short | Registrar |"
	cs := mustSplit(t, md, v3(30, 0))
	if len(cs) < 4 {
		t.Fatalf("the row was not cut: %q", contents(cs))
	}
	var seen []string
	for i, c := range cs {
		lines := strings.Split(c.Content, "\n")
		if i > 0 && (lines[0] != "| Policy | Text | Owner |" || lines[1] != "| --- | --- | --- |") {
			t.Errorf("piece %d lacks the header: %q", i, c.Content)
		}
		for _, l := range lines {
			if strings.HasPrefix(l, "| Policy") || strings.HasPrefix(l, "| ---") {
				continue
			}
			if cells := splitCells2(l); len(cells) != 3 {
				t.Errorf("piece %d: %q has %d cells, want the header's 3", i, l, len(cells))
			}
			seen = append(seen, strings.Fields(strings.NewReplacer("|", " ").Replace(l))...)
		}
	}
	want := append(append([]string{"Appeals"}, cell...), "Dean", "Late", "work", "short", "Registrar")
	if strings.Join(seen, " ") != strings.Join(want, " ") {
		t.Errorf("the row's words changed:\n got %q\nwant %q", seen, want)
	}
	// The cell's words stay in column 2.
	for _, c := range cs {
		for _, l := range strings.Split(c.Content, "\n") {
			if strings.Contains(l, "hw") && !strings.Contains(splitCells2(l)[1], "hw") {
				t.Errorf("a cell moved columns: %q", l)
			}
		}
	}
}

func splitCells2(line string) []string {
	cells := splitCellsKeepEmpty(strings.TrimSpace(line))
	return cells
}

// splitCellsKeepEmpty is splitCells that keeps empty cells, for counting columns.
func splitCellsKeepEmpty(row string) []string {
	row = strings.TrimSuffix(strings.TrimPrefix(row, "|"), "|")
	return strings.Split(row, "|")
}

// A cut never separates a backslash from the pipe it escapes, so a fragment stays one cell wide.
func TestV3EscapedPipesSurviveACut(t *testing.T) {
	tc := realCounter(t)
	cell := strings.Repeat(`a\|`, 300)
	md := "| K | V |\n| --- | --- |\n| key | " + cell + " |"
	o := Options{MaxTokens: 64, Counter: tc, Version: Version3}
	cs := mustSplit(t, md, o)
	if len(cs) < 3 {
		t.Fatalf("the row was not cut: %d passages", len(cs))
	}
	var got strings.Builder
	for _, c := range cs {
		for _, l := range strings.Split(c.Content, "\n") {
			if strings.HasPrefix(l, "| K") || strings.HasPrefix(l, "| ---") {
				continue
			}
			if n := len(splitCells(l)); n != 2 {
				t.Fatalf("%q has %d cells, want 2", l, n)
			}
			if cells := splitCells(l); strings.HasPrefix(cells[1], `a\|`) || cells[1] != "" {
				got.WriteString(cells[1])
			}
		}
	}
	if got.String() != cell {
		t.Errorf("the cell's text changed: %d bytes, want %d", got.Len(), len(cell))
	}
}

func TestSplitCells(t *testing.T) {
	for row, want := range map[string][]string{
		"| a | b |":        {"a", "b"},
		"|a|b|":            {"a", "b"},
		"| a | b":          {"a", "b"},
		`| a \| b | c |`:   {`a \| b`, "c"},
		"| a |  |  | d |":  {"a", "", "", "d"},
		"|  |":             {""},
		"| ünï | 漢字 |":     {"ünï", "漢字"},
		"| a | b | |":      {"a", "b", ""},
		"  | a | b |  ":    {"a", "b"},
		"| back\\\\ | c |": {"back\\\\", "c"},
	} {
		if got := splitCells(row); strings.Join(got, "\x00") != strings.Join(want, "\x00") {
			t.Errorf("splitCells(%q) = %q, want %q", row, got, want)
		}
	}
}

// A table inside a list item is a block of its own: whole when it fits, cut by rows with its header when not, and the items around it stay lists.
func TestV3TableInsideAList(t *testing.T) {
	table := pipeTable("l", []string{"Item", "Amount"}, 4, "  ")
	md := "# Steps\n\n- Check the fees\n\n  Fee table\n\n" + table + "\n\n- Pay online\n- Keep the receipt"
	cs := mustSplit(t, md, v3(60, 0))
	if len(cs) != 1 || !strings.Contains(cs[0].Content, "  Fee table\n\n"+table+"\n\n- Pay online\n- Keep the receipt") {
		t.Fatalf("got %q", contents(cs))
	}
	// The first item's text and the caption are not cut apart from the table when it is bigger than a passage.
	big := "# Steps\n\n- Check the fees\n\n  Fee table\n\n" + pipeTable("l", []string{"Item", "Amount"}, 14, "  ") + "\n\n- Pay online"
	cs = mustSplit(t, big, v3(40, 0))
	pieces := 0
	for _, c := range cs {
		if strings.Contains(c.Content, "  | l") {
			pieces++
			if !strings.Contains(c.Content, "  Fee table\n\n  | Item | Amount |\n  | --- | --- |\n  | lr") {
				t.Errorf("a piece lacks the caption and indented header: %q", c.Content)
			}
		}
	}
	if pieces < 3 {
		t.Fatalf("the table made %d pieces", pieces)
	}
	for r := range 14 {
		if n := occurrences(cs, fmt.Sprintf("lr%dc1", r)); n != 1 {
			t.Errorf("lr%dc1 appears %d times", r, n)
		}
	}
	// Version 1 still sees one list.
	if n := len(Blocks(big)); n != 2 {
		t.Errorf("Blocks (version 1) = %d blocks, want the heading and one list", n)
	}
}

func TestV3SeveralTablesInASection(t *testing.T) {
	md := "# Guide\n\n## Dates\n\nFirst.\n\n" + pipeTable("a", []string{"X", "Y"}, 3, "") + "\n\nBetween.\n\n" + pipeTable("b", []string{"P", "Q", "R"}, 9, "") +
		"\n\nMore.\n\n" + pipeTable("c", []string{"S", "T"}, 3, "")
	cs := mustSplit(t, md, v3(30, 4))
	for tag, rows := range map[string]int{"a": 3, "b": 9, "c": 3} {
		for r := range rows {
			if n := occurrences(cs, fmt.Sprintf("%sr%dc0", tag, r)); n != 1 {
				t.Errorf("%sr%dc0 appears %d times", tag, r, n)
			}
		}
	}
	// A table never carries another table's header.
	for i, c := range cs {
		if strings.Contains(c.Content, "| br") && !strings.Contains(c.Content, "| P | Q | R |") {
			t.Errorf("piece %d of the middle table lacks its header: %q", i, c.Content)
		}
		if strings.Contains(c.Content, "| ar") && strings.Contains(c.Content, "| P | Q | R |") && !strings.Contains(c.Content, "| br") {
			t.Errorf("piece %d: first table's rows under the wrong header: %q", i, c.Content)
		}
	}
}

func TestV3TableWithoutAHeaderRow(t *testing.T) {
	var rows []string
	for i := range 20 {
		rows = append(rows, fmt.Sprintf("| hr%dc0 | hr%dc1 |", i, i))
	}
	md := "Lead-in.\n\n" + strings.Join(rows, "\n") + "\n\nAfter."
	cs := mustSplit(t, md, v3(24, 4))
	if len(cs) < 3 {
		t.Fatalf("not split: %q", contents(cs))
	}
	for r := range 20 {
		if n := occurrences(cs, fmt.Sprintf("hr%dc0", r)); n != 1 {
			t.Errorf("hr%dc0 appears %d times", r, n)
		}
	}
	for i, c := range cs[2:] {
		if strings.HasPrefix(c.Content, "| hr0c0") {
			t.Errorf("piece %d repeats the first row as a header: %q", i+2, c.Content)
		}
	}
	// It fits: kept whole.
	whole := mustSplit(t, "Lead-in.\n\n| a | b |\n| c | d |\n\nAfter.", v3(24, 0))
	if len(whole) != 1 {
		t.Errorf("a small header-less table was cut: %q", contents(whole))
	}
}

// When the caption and header are most of a passage, repeating them would leave no room for rows: the header is a piece of its own, once.
func TestV3HeaderTooBigToRepeat(t *testing.T) {
	md := "| One | Two | Three | Four | Five |\n| --- | --- | --- | --- | --- |\n" + strings.Repeat("| a | b | c | d | e |\n", 12)
	cs := mustSplit(t, md, v3(18, 0))
	if len(cs) < 4 || countIn(cs, "| One") != 1 {
		t.Fatalf("header copies: %d, passages %d", countIn(cs, "| One"), len(cs))
	}
	if !strings.HasPrefix(cs[0].Content, "| One | Two | Three | Four | Five |\n| --- |") || strings.Contains(cs[0].Content, "| a ") {
		t.Errorf("the header should be a piece of its own: %q", cs[0].Content)
	}
}

// Version 3 never repeats table rows as overlap, and prose before a table still overlaps into the passage after it.
func TestV3NoOverlapFromTableRows(t *testing.T) {
	md := "# T\n\n" + sentence("a", 10) + "\n\n" + pipeTable("o", []string{"A", "B"}, 6, "") + "\n\n" + sentence("z", 10) + " " + sentence("y", 10)
	cs := mustSplit(t, md, v3(30, 8))
	for r := range 6 {
		if n := occurrences(cs, fmt.Sprintf("or%dc0", r)); n != 1 {
			t.Errorf("or%dc0 appears %d times", r, n)
		}
	}
	v1 := mustSplit(t, md, opts(30, 8))
	dup := false
	for r := range 6 {
		dup = dup || occurrences(v1, fmt.Sprintf("or%dc0", r)) > 1
	}
	if !dup {
		t.Log("version 1 happened not to repeat a row here")
	}
}

// With no table in the document, version 3 cuts exactly as version 2 does.
func TestV3EqualsV2WithoutTables(t *testing.T) {
	docs := append(fixtures(), generatedDoc())
	for _, d := range goldenCorpus(t) {
		docs = append(docs, d.md)
	}
	checked := 0
	for _, md := range docs {
		if regexp.MustCompile(`(?m)^\s*\|`).MatchString(md) {
			continue
		}
		checked++
		for _, max := range []int{16, 48, 128, 512} {
			for _, o := range []int{0, max / 8} {
				a, b := mustSplit(t, md, v2(max, o)), mustSplit(t, md, v3(max, o))
				if strings.Join(contents(a), "\x00") != strings.Join(contents(b), "\x00") {
					t.Fatalf("max=%d overlap=%d: version 3 differs from version 2 on a document without tables", max, o)
				}
			}
		}
	}
	if checked < 10 {
		t.Fatalf("only %d documents without tables were compared", checked)
	}
}

// DropBlock sees the same block texts in version 3 as Blocks returns (the boilerplate counts are made with Blocks), except for a caption joined to its
// table or a table inside a list item.
func TestV3DropBlockSeesTheSameBlocks(t *testing.T) {
	md := "# A\n\nPara one.\n\n- item\n- item two\n\n" + pipeTable("d", []string{"X", "Y"}, 3, "") + "\n\n## B\n\nPara two.\n\n```\ncode\n```"
	var seen []string
	o := v3(100, 0)
	o.DropBlock = func(text string) bool { seen = append(seen, text); return false }
	mustSplit(t, md, o)
	var want []string
	for _, b := range Blocks(md) {
		want = append(want, b.Text)
	}
	if strings.Join(seen, "\x00") != strings.Join(want, "\x00") {
		t.Errorf("DropBlock saw %q, Blocks has %q", seen, want)
	}
	// A dropped table leaves its caption alone in the text.
	o.DropBlock = func(text string) bool { return strings.HasPrefix(text, "| X") }
	cs, err := Split("Fees.\n\n"+pipeTable("d", []string{"X", "Y"}, 3, ""), o)
	if err != nil || len(cs) != 1 || cs[0].Content != "Fees." {
		t.Errorf("after dropping the table: %q", contents(cs))
	}
}

// Tables in pages in the shapes the parsers write them (internal/htmlmd, DOCX and PPTX): a row of empty cells, escaped pipes, <br> inside a cell.
func TestV3ParserShapedTables(t *testing.T) {
	md := "## Slide 2: Deadlines\n\n| Item | Date |  |\n| --- | --- | --- |\n| Drop/add | Aug 28 |  |\n| A \\| B | line one<br>line two | x |\n|  |  |  |\n"
	cs := mustSplit(t, md, v3(100, 0))
	if len(cs) != 1 || !strings.Contains(cs[0].Content, "| A \\| B | line one<br>line two | x |") {
		t.Fatalf("got %q", contents(cs))
	}
}

// With the real tokenizer: an over-long table of rows that fit is cut between rows only, each piece under the repeated header and within the limit,
// and every row appears once.
func TestV3RealCounterTable(t *testing.T) {
	tc := realCounter(t)
	var rows []string
	for i := range 80 {
		rows = append(rows, fmt.Sprintf("| Course %d | Monday and Wednesday %d:00 | Room %d |", i, 8+i%9, 100+i))
	}
	md := "## Schedule\n\nCourses by day.\n\n| Course | Time | Room |\n| --- | --- | --- |\n" + strings.Join(rows, "\n") + "\n\nSee the registrar."
	o := Options{MaxTokens: 128, OverlapTokens: 16, Counter: tc, Version: Version3}
	cs := mustSplit(t, md, o)
	if len(cs) < 6 {
		t.Fatalf("%d passages", len(cs))
	}
	seen := map[string]int{}
	for i, c := range cs {
		if strings.Contains(c.Content, "| Course ") && !strings.Contains(c.Content, "Courses by day.\n\n| Course | Time | Room |\n| --- | --- | --- |\n| Course") {
			t.Errorf("piece %d lacks the caption and header: %q", i, c.Content)
		}
		for _, l := range strings.Split(c.Content, "\n") {
			seen[l]++
		}
	}
	for _, r := range rows {
		if seen[r] != 1 {
			t.Errorf("row %q appears %d times", r, seen[r])
		}
	}
}
