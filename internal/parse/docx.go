package parse

import (
	"fmt"
	"strconv"
	"strings"
)

// parseDOCX converts a Word document's body to Markdown: headings (from
// heading styles or outline levels), lists, tables and paragraphs. Headers,
// footers, comments and deleted tracked changes are skipped.
func parseDOCX(in Input, lim Limits) (Document, error) {
	z, err := openZip(in.Data, lim)
	if err != nil {
		return Document{}, err
	}
	doc, err := z.xml("word/document.xml")
	if err != nil {
		return Document{}, err
	}
	if doc == nil {
		return Document{}, fmt.Errorf("%w: missing word/document.xml", ErrCorrupt)
	}
	styles, err := z.xml("word/styles.xml")
	if err != nil {
		return Document{}, err
	}
	w := &docxWriter{levels: headingLevels(styles), maxBytes: lim.MaxMarkdownBytes}
	if body := doc.path("document", "body"); body != nil {
		w.blocks(body)
	}
	if w.overflow {
		return Document{}, fmt.Errorf("%w: converted text exceeds the limit", ErrTooLarge)
	}
	md := cleanMarkdown(w.b.String())
	title := z.coreTitle()
	if title == "" {
		title = firstHeading(md)
	}
	if title == "" {
		title = titleFromName(in.Name)
	}
	return Document{Title: title, Markdown: md, Parser: "builtin:docx"}, nil
}

// headingLevels maps paragraph style IDs to heading levels (1-6), following
// basedOn chains so custom styles derived from headings count too.
func headingLevels(styles *node) map[string]int {
	type style struct {
		level   int
		basedOn string
	}
	all := map[string]style{}
	if root := styles.path("styles"); root != nil {
		for _, s := range root.children {
			if s.name != "style" || (s.attr("type") != "" && s.attr("type") != "paragraph") {
				continue
			}
			st := style{}
			if b := s.child("basedOn"); b != nil {
				st.basedOn = b.attr("val")
			}
			if n := s.child("name"); n != nil {
				st.level = levelFromStyleName(n.attr("val"))
			}
			if ol := s.path("pPr", "outlineLvl"); ol != nil && st.level == 0 {
				if v, err := strconv.Atoi(ol.attr("val")); err == nil && v < 9 {
					st.level = v + 1
				}
			}
			all[s.attr("styleId")] = st
		}
	}
	out := map[string]int{}
	for id := range all {
		cur, seen := id, 0
		for cur != "" && seen < 10 {
			st := all[cur]
			if st.level > 0 {
				out[id] = min(st.level, 6)
				break
			}
			cur, seen = st.basedOn, seen+1
		}
	}
	return out
}

func levelFromStyleName(name string) int {
	n := strings.ToLower(strings.ReplaceAll(name, " ", ""))
	switch {
	case n == "title":
		return 1
	case n == "subtitle":
		return 2
	case strings.HasPrefix(n, "heading"):
		if v, err := strconv.Atoi(strings.TrimPrefix(n, "heading")); err == nil && v >= 1 && v <= 9 {
			return v
		}
	}
	return 0
}

type docxWriter struct {
	b        strings.Builder
	levels   map[string]int
	maxBytes int
	overflow bool
}

func (w *docxWriter) write(s string) {
	if w.b.Len()+len(s) > w.maxBytes {
		w.overflow = true
		return
	}
	w.b.WriteString(s)
}

// blocks renders block-level content (paragraphs, tables, content controls).
func (w *docxWriter) blocks(n *node) {
	for _, c := range n.children {
		if w.overflow {
			return
		}
		switch c.name {
		case "p":
			w.paragraph(c)
		case "tbl":
			w.write("\n" + markdownTable(tableRows(c)) + "\n")
		case "sdt":
			if content := c.child("sdtContent"); content != nil {
				w.blocks(content)
			}
		case "customXml", "ins":
			w.blocks(c)
		}
	}
}

func (w *docxWriter) paragraph(p *node) {
	text := strings.TrimSpace(runText(p))
	if text == "" {
		return
	}
	level := 0
	indent := -1
	if ppr := p.child("pPr"); ppr != nil {
		if ps := ppr.child("pStyle"); ps != nil {
			level = w.levels[ps.attr("val")]
		}
		if ol := ppr.child("outlineLvl"); ol != nil && level == 0 {
			if v, err := strconv.Atoi(ol.attr("val")); err == nil && v < 9 {
				level = min(v+1, 6)
			}
		}
		if np := ppr.child("numPr"); np != nil {
			indent = 0
			if il := np.child("ilvl"); il != nil {
				if v, err := strconv.Atoi(il.attr("val")); err == nil && v >= 0 && v < 10 {
					indent = v
				}
			}
		}
	}
	switch {
	case level > 0:
		w.write("\n" + strings.Repeat("#", level) + " " + strings.Join(strings.Fields(text), " ") + "\n\n")
	case indent >= 0:
		w.write(strings.Repeat("  ", indent) + "- " + strings.ReplaceAll(text, "\n", " ") + "\n")
	default:
		w.write("\n" + text + "\n\n")
	}
}

// runText collects the visible text of a paragraph or cell, skipping
// deleted tracked changes and field instructions.
func runText(n *node) string {
	var b strings.Builder
	var walk func(*node)
	walk = func(n *node) {
		for _, c := range n.children {
			switch c.name {
			case "t":
				b.WriteString(c.text)
			case "tab":
				b.WriteString("\t")
			case "br", "cr":
				b.WriteString("\n")
			case "noBreakHyphen":
				b.WriteString("-")
			case "del", "instrText", "delText", "pPr", "rPr", "commentReference", "footnoteReference":
			case "p":
				walk(c)
				b.WriteString("\n")
			default:
				walk(c)
			}
		}
	}
	walk(n)
	return b.String()
}

func tableRows(tbl *node) [][]string {
	var rows [][]string
	for _, tr := range tbl.children {
		if tr.name != "tr" {
			continue
		}
		var row []string
		for _, tc := range tr.children {
			if tc.name == "tc" {
				row = append(row, strings.TrimSpace(runText(tc)))
			}
		}
		if len(row) > 0 {
			rows = append(rows, row)
		}
	}
	return rows
}
