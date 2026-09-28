// Pipe tables: data tables become Markdown pipe tables; layout (nested)
// tables render their cells as blocks.

package htmlmd

import (
	"strconv"
	"strings"

	xhtml "golang.org/x/net/html"
)

func hasDescendant(n *xhtml.Node, tag string) bool {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == xhtml.ElementNode && (c.Data == tag || hasDescendant(c, tag)) {
			return true
		}
	}
	return false
}

func (st *renderState) renderTable(b *strings.Builder, n *xhtml.Node, depth int) {
	if hasDescendant(n, "table") {
		// Nested tables indicate layout, not data: render cells as blocks.
		b.WriteString("\n\n")
		st.renderChildrenDirect(b, n, depth)
		b.WriteString("\n\n")
		return
	}
	t := &tableCollector{st: st, depth: depth}
	t.visit(n)
	if t.caption != nil {
		b.WriteString("\n\n")
		st.renderChildrenDirect(b, t.caption, depth)
		b.WriteString("\n\n")
	}
	if len(t.rows) > 0 {
		st.writeRows(b, t.rows)
	}
	st.flushMarkers(b, t.markers)
}

// tableCollector gathers a data table's rows of rendered cells, its caption
// and the page markers inside it.
type tableCollector struct {
	st        *renderState
	depth     int
	rows      [][]string
	markers   []string
	caption   *xhtml.Node
	cellBytes int
}

func (t *tableCollector) marker(n *xhtml.Node) {
	if m, ok := pageMarker(n); ok {
		t.markers = append(t.markers, m)
	}
}

func (t *tableCollector) visit(n *xhtml.Node) {
	if t.cellBytes > t.st.limit {
		t.st.truncated = true
		return
	}
	if n.Type == xhtml.CommentNode {
		t.marker(n)
		return
	}
	if n.Type != xhtml.ElementNode {
		return
	}
	if n.Data == "caption" && t.caption == nil {
		t.caption = n
		return
	}
	if n.Data != "tr" {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			t.visit(c)
		}
		return
	}
	if row := t.row(n); len(row) > 0 {
		t.rows = append(t.rows, row)
	}
}

// row renders a <tr>'s cells; a colspan adds empty cells.
func (t *tableCollector) row(tr *xhtml.Node) []string {
	var row []string
	for c := tr.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == xhtml.CommentNode {
			t.marker(c)
			continue
		}
		if c.Type != xhtml.ElementNode || (c.Data != "td" && c.Data != "th") {
			continue
		}
		row = append(row, t.cell(c))
		if span, err := strconv.Atoi(strings.TrimSpace(attr(c, "colspan"))); err == nil && span > 1 {
			for i := 1; i < min(span, maxColspan); i++ {
				row = append(row, "")
			}
		}
		if t.cellBytes > t.st.limit {
			t.st.truncated = true
			break
		}
	}
	return row
}

// cell renders a cell's content on one line, with pipes escaped.
func (t *tableCollector) cell(c *xhtml.Node) string {
	st := t.st
	cs := &renderState{base: st.base, limit: st.limit, tableCell: true, hoist: true, sub: st.sub + 1}
	value := normalizeRendered(st.renderChildren(c, t.depth+1, cs), cs.protected)
	t.markers = append(t.markers, cs.markers...)
	value = strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n")
	value = strings.ReplaceAll(value, "|", "\\|")
	value = strings.ReplaceAll(value, "\n", "<br>")
	t.cellBytes += len(value)
	return value
}

func (st *renderState) writeRows(b *strings.Builder, rows [][]string) {
	cols := 0
	for _, r := range rows {
		cols = max(cols, len(r))
	}
	b.WriteString("\n\n")
	for i, r := range rows {
		b.WriteString("|")
		for j := 0; j < cols; j++ {
			// A wide ragged table must stop padding at the output limit rather
			// than produce rows*columns unbounded output.
			if b.Len() > st.limit {
				st.truncated = true
				return
			}
			b.WriteByte(' ')
			if j < len(r) {
				b.WriteString(r[j])
			}
			b.WriteString(" |")
		}
		b.WriteByte('\n')
		if i == 0 {
			b.WriteString("|" + strings.Repeat(" --- |", cols) + "\n")
		}
	}
	b.WriteByte('\n')
}
