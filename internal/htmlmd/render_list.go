// Lists: ordered and unordered lists, nested items and stray items.

package htmlmd

import (
	"strconv"
	"strings"

	xhtml "golang.org/x/net/html"
)

func (st *renderState) renderList(b *strings.Builder, n *xhtml.Node, depth int) {
	start := 1
	if n.Data == "ol" {
		if v, err := strconv.Atoi(strings.TrimSpace(attr(n, "start"))); err == nil && v >= 0 && v < 1_000_000_000 {
			start = v
		}
	}
	var items []*xhtml.Node
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == xhtml.TextNode && strings.TrimSpace(c.Data) == "" {
			continue
		}
		items = append(items, c)
	}
	st.renderItems(b, n, items, n.Data == "ol", start, depth)
}

// renderItems renders list items. Item content is rendered separately,
// normalised, and indented under its marker so nested lists, paragraphs and
// code blocks stay inside the item. Nested lists are tight.
func (st *renderState) renderItems(b *strings.Builder, list *xhtml.Node, items []*xhtml.Node, ordered bool, index, depth int) {
	if st.tableCell || st.heading || st.sub >= maxSubRender {
		// Flat fallback, as yoink renders lists.
		b.WriteString("\n\n")
		for _, item := range items {
			if item.Type == xhtml.ElementNode && item.Data == "li" {
				b.WriteString("\n- ")
				st.renderChildrenDirect(b, item, depth+1)
			} else {
				st.renderNode(b, item, depth+1)
			}
		}
		b.WriteString("\n\n")
		return
	}
	var out []string
	var markers []string
	protect := false
	for _, item := range items {
		c := st.child()
		c.inList = true
		var raw string
		isItem := item.Type == xhtml.ElementNode && item.Data == "li"
		if isItem {
			raw = st.renderChildren(item, depth+1, c)
		} else {
			// Stray content (text, or a list nested directly in a list) belongs
			// to the preceding item when there is one.
			var sb strings.Builder
			c.renderNode(&sb, item, depth+1)
			st.truncated = st.truncated || c.truncated
			raw = sb.String()
		}
		markers = append(markers, c.markers...)
		content := normalizeRendered(raw, c.protected)
		if content == "" {
			continue
		}
		protect = protect || len(c.protected) > 0
		marker := "- "
		if !isItem && len(out) > 0 {
			out[len(out)-1] += "\n" + indentLines(content, "  ", "  ")
			continue
		}
		if ordered {
			marker = strconv.Itoa(index) + ". "
			index++
		}
		out = append(out, indentLines(content, marker, strings.Repeat(" ", len(marker))))
	}
	if len(out) > 0 {
		sep := "\n\n"
		if st.inList {
			sep = "\n"
		}
		st.writeBlock(b, strings.Join(out, "\n"), protect, sep)
	}
	st.flushMarkers(b, markers)
}

func indentLines(s, first, rest string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		switch {
		case i == 0:
			lines[i] = first + line
		case line != "":
			lines[i] = rest + line
		}
	}
	return strings.Join(lines, "\n")
}
