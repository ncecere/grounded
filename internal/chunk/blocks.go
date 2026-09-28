package chunk

import (
	"strings"

	"github.com/ncecere/grounded/internal/parse"
)

type kind uint8

const (
	kindPara kind = iota
	kindHeading
	kindList
	kindTable
	kindCode
)

// pageMark records that text from byte offset off onward is on page.
type pageMark struct{ off, page int }

// block is one structural element of the document. Its text never contains
// page markers and has no leading newlines or trailing whitespace.
type block struct {
	kind  kind
	text  string
	level int      // heading level (1-6)
	brk   bool     // heading of level 1-3: a chunk boundary
	path  []string // heading path in effect for this block (including itself for headings)
	marks []pageMark

	tokens int

	// lead is prepended when a chunk starts inside the block (table header,
	// code opening fence); trail is appended when a chunk ends inside it
	// (code closing fence).
	lead, trail       string
	leadTok, trailTok int

	indent     int // list: indentation of the first item
	headerEnd  int // table: end of the header + separator lines (0 = no header)
	openEnd    int // code: end of the opening fence line
	closeStart int // code: start of the closing fence line (len(text) when unclosed)
}

func (b *block) pageAt(off int) int {
	p := b.marks[0].page
	for _, m := range b.marks[1:] {
		if m.off > off {
			break
		}
		p = m.page
	}
	return p
}

// normalize converts line endings to LF, strips trailing whitespace from
// lines, collapses runs of blank lines to one, and trims the document.
func normalize(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	var b strings.Builder
	b.Grow(len(s))
	blank, started := false, false
	for len(s) > 0 {
		var line string
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			line, s = s[:i], s[i+1:]
		} else {
			line, s = s, ""
		}
		line = strings.TrimRight(line, " \t\f\v")
		if strings.TrimSpace(line) == "" {
			blank = started
			continue
		}
		if started {
			b.WriteByte('\n')
			if blank {
				b.WriteByte('\n')
			}
		}
		blank, started = false, true
		b.WriteString(line)
	}
	return b.String()
}

type headingEntry struct {
	level int
	text  string
}

type blockParser struct {
	doc       string
	page      int
	paginated bool
	stack     []headingEntry
	path      []string
	blocks    []*block

	open       bool // a paragraph, list, or table is being collected
	cur        kind
	start, end int

	inFence        bool
	fenceCh        byte
	fenceN         int
	fenceStart     int
	fenceEnd       int
	fenceMarkers   bool
	fenceStartPage int
}

// parseBlocks splits a normalized document into blocks and reports whether it
// contains page markers.
func parseBlocks(doc string) ([]*block, bool) {
	p := &blockParser{doc: doc, page: 1, path: []string{}}
	for pos := 0; pos < len(doc); {
		end := strings.IndexByte(doc[pos:], '\n')
		if end < 0 {
			end = len(doc)
		} else {
			end += pos
		}
		p.line(pos, end)
		pos = end + 1
	}
	if p.inFence {
		p.closeFence(false)
	}
	p.flush()
	return p.blocks, p.paginated
}

func pageMarker(line string) (int, bool) {
	if !parse.MayContainPageMarker(line) {
		return 0, false
	}
	return parse.ParsePageMarker(line)
}

func (p *blockParser) line(s, e int) {
	line := p.doc[s:e]
	if p.inFence {
		p.fenceLine(line, e)
		return
	}
	if line == "" {
		if p.open && p.cur == kindList && p.listContinues(e+1) {
			return
		}
		p.flush()
		return
	}
	if n, ok := pageMarker(line); ok {
		p.flush()
		p.page, p.paginated = n, true
		return
	}
	if ch, n, ok := fenceOpen(line); ok {
		p.flush()
		p.inFence, p.fenceCh, p.fenceN = true, ch, n
		p.fenceStart, p.fenceEnd, p.fenceMarkers, p.fenceStartPage = s, e, false, p.page
		return
	}
	if level, text, ok := atxHeading(line); ok {
		p.flush()
		p.heading(level, text, strings.TrimLeft(line, " \t"))
		return
	}
	p.textLine(line, s, e)
}

// fenceLine handles a line inside a fenced code block.
func (p *blockParser) fenceLine(line string, e int) {
	if n, ok := pageMarker(line); ok {
		p.page, p.paginated, p.fenceMarkers = n, true, true
		return
	}
	p.fenceEnd = e
	if isFenceClose(line, p.fenceCh, p.fenceN) {
		p.closeFence(true)
	}
}

// textLine continues the open table, list or paragraph, or starts a block.
func (p *blockParser) textLine(line string, s, e int) {
	isTable := strings.HasPrefix(strings.TrimLeft(line, " \t"), "|")
	item, interrupts := listItem(line)
	if p.open {
		if p.continues(line, isTable, item, interrupts) {
			p.end = e
			return
		}
		p.flush()
	}
	k := kindPara
	switch {
	case isTable:
		k = kindTable
	case item:
		k = kindList
	}
	p.open, p.cur, p.start, p.end = true, k, s, e
}

// continues reports whether a text line belongs to the open block.
func (p *blockParser) continues(line string, isTable, item, interrupts bool) bool {
	switch p.cur {
	case kindTable:
		return isTable
	case kindList:
		return !isTable || indentOf(line) > 0 // item, nested content, or lazy continuation
	case kindPara:
		return !isTable && !(item && interrupts)
	}
	return false
}

// listContinues reports whether the list continues after a blank line: the
// next line is another item or indented continuation text.
func (p *blockParser) listContinues(next int) bool {
	if next >= len(p.doc) {
		return false
	}
	line := p.doc[next:]
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = line[:i]
	}
	if _, ok := pageMarker(line); ok {
		return false
	}
	if item, _ := listItem(line); item {
		return true
	}
	return line != "" && (line[0] == ' ' || line[0] == '\t')
}

func (p *blockParser) flush() {
	if !p.open {
		return
	}
	p.open = false
	b := &block{
		kind:  p.cur,
		text:  p.doc[p.start:p.end],
		path:  p.path,
		marks: []pageMark{{0, p.page}},
	}
	switch b.kind {
	case kindList:
		b.indent = indentOf(b.text)
	case kindTable:
		b.headerEnd = tableHeaderEnd(b.text)
		if b.headerEnd > 0 {
			b.lead = b.text[:b.headerEnd] + "\n"
		}
	}
	p.blocks = append(p.blocks, b)
}

func (p *blockParser) heading(level int, text, line string) {
	for len(p.stack) > 0 && p.stack[len(p.stack)-1].level >= level {
		p.stack = p.stack[:len(p.stack)-1]
	}
	p.stack = append(p.stack, headingEntry{level, text})
	path := make([]string, 0, len(p.stack))
	for _, h := range p.stack {
		if h.text != "" {
			path = append(path, h.text)
		}
	}
	p.path = path
	p.blocks = append(p.blocks, &block{
		kind:  kindHeading,
		text:  line,
		level: level,
		brk:   level <= 3,
		path:  path,
		marks: []pageMark{{0, p.page}},
	})
}

func (p *blockParser) closeFence(closed bool) {
	p.inFence = false
	b := &block{kind: kindCode, path: p.path, marks: []pageMark{{0, p.fenceStartPage}}}
	raw := p.doc[p.fenceStart:p.fenceEnd]
	if !p.fenceMarkers {
		b.text = raw
	} else {
		// Rebuild without the marker lines, recording where pages change.
		var sb strings.Builder
		page := p.fenceStartPage
		for _, l := range strings.Split(raw, "\n") {
			if n, ok := pageMarker(l); ok {
				page = n
				continue
			}
			if sb.Len() > 0 {
				sb.WriteByte('\n')
			}
			if last := b.marks[len(b.marks)-1]; page != last.page {
				b.marks = append(b.marks, pageMark{sb.Len(), page})
			}
			sb.WriteString(l)
		}
		b.text = sb.String()
	}
	b.openEnd = len(b.text)
	if i := strings.IndexByte(b.text, '\n'); i >= 0 {
		b.openEnd = i
	}
	b.closeStart = len(b.text)
	closeLine := strings.Repeat(string(p.fenceCh), p.fenceN)
	if closed && b.openEnd < len(b.text) {
		b.closeStart = strings.LastIndexByte(b.text, '\n') + 1
		closeLine = b.text[b.closeStart:]
	}
	b.lead = b.text[:b.openEnd] + "\n"
	b.trail = "\n" + closeLine
	p.blocks = append(p.blocks, b)
}

func indentOf(s string) int {
	n := 0
	for n < len(s) && (s[n] == ' ' || s[n] == '\t') {
		n++
	}
	return n
}

// stripIndent removes up to three leading spaces (Markdown's block indent).
func stripIndent(s string) (string, bool) {
	for i := 0; i < 4; i++ {
		if i == len(s) || s[i] != ' ' {
			return s[i:], true
		}
	}
	return s, false
}

func atxHeading(line string) (int, string, bool) {
	t, ok := stripIndent(line)
	if !ok {
		return 0, "", false
	}
	n := 0
	for n < len(t) && t[n] == '#' {
		n++
	}
	if n == 0 || n > 6 || (n < len(t) && t[n] != ' ' && t[n] != '\t') {
		return 0, "", false
	}
	text := strings.TrimSpace(t[n:])
	// Remove an optional closing sequence of #s.
	if trimmed := strings.TrimRight(text, "#"); trimmed == "" {
		text = ""
	} else if len(trimmed) < len(text) && (strings.HasSuffix(trimmed, " ") || strings.HasSuffix(trimmed, "\t")) {
		text = strings.TrimSpace(trimmed)
	}
	return n, text, true
}

func fenceOpen(line string) (byte, int, bool) {
	t, ok := stripIndent(line)
	if !ok || len(t) < 3 || (t[0] != '`' && t[0] != '~') {
		return 0, 0, false
	}
	ch, n := t[0], 0
	for n < len(t) && t[n] == ch {
		n++
	}
	if n < 3 || (ch == '`' && strings.IndexByte(t[n:], '`') >= 0) {
		return 0, 0, false
	}
	return ch, n, true
}

func isFenceClose(line string, ch byte, min int) bool {
	t, ok := stripIndent(line)
	if !ok {
		return false
	}
	n := 0
	for n < len(t) && t[n] == ch {
		n++
	}
	return n >= min && strings.TrimSpace(t[n:]) == ""
}

// listItem reports whether line starts a list item and whether that item may
// interrupt a paragraph (bullets and lists starting at 1, as in CommonMark).
func listItem(line string) (item, interrupts bool) {
	t := strings.TrimLeft(line, " \t")
	if t == "" {
		return false, false
	}
	if c := t[0]; c == '-' || c == '*' || c == '+' {
		ok := len(t) == 1 || t[1] == ' ' || t[1] == '\t'
		return ok, ok
	}
	n := 0
	for n < len(t) && n < 9 && t[n] >= '0' && t[n] <= '9' {
		n++
	}
	if n == 0 || n == len(t) || (t[n] != '.' && t[n] != ')') {
		return false, false
	}
	if n+1 < len(t) && t[n+1] != ' ' && t[n+1] != '\t' {
		return false, false
	}
	return true, t[:n] == "1"
}

// tableHeaderEnd returns the end offset of a table's header and separator
// rows, or 0 when the second line is not a separator row.
func tableHeaderEnd(text string) int {
	first := strings.IndexByte(text, '\n')
	if first < 0 {
		return 0
	}
	rest := text[first+1:]
	second := rest
	if i := strings.IndexByte(rest, '\n'); i >= 0 {
		second = rest[:i]
	}
	if !isTableSeparator(second) {
		return 0
	}
	return first + 1 + len(second)
}

func isTableSeparator(line string) bool {
	t := strings.TrimSpace(line)
	if !strings.Contains(t, "-") || !strings.Contains(t, "|") {
		return false
	}
	for i := 0; i < len(t); i++ {
		switch t[i] {
		case '|', ':', '-', ' ', '\t':
		default:
			return false
		}
	}
	return true
}
