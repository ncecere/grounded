package parse

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

var bulletRE = regexp.MustCompile(`^([•◦▪▫●○■□‣⁃\-–*]|\d{1,3}[.)]|[a-zA-Z][.)])\s+`)

// renderPDF turns lines into Markdown with headings inferred from font size
// and a page marker at each page start. ocr holds the text of pages read
// with OCR, written under their markers as it came.
func renderPDF(lines []pdfLine, pages int, ocr map[int]string) string {
	body := bodySize(lines)
	levels := headingSizes(lines, body)
	margins := leftMargins(lines)
	var b strings.Builder
	page := 0
	var para []string
	var last *pdfLine
	flushPara := func() {
		if len(para) > 0 {
			b.WriteString(joinLines(para) + "\n\n")
			para = nil
		}
	}
	for i := range lines {
		l := &lines[i]
		for page < l.page {
			flushPara()
			page++
			writePageStart(&b, page, ocr)
			last = nil
		}
		if lvl := levels[roundSize(l.size)]; lvl > 0 && isHeadingText(l.text) {
			flushPara()
			b.WriteString(strings.Repeat("#", lvl) + " " + strings.ReplaceAll(l.text, softHyphen, "") + "\n\n")
			last = l
			continue
		}
		if m := bulletRE.FindString(l.text); m != "" {
			flushPara()
			item := strings.TrimSpace(strings.TrimPrefix(l.text, m))
			if strings.ContainsAny(m[:1], "0123456789") {
				item = strings.TrimSpace(m) + " " + item
			}
			para = []string{"- " + item}
			last = l
			continue
		}
		if last != nil {
			height := math.Max(last.top-last.bottom, 1)
			gap := last.bottom - l.top
			// First-line indent: how LaTeX and many books start paragraphs.
			indent := l.left - margins[l.page]
			indented := indent > l.size*0.8 && indent < l.size*6
			if gap > height*0.9 || math.Abs(l.size-last.size) > 1.5 || indented {
				flushPara()
			}
		}
		para = append(para, l.text)
		last = l
	}
	flushPara()
	for page < pages {
		page++
		writePageStart(&b, page, ocr)
	}
	return cleanMarkdown(b.String())
}

// writePageStart writes a page's marker and, for a page read with OCR, its
// text.
func writePageStart(b *strings.Builder, page int, ocr map[int]string) {
	b.WriteString(PageMarker(page) + "\n\n")
	if t := ocr[page]; t != "" {
		b.WriteString(t + "\n\n")
	}
}

// softHyphen marks a line-break hyphen. PDFium reports every hyphen at the
// end of a line as U+0002 (some producers emit U+00AD), so a genuine
// compound split across lines ("well-/known") is joined as "wellknown". That
// is the better trade-off for search: most line-end hyphens are word breaks.
const softHyphen = "\u00ad"

// normalizePDFText maps PDFium's hyphen markers to softHyphen, keeps it only
// at the end of the line, drops other control characters and collapses
// whitespace.
func normalizePDFText(s string) string {
	s = strings.ReplaceAll(s, "\x02", softHyphen)
	s = strings.Map(func(r rune) rune {
		if r < 0x20 && r != '\t' {
			return -1
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	soft := strings.HasSuffix(s, softHyphen)
	s = strings.ReplaceAll(s, softHyphen, "")
	if soft {
		s += softHyphen
	}
	return s
}

// joinLines joins wrapped lines. A soft (line-break) hyphen joins the word
// halves; a real hyphen at a line end is kept without adding a space.
func joinLines(ls []string) string {
	var b strings.Builder
	for i, l := range ls {
		prev := b.String()
		switch {
		case i == 0:
		case strings.HasSuffix(prev, softHyphen):
			b.Reset()
			b.WriteString(strings.TrimSuffix(prev, softHyphen))
		case strings.HasSuffix(prev, "-") && startsLower(l):
		default:
			b.WriteString(" ")
		}
		b.WriteString(l)
	}
	return strings.ReplaceAll(b.String(), softHyphen, "")
}

func startsLower(s string) bool {
	for _, r := range s {
		return unicode.IsLower(r)
	}
	return false
}

func roundSize(s float64) float64 { return math.Round(s*2) / 2 }

// leftMargins returns each page's most common line start (the text margin).
func leftMargins(lines []pdfLine) map[int]float64 {
	counts := map[int]map[float64]int{}
	for _, l := range lines {
		if counts[l.page] == nil {
			counts[l.page] = map[float64]int{}
		}
		counts[l.page][math.Round(l.left)]++
	}
	out := map[int]float64{}
	for page, c := range counts {
		best, bestN := 0.0, 0
		for x, n := range c {
			if n > bestN || (n == bestN && x < best) {
				best, bestN = x, n
			}
		}
		out[page] = best
	}
	return out
}

// bodySize is the font size covering the most characters.
func bodySize(lines []pdfLine) float64 {
	chars := map[float64]int{}
	for _, l := range lines {
		chars[roundSize(l.size)] += l.chars
	}
	best, bestN := 0.0, -1
	for s, n := range chars {
		if n > bestN || (n == bestN && s < best) {
			best, bestN = s, n
		}
	}
	return best
}

// headingSizes maps the three largest sizes clearly above body text to
// heading levels 1-3.
func headingSizes(lines []pdfLine, body float64) map[float64]int {
	seen := map[float64]bool{}
	var sizes []float64
	for _, l := range lines {
		s := roundSize(l.size)
		if body > 0 && s >= body*1.15 && s-body >= 1 && !seen[s] && isHeadingText(l.text) {
			seen[s] = true
			sizes = append(sizes, s)
		}
	}
	sort.Sort(sort.Reverse(sort.Float64Slice(sizes)))
	out := map[float64]int{}
	for i, s := range sizes {
		out[s] = min(i+1, 3)
	}
	return out
}

func isHeadingText(t string) bool {
	if len(t) > 150 || len(t) < 2 {
		return false
	}
	letters := 0
	for _, r := range t {
		if unicode.IsLetter(r) {
			letters++
		}
	}
	return letters >= 2
}
