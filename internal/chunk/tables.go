package chunk

import "strings"

// Tables, chunker version 3 (docs/DESIGN.md, "Tables"). Versions 1 and 2 never run any of this code; Split switches it on with splitter.tables.
//
// A table is a block of Markdown pipe-table lines (every parser writes them with a leading pipe: internal/htmlmd, the DOCX and PPTX parsers). Version
// 3 differs from version 2 in five ways:
//
//   - A table inside a list item is a block of its own (blocks.go, blockParser.tables), so it is no longer cut as list lines.
//   - A short one-line paragraph directly above a table (its caption or lead-in) is joined to the table (joinCaptions), so it is never left at the
//     end of the previous passage.
//   - A table that does not fit the room left in the passage, but fits a passage of its own, starts a new one (addTable). If only the headings above
//     it are in the way, they stay out of the passage text: the heading path still names them.
//   - An over-long table starts a new passage and is cut by rows; every piece after the first starts with the caption and the header and separator rows
//     (block.lead), exactly as in version 1, and no overlap is taken from or into table rows, so a row is never repeated.
//   - A single row too long for a passage is cut into fragment rows (fitRows): cells that fit together share a row, and a cell that is too long is cut
//     by tokens. Every fragment keeps its cells in their own columns, with the other cells empty, so it still reads under the repeated header.

// captionTokens is the most tokens of a paragraph that is joined to the table below it.
func (sp *splitter) captionTokens() int { return max(min(48, sp.max/4), 1) }

// joinCaptions joins a caption paragraph to the table that follows it (version 3). A table without a header row takes no caption: nothing would repeat it.
func (sp *splitter) joinCaptions(blocks []*block) []*block {
	out := make([]*block, 0, len(blocks))
	for _, b := range blocks {
		if n := len(out); n > 0 && b.kind == kindTable && b.headerEnd > 0 && sp.isCaption(out[n-1]) {
			out[n-1] = joinCaption(out[n-1], b)
			continue
		}
		out = append(out, b)
	}
	return out
}

func (sp *splitter) isCaption(b *block) bool {
	return b.kind == kindPara && !strings.Contains(b.text, "\n") && sp.count(b.text) <= sp.captionTokens()
}

// joinCaption returns the table with its caption paragraph above it, as one block.
func joinCaption(caption, table *block) *block {
	joined := *table
	off := len(caption.text) + len("\n\n")
	joined.text = caption.text + "\n\n" + table.text
	joined.headerEnd = table.headerEnd + off
	joined.lead = joined.text[:joined.headerEnd] + "\n"
	joined.marks = []pageMark{{0, caption.marks[0].page}}
	if p := table.marks[0].page; p != caption.marks[0].page {
		joined.marks = append(joined.marks, pageMark{off, p})
	}
	return &joined
}

// addTable places a table that does not fit the room left in the passage being filled (version 3).
func (sp *splitter) addTable(b *block, whole unit) {
	if sp.body > 0 {
		sp.closeFor(whole)
	}
	if b.tokens > sp.max {
		for _, pc := range sp.refine(b, span{0, len(b.text)}, 0, sp.max-b.leadTok-b.trailTok, nil) {
			sp.add(unit{b: b, start: pc.start, end: pc.end, tokens: pc.tokens})
		}
		return
	}
	// The table fits a passage of its own. What is in the way is overlap (optional, so dropped) or headings, which end the passage before it.
	if sp.cost(whole) > sp.max && len(sp.cur) > 0 {
		if sp.cur[0].overlap {
			sp.cur, sp.base = nil, 0
		} else {
			sp.emit()
		}
	}
	sp.push(whole)
}

// fitRows cuts every row of an over-long table that cannot share a passage with the table's header into fragment rows (version 3). It reports whether
// the text changed.
func (sp *splitter) fitRows(b *block) bool {
	limit := sp.max - b.leadTok - b.trailTok
	headTok := 0
	if b.headerEnd > 0 && !b.headSplit {
		headTok = sp.count(b.text[:b.headerEnd])
	}
	lines := strings.Split(b.text, "\n")
	changed := false
	for i, off := 0, 0; i < len(lines); i++ {
		start := off
		off += len(lines[i]) + 1
		if start < b.headerEnd || strings.TrimSpace(lines[i]) == "" {
			continue // the caption, the header and the separator
		}
		room := limit
		if start == b.headerEnd+1 {
			room += b.leadTok - headTok // the first row shares its piece with the header, which is not a copy
		}
		if room < 1 || sp.count(lines[i]) <= room {
			continue
		}
		if frags := sp.fragmentRow(lines[i], room); len(frags) > 1 {
			lines[i], changed = strings.Join(frags, "\n"), true
		}
	}
	if changed {
		b.text = strings.Join(lines, "\n")
	}
	return changed
}

// fragmentRow cuts one table row into rows of at most limit tokens, or returns nil when the row cannot be cut (more than half of the limit is the
// row's own structure, as for a row of thousands of cells).
func (sp *splitter) fragmentRow(line string, limit int) []string {
	indent := line[:indentOf(line)]
	cells := splitCells(line[len(indent):])
	if len(cells) == 0 {
		return nil
	}
	overhead := sp.count(renderRow(indent, make([]string, len(cells))))
	room := limit - overhead
	if room < 1 || 2*overhead > limit {
		return nil
	}
	var out []string
	cur := make([]string, len(cells))
	used := 0
	flush := func() {
		if used > 0 {
			out = append(out, renderRow(indent, cur))
			clear(cur)
			used = 0
		}
	}
	for i, c := range cells {
		if c == "" {
			continue
		}
		n := sp.count(c)
		if n > room { // a cell of its own: cut by tokens, a fragment each
			flush()
			for _, p := range sp.cellPieces(c, room) {
				cur[i] = p
				out = append(out, renderRow(indent, cur))
			}
			clear(cur)
			continue
		}
		if used+n > room {
			flush()
		}
		cur[i], used = c, used+n
	}
	flush()
	return out
}

// cellPieces cuts a cell's text into pieces of at most room tokens, never between a backslash and the pipe it escapes.
func (sp *splitter) cellPieces(cell string, room int) []string {
	var out []string
	for _, p := range sp.hardSplit(cell, span{0, len(cell)}, room, nil) {
		out = append(out, cell[p.start:p.end])
	}
	for i := 0; i+1 < len(out); i++ {
		if n := len(out[i]); n > 0 && out[i][n-1] == '\\' && !strings.HasSuffix(out[i], `\\`) {
			out[i], out[i+1] = out[i][:n-1], `\`+out[i+1]
		}
	}
	kept := out[:0]
	for _, p := range out {
		if p != "" {
			kept = append(kept, p)
		}
	}
	return kept
}

// splitCells returns a pipe-table row's cells, trimmed: the text between unescaped pipes, without the empty text outside the outer pipes.
func splitCells(row string) []string {
	row = strings.TrimPrefix(strings.TrimSpace(row), "|")
	var cells []string
	start := 0
	for i := 0; i < len(row); i++ {
		switch row[i] {
		case '\\':
			i++ // the next byte is escaped
		case '|':
			cells = append(cells, strings.TrimSpace(row[start:i]))
			start = i + 1
		}
	}
	if rest := strings.TrimSpace(row[start:]); rest != "" {
		cells = append(cells, rest)
	}
	return cells
}

// renderRow writes cells as a pipe-table row, the way the parsers do.
func renderRow(indent string, cells []string) string {
	var sb strings.Builder
	sb.WriteString(indent + "|")
	for _, c := range cells {
		sb.WriteString(" " + c + " |")
	}
	return sb.String()
}
