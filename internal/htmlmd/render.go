package htmlmd

import (
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	xhtml "golang.org/x/net/html"
)

const (
	// maxRenderDepth bounds recursion; the HTML parser already rejects
	// documents nested deeper than 512 open elements.
	maxRenderDepth = 1024
	// maxSubRender bounds nested sub-renders (list items, emphasis, links,
	// headings, quotes). Each level copies its content once into its parent,
	// so the bound keeps pathological nesting linear. Deeper structures are
	// rendered flat, as yoink does.
	maxSubRender = 12
	// maxColspan bounds padding for a single table cell.
	maxColspan = 64
)

// renderSpan marks rendered bytes (code fences, and structures containing
// them) that block normalisation must not touch. Protected offsets preserve
// parsed <pre> content without sentinel substitution, which could collide with
// hostile input.
type renderSpan struct{ start, end int }

type renderState struct {
	base      *url.URL
	limit     int
	protected []renderSpan
	// markers holds page markers hoisted out of structures (headings, table
	// cells, list items, quotes, inline wrappers) that cannot contain a
	// standalone line; they are emitted immediately after the structure.
	markers   []string
	truncated bool
	tableCell bool
	heading   bool
	inList    bool
	hoist     bool
	sub       int
}

func renderMarkdown(nodes []*xhtml.Node, base *url.URL, limit int) (string, bool) {
	var b strings.Builder
	st := &renderState{base: base, limit: limit}
	for _, n := range nodes {
		st.renderNode(&b, n, 0)
	}
	return normalizeRendered(b.String(), st.protected), st.truncated || b.Len() > limit
}

func (st *renderState) child() *renderState {
	return &renderState{base: st.base, limit: st.limit, tableCell: st.tableCell, heading: st.heading, hoist: true, sub: st.sub + 1}
}

// renderChildren renders n's children into a fresh buffer with state c.
func (st *renderState) renderChildren(n *xhtml.Node, depth int, c *renderState) string {
	var b strings.Builder
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		c.renderNode(&b, ch, depth+1)
	}
	st.truncated = st.truncated || c.truncated
	return b.String()
}

func (st *renderState) renderChildrenDirect(b *strings.Builder, n *xhtml.Node, depth int) {
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		st.renderNode(b, ch, depth+1)
	}
}

// appendProtected writes a sub-render and re-bases its protected spans.
func (st *renderState) appendProtected(b *strings.Builder, s string, spans []renderSpan) {
	off := b.Len()
	b.WriteString(s)
	for _, sp := range spans {
		st.protected = append(st.protected, renderSpan{off + sp.start, off + sp.end})
	}
}

func (st *renderState) emitMarker(b *strings.Builder, m string) {
	if st.hoist {
		st.markers = append(st.markers, m)
		return
	}
	b.WriteString("\n\n" + m + "\n\n")
}

func (st *renderState) flushMarkers(b *strings.Builder, markers []string) {
	for _, m := range markers {
		st.emitMarker(b, m)
	}
}

// space writes one separating space unless the output already ends in
// whitespace, so adjacent whitespace-only nodes never accumulate.
func space(b *strings.Builder) {
	s := b.String()
	if len(s) == 0 {
		return
	}
	if last := s[len(s)-1]; last == ' ' || last == '\n' {
		return
	}
	b.WriteByte(' ')
}

func isBlock(tag string) bool {
	switch tag {
	case "p", "div", "section", "article", "main", "body", "html", "header", "footer", "nav", "aside",
		"figure", "figcaption", "address", "details", "summary", "dl", "dt", "dd", "fieldset", "legend",
		"form", "hgroup", "center", "search", "dialog", "caption",
		"table", "thead", "tbody", "tfoot", "tr", "td", "th":
		return true
	}
	return false
}

func (st *renderState) renderNode(b *strings.Builder, n *xhtml.Node, depth int) {
	if depth > maxRenderDepth {
		return
	}
	if b.Len() > st.limit {
		st.truncated = true
		return
	}
	switch n.Type {
	case xhtml.TextNode:
		st.writeText(b, n.Data)
		return
	case xhtml.CommentNode:
		if m, ok := pageMarker(n); ok {
			st.emitMarker(b, m)
		}
		return
	case xhtml.ElementNode, xhtml.DocumentNode:
	default:
		return
	}
	if st.renderBlockElement(b, n, depth) || st.renderInlineElement(b, n, depth) {
		return
	}
	tag := n.Data
	block := isBlock(tag)
	if block {
		b.WriteString("\n\n")
	}
	st.renderChildrenDirect(b, n, depth)
	if block {
		b.WriteString("\n\n")
	}
}

// renderBlockElement renders block elements with their own Markdown form and
// reports whether n was one.
func (st *renderState) renderBlockElement(b *strings.Builder, n *xhtml.Node, depth int) bool {
	switch n.Data {
	case "pre":
		st.renderPre(b, n)
		return true
	case "table":
		st.renderTable(b, n, depth)
		return true
	case "ul", "ol", "menu":
		st.renderList(b, n, depth)
		return true
	case "li":
		// A stray item outside any list renders as a one-item list.
		st.renderItems(b, n, []*xhtml.Node{n}, false, 1, depth)
		return true
	case "blockquote":
		st.renderBlockquote(b, n, depth)
		return true
	case "h1", "h2", "h3", "h4", "h5", "h6":
		st.renderHeading(b, n, depth)
		return true
	case "br":
		if st.heading {
			space(b)
		} else {
			b.WriteByte('\n')
		}
		return true
	case "hr":
		if !st.heading {
			b.WriteString("\n\n---\n\n")
		}
		return true
	}
	return false
}

// renderInlineElement renders inline elements with their own Markdown form
// and reports whether n was one.
func (st *renderState) renderInlineElement(b *strings.Builder, n *xhtml.Node, depth int) bool {
	switch n.Data {
	case "img":
		st.renderImage(b, n)
		return true
	case "code":
		st.renderInlineCode(b, n)
		return true
	case "strong", "b":
		st.renderWrapped(b, n, "**", depth)
		return true
	case "em", "i":
		st.renderWrapped(b, n, "*", depth)
		return true
	case "del", "s", "strike":
		st.renderWrapped(b, n, "~~", depth)
		return true
	case "a":
		st.renderLink(b, n, depth)
		return true
	}
	return false
}

func (st *renderState) writeText(b *strings.Builder, s string) {
	if strings.TrimSpace(s) == "" {
		if s != "" {
			space(b)
		}
		return
	}
	if leadingSpace(s) {
		space(b)
	}
	text := cleanSpace(s)
	if st.tableCell {
		text = tableTextEscaper.Replace(text)
	} else {
		// Literal text must not be able to forge a page marker line.
		text = strings.ReplaceAll(text, "<!--", "&lt;!--")
	}
	b.WriteString(text)
	if trailingSpace(s) {
		b.WriteByte(' ')
	}
}

func leadingSpace(s string) bool {
	r, _ := utf8.DecodeRuneInString(s)
	return unicode.IsSpace(r)
}

func trailingSpace(s string) bool {
	r, _ := utf8.DecodeLastRuneInString(s)
	return unicode.IsSpace(r)
}

// renderWrapped renders inline emphasis with the delimiters hugging the
// trimmed content so "<b>Note: </b>x" becomes "**Note:** x".
func (st *renderState) renderWrapped(b *strings.Builder, n *xhtml.Node, mark string, depth int) {
	if st.sub >= maxSubRender {
		st.renderChildrenDirect(b, n, depth)
		return
	}
	c := st.child()
	s := st.renderChildren(n, depth, c)
	if len(c.protected) > 0 {
		st.appendProtected(b, s, c.protected)
	} else {
		st.writeTrimmed(b, s, func(inner string) string {
			if st.heading || strings.Contains(inner, "\n\n") {
				return inner
			}
			return mark + inner + mark
		})
	}
	st.flushMarkers(b, c.markers)
}

// writeTrimmed writes wrap(trimmed s), preserving one boundary space on each
// side when s had surrounding whitespace.
func (st *renderState) writeTrimmed(b *strings.Builder, s string, wrap func(string) string) {
	inner := strings.TrimSpace(s)
	if inner == "" {
		if s != "" {
			space(b)
		}
		return
	}
	if leadingSpace(s) {
		space(b)
	}
	b.WriteString(wrap(inner))
	if trailingSpace(s) {
		b.WriteByte(' ')
	}
}

func hasAlnum(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

func (st *renderState) renderLink(b *strings.Builder, n *xhtml.Node, depth int) {
	raw := strings.TrimSpace(attr(n, "href"))
	if st.heading && strings.HasPrefix(raw, "#") {
		// Heading permalinks ("#", "¶", "🔗") are not heading text.
		if text, _ := codeText(n); !hasAlnum(text) {
			return
		}
	}
	href, ok := resolveLink(st.base, raw)
	if !ok || st.sub >= maxSubRender {
		st.renderChildrenDirect(b, n, depth)
		return
	}
	c := st.child()
	s := st.renderChildren(n, depth, c)
	if len(c.protected) > 0 {
		st.appendProtected(b, s, c.protected)
	} else {
		st.writeTrimmed(b, s, func(inner string) string {
			if strings.Contains(inner, "\n\n") {
				return inner
			}
			return "[" + inner + "](<" + href + ">)"
		})
	}
	st.flushMarkers(b, c.markers)
}

func (st *renderState) renderImage(b *strings.Builder, n *xhtml.Node) {
	if st.heading {
		return
	}
	src, ok := resolveLink(st.base, attr(n, "src"))
	if !ok {
		return
	}
	alt := imageAltEscaper.Replace(limitUTF8(cleanSpace(attr(n, "alt")), metadataStringLimit))
	b.WriteString("![" + alt + "](<" + src + ">)")
}

var imageAltEscaper = strings.NewReplacer("\\", "\\\\", "[", "\\[", "]", "\\]")

func (st *renderState) renderHeading(b *strings.Builder, n *xhtml.Node, depth int) {
	if st.tableCell || st.heading || st.sub >= maxSubRender {
		// A heading cannot live inside a table cell or another heading.
		b.WriteString("\n\n")
		st.renderChildrenDirect(b, n, depth)
		b.WriteString("\n\n")
		return
	}
	c := st.child()
	c.heading = true
	s := st.renderChildren(n, depth, c)
	if len(c.protected) > 0 {
		b.WriteString("\n\n")
		st.appendProtected(b, s, c.protected)
		b.WriteString("\n\n")
	} else if text := cleanSpace(s); text != "" {
		level := int(n.Data[1] - '0')
		b.WriteString("\n\n" + strings.Repeat("#", level) + " " + text + "\n\n")
	}
	st.flushMarkers(b, c.markers)
}

func (st *renderState) renderBlockquote(b *strings.Builder, n *xhtml.Node, depth int) {
	if st.tableCell || st.heading || st.sub >= maxSubRender {
		b.WriteString("\n\n")
		st.renderChildrenDirect(b, n, depth)
		b.WriteString("\n\n")
		return
	}
	c := st.child()
	content := normalizeRendered(st.renderChildren(n, depth, c), c.protected)
	if content != "" {
		lines := strings.Split(content, "\n")
		for i, line := range lines {
			if line == "" {
				lines[i] = ">"
			} else {
				lines[i] = "> " + line
			}
		}
		st.writeBlock(b, strings.Join(lines, "\n"), len(c.protected) > 0, "\n\n")
	}
	st.flushMarkers(b, c.markers)
}

// writeBlock writes a pre-normalised block, protecting it from further
// normalisation when it contains code.
func (st *renderState) writeBlock(b *strings.Builder, s string, protect bool, sep string) {
	b.WriteString(sep)
	start := b.Len()
	b.WriteString(s)
	if protect {
		st.protected = append(st.protected, renderSpan{start, b.Len()})
	}
	b.WriteString(sep)
}

// normalizeRendered collapses layout whitespace outside protected spans.
func normalizeRendered(s string, spans []renderSpan) string {
	if len(spans) == 0 {
		return normalizeBlocks(s)
	}
	parts := make([]string, 0, len(spans)*2+1)
	start := 0
	for _, span := range spans {
		if normal := normalizeBlocks(s[start:span.start]); normal != "" {
			parts = append(parts, normal)
		}
		parts = append(parts, s[span.start:span.end])
		start = span.end
	}
	if normal := normalizeBlocks(s[start:]); normal != "" {
		parts = append(parts, normal)
	}
	return strings.Join(parts, "\n\n")
}

// normalizeBlocks trims trailing whitespace from each line, collapses runs of
// blank lines, and trims the block. Only ordinary layout reaches here.
func normalizeBlocks(s string) string {
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	blank := false
	for _, line := range lines {
		line = strings.TrimRightFunc(line, unicode.IsSpace)
		if line == "" {
			if blank {
				continue
			}
			blank = true
		} else {
			blank = false
		}
		out = append(out, line)
	}
	return strings.Trim(strings.Join(out, "\n"), "\n")
}

// tableTextEscaper escapes source punctuation, not the structural markup
// emitted by the renderer. Pipes/newlines are handled once at the final
// table-cell boundary.
var tableTextEscaper = strings.NewReplacer(
	"\\", "\\\\", "*", "\\*", "_", "\\_", "`", "\\`",
	"[", "\\[", "]", "\\]", "&", "&amp;", "<", "&lt;", ">", "&gt;",
)
