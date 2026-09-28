package parse

import (
	"fmt"
	"path"
	"strconv"
	"strings"
)

// parsePPTX converts a presentation to Markdown, one page per slide in
// presentation order: the slide title as a heading, text as bullets, tables,
// and speaker notes.
func parsePPTX(in Input, lim Limits) (Document, error) {
	z, err := openZip(in.Data, lim)
	if err != nil {
		return Document{}, err
	}
	pres, err := z.xml("ppt/presentation.xml")
	if err != nil {
		return Document{}, err
	}
	if pres == nil {
		return Document{}, fmt.Errorf("%w: missing ppt/presentation.xml", ErrCorrupt)
	}
	rels, err := z.relationships("ppt/_rels/presentation.xml.rels")
	if err != nil {
		return Document{}, err
	}
	var slides []string
	if lst := pres.path("presentation", "sldIdLst"); lst != nil {
		for _, s := range lst.children {
			if target := rels[s.attr("id")]; target != "" {
				slides = append(slides, resolvePart("ppt", target))
			}
		}
	}
	var (
		b        strings.Builder
		warnings []string
	)
	count := 0
	for i, slidePath := range slides {
		if i >= lim.MaxPages {
			warnings = append(warnings, fmt.Sprintf("only the first %d slides were processed", lim.MaxPages))
			break
		}
		slide, err := z.xml(slidePath)
		if err != nil {
			return Document{}, err
		}
		if slide == nil {
			continue
		}
		count++
		b.WriteString("\n" + PageMarker(i+1) + "\n\n")
		title, body := slideContent(slide)
		heading := "## Slide " + strconv.Itoa(i+1)
		if title != "" {
			heading += ": " + title
		}
		b.WriteString(heading + "\n\n" + body)
		if notes := slideNotes(z, slidePath); notes != "" {
			b.WriteString("\n**Notes:** " + notes + "\n")
		}
		if b.Len() > lim.MaxMarkdownBytes {
			return Document{}, fmt.Errorf("%w: converted text exceeds the limit", ErrTooLarge)
		}
	}
	md := cleanMarkdown(b.String())
	title := z.coreTitle()
	if title == "" {
		title = titleFromName(in.Name)
	}
	return Document{Title: title, Markdown: md, Pages: count, Parser: "builtin:pptx", Warnings: warnings}, nil
}

// resolvePart turns a relationship target relative to dir into a part name.
func resolvePart(dir, target string) string {
	if strings.HasPrefix(target, "/") {
		return strings.TrimPrefix(path.Clean(target), "/")
	}
	return path.Clean(path.Join(dir, target))
}

// slideContent returns the title and the Markdown body of a slide.
func slideContent(slide *node) (string, string) {
	tree := slide.find("spTree")
	if tree == nil {
		return "", ""
	}
	sw := &slideWriter{}
	sw.shapes(tree)
	return sw.title, sw.b.String()
}

// slideWriter renders a slide's shapes: the first title placeholder is the
// title, other text becomes bullets (by level) and tables pipe tables.
// Footers (slide number, date, footer) are skipped.
type slideWriter struct {
	title string
	b     strings.Builder
}

func (sw *slideWriter) shapes(n *node) {
	for _, c := range n.children {
		switch c.name {
		case "sp":
			sw.shape(c)
		case "graphicFrame":
			if tbl := c.find("tbl"); tbl != nil {
				sw.b.WriteString("\n" + markdownTable(drawingTableRows(tbl)) + "\n")
			}
		case "grpSp":
			sw.shapes(c)
		}
	}
}

func (sw *slideWriter) shape(c *node) {
	ph := c.find("ph")
	isTitle := ph != nil && (ph.attr("type") == "title" || ph.attr("type") == "ctrTitle")
	isFooter := ph != nil && (ph.attr("type") == "sldNum" || ph.attr("type") == "dt" || ph.attr("type") == "ftr")
	tb := c.child("txBody")
	if tb == nil || isFooter {
		return
	}
	if isTitle && sw.title == "" {
		sw.title = strings.Join(strings.Fields(paragraphsText(tb, " ")), " ")
		return
	}
	for _, p := range tb.children {
		if p.name != "p" {
			continue
		}
		text := strings.TrimSpace(drawingText(p))
		if text == "" {
			continue
		}
		sw.b.WriteString(strings.Repeat("  ", bulletLevel(p)) + "- " + text + "\n")
	}
}

// bulletLevel is a paragraph's indent level (0-9).
func bulletLevel(p *node) int {
	if ppr := p.child("pPr"); ppr != nil {
		if v, err := strconv.Atoi(ppr.attr("lvl")); err == nil && v >= 0 && v < 10 {
			return v
		}
	}
	return 0
}

// drawingTableRows returns the cell texts of a DrawingML table.
func drawingTableRows(tbl *node) [][]string {
	var rows [][]string
	for _, tr := range tbl.children {
		if tr.name != "tr" {
			continue
		}
		var row []string
		for _, tc := range tr.children {
			if tc.name == "tc" {
				row = append(row, strings.TrimSpace(paragraphsText(tc, " ")))
			}
		}
		rows = append(rows, row)
	}
	return rows
}

// drawingText returns the text of one DrawingML paragraph.
func drawingText(p *node) string {
	var b strings.Builder
	var walk func(*node)
	walk = func(n *node) {
		for _, c := range n.children {
			switch c.name {
			case "t":
				b.WriteString(c.text)
			case "br":
				b.WriteString(" ")
			case "pPr", "rPr", "endParaRPr":
			default:
				walk(c)
			}
		}
	}
	walk(p)
	return b.String()
}

// paragraphsText joins all DrawingML paragraphs under n with sep.
func paragraphsText(n *node, sep string) string {
	var parts []string
	var walk func(*node)
	walk = func(n *node) {
		for _, c := range n.children {
			if c.name == "p" {
				if t := strings.TrimSpace(drawingText(c)); t != "" {
					parts = append(parts, t)
				}
				continue
			}
			walk(c)
		}
	}
	walk(n)
	return strings.Join(parts, sep)
}

// slideNotes returns the speaker notes for a slide, if any.
func slideNotes(z *zipDoc, slidePath string) string {
	dir, file := path.Split(slidePath)
	rels, err := z.relationships(path.Join(dir, "_rels", file+".rels"))
	if err != nil {
		return ""
	}
	for _, target := range rels {
		if !strings.Contains(target, "notesSlide") {
			continue
		}
		notes, err := z.xml(resolvePart(strings.TrimSuffix(dir, "/"), target))
		if err != nil || notes == nil {
			return ""
		}
		tree := notes.find("spTree")
		if tree == nil {
			return ""
		}
		var parts []string
		for _, sp := range tree.children {
			if sp.name != "sp" {
				continue
			}
			if ph := sp.find("ph"); ph != nil && ph.attr("type") != "body" {
				continue // slide image and number placeholders
			}
			if tb := sp.child("txBody"); tb != nil {
				if t := paragraphsText(tb, " "); t != "" {
					parts = append(parts, t)
				}
			}
		}
		return strings.Join(parts, " ")
	}
	return ""
}
