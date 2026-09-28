package parse

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/klippa-app/go-pdfium"
	pdfiumerrors "github.com/klippa-app/go-pdfium/errors"
	"github.com/klippa-app/go-pdfium/requests"
	"github.com/klippa-app/go-pdfium/responses"
	"github.com/klippa-app/go-pdfium/webassembly"
)

// pdfEngine runs PDFium (Chrome's PDF library) compiled to WebAssembly
// inside the Go process: no CGO, no external service, and malformed or
// hostile PDFs are contained by the WebAssembly sandbox.
type pdfEngine struct {
	workers int
	once    sync.Once
	pool    pdfium.Pool
	err     error
}

func (e *pdfEngine) instance() (pdfium.Pdfium, error) {
	e.once.Do(func() {
		n := max(e.workers, 1)
		e.pool, e.err = webassembly.Init(webassembly.Config{MinIdle: 1, MaxIdle: n, MaxTotal: n})
	})
	if e.err != nil {
		return nil, fmt.Errorf("start PDF engine: %w", e.err)
	}
	return e.pool.GetInstance(2 * time.Minute)
}

func (e *pdfEngine) Close() error {
	if e.pool != nil {
		return e.pool.Close()
	}
	return nil
}

// pdfLine is one line of text on a page.
type pdfLine struct {
	page        int
	text        string
	left        float64
	top, bottom float64
	size        float64
	chars       int
}

func (e *pdfEngine) parse(ctx context.Context, in Input, lim Limits) (Document, error) {
	inst, err := e.instance()
	if err != nil {
		return Document{}, err
	}
	defer inst.Close()

	data := in.Data
	opened, err := inst.OpenDocument(&requests.OpenDocument{File: &data})
	if err != nil {
		if errors.Is(err, pdfiumerrors.ErrPassword) {
			return Document{}, ErrEncrypted
		}
		return Document{}, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	defer inst.FPDF_CloseDocument(&requests.FPDF_CloseDocument{Document: opened.Document})

	count, err := inst.FPDF_GetPageCount(&requests.FPDF_GetPageCount{Document: opened.Document})
	if err != nil {
		return Document{}, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	pages := count.PageCount
	var warnings []string
	if pages > lim.MaxPages {
		warnings = append(warnings, fmt.Sprintf("only the first %d of %d pages were processed", lim.MaxPages, pages))
		pages = lim.MaxPages
	}

	var lines []pdfLine
	emptyPages := 0
	for i := 0; i < pages; i++ {
		if err := ctx.Err(); err != nil {
			return Document{}, err
		}
		st, err := inst.GetPageTextStructured(&requests.GetPageTextStructured{
			Page:                   requests.Page{ByIndex: &requests.PageByIndex{Document: opened.Document, Index: i}},
			Mode:                   requests.GetPageTextStructuredModeRects,
			CollectFontInformation: true,
		})
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("page %d could not be read", i+1))
			emptyPages++
			continue
		}
		pageLines := linesFromRects(i+1, st.Rects)
		if len(pageLines) == 0 {
			emptyPages++
		}
		lines = append(lines, pageLines...)
	}
	if len(lines) == 0 && pages > 0 {
		return Document{Pages: pages}, ErrNeedsOCR
	}
	if emptyPages > 0 {
		warnings = append(warnings, fmt.Sprintf("%d of %d pages had no extractable text (possibly scanned) and were skipped", emptyPages, pages))
	}

	title := ""
	if meta, err := inst.FPDF_GetMetaText(&requests.FPDF_GetMetaText{Document: opened.Document, Tag: "Title"}); err == nil {
		title = strings.TrimSpace(meta.Value)
	}
	md := renderPDF(removeRunningHeaders(lines, pages), pages)
	if len(md) > lim.MaxMarkdownBytes {
		return Document{}, fmt.Errorf("%w: converted text exceeds the limit", ErrTooLarge)
	}
	if title == "" || looksLikeFilename(title) {
		if h := firstHeading(md); h != "" {
			title = h
		} else {
			title = titleFromName(in.Name)
		}
	}
	return Document{Title: title, Markdown: md, Pages: pages, Parser: "builtin:pdf", Warnings: warnings}, nil
}

var fileNameRE = regexp.MustCompile(`(?i)\.[a-z0-9]{2,5}$`)

// looksLikeFilename catches producer-supplied titles such as
// "regchapfinal.dvi" or "Microsoft Word - draft".
func looksLikeFilename(s string) bool {
	l := strings.ToLower(s)
	return fileNameRE.MatchString(l) && !strings.Contains(l, " ") || strings.HasPrefix(l, "microsoft word")
}

type responsesRect = responses.GetPageTextStructuredRect

func toRect(r *responsesRect) pdfRect {
	out := pdfRect{text: r.Text, left: r.PointPosition.Left, right: r.PointPosition.Right,
		top: r.PointPosition.Top, bottom: r.PointPosition.Bottom}
	// PDFium reports top/bottom in page space (y grows upwards); normalise so
	// top >= bottom regardless.
	if out.bottom > out.top {
		out.top, out.bottom = out.bottom, out.top
	}
	if fi := r.FontInformation; fi != nil {
		out.size = fi.Size
		if fi.RenderedSize > 0 {
			out.size = fi.RenderedSize
		}
	}
	if out.size <= 0 {
		out.size = out.top - out.bottom
	}
	return out
}

type pdfRect struct {
	text                     string
	left, right, top, bottom float64
	size                     float64
}

// linesFromRects groups PDFium text rects, in content order, into lines. A
// new line starts when the vertical position changes or text moves back to
// the left (a wrap). Content order usually follows reading order, including
// multi-column layouts.
func linesFromRects(page int, rects []*responsesRect) []pdfLine {
	var out []pdfLine
	var cur *pdfLine
	var prev *pdfRect
	flush := func() {
		if cur != nil {
			cur.text = normalizePDFText(cur.text)
			if cur.text != "" {
				out = append(out, *cur)
			}
		}
		cur, prev = nil, nil
	}
	for _, rr := range rects {
		if rr == nil || strings.TrimSpace(rr.Text) == "" {
			continue
		}
		r := toRect(rr)
		height := math.Max(r.top-r.bottom, 1)
		if cur != nil && prev != nil {
			sameLine := math.Abs(r.top-cur.top) < height*0.6 || math.Abs(r.bottom-cur.bottom) < height*0.6
			if !sameLine || r.left < prev.left-height*2 {
				flush()
			}
		}
		if cur == nil {
			cur = &pdfLine{page: page, left: r.left, top: r.top, bottom: r.bottom}
		} else if prev != nil && r.left-prev.right > r.size*0.15 &&
			!strings.HasSuffix(cur.text, " ") && !strings.HasPrefix(r.text, " ") {
			cur.text += " "
		}
		cur.text += r.text
		cur.top, cur.bottom = math.Max(cur.top, r.top), math.Min(cur.bottom, r.bottom)
		n := len([]rune(strings.TrimSpace(r.text)))
		if n > cur.chars {
			cur.size = r.size // the dominant (longest) run sets the line's size
		}
		cur.chars += n
		p := r
		prev = &p
	}
	flush()
	return out
}

// running headers/footers: digits normalised so "Page 3" matches "Page 4".
var digitsRE = regexp.MustCompile(`\d+`)
var pageNumberRE = regexp.MustCompile(`(?i)^(page\s*)?\d+(\s*(of|/)\s*\d+)?$`)

// removeRunningHeaders drops page numbers and lines repeated at the top or
// bottom of most pages (running headers and footers).
func removeRunningHeaders(lines []pdfLine, pages int) []pdfLine {
	byPage := map[int][]int{}
	for i, l := range lines {
		byPage[l.page] = append(byPage[l.page], i)
	}
	edge := map[int]bool{} // indexes of the first/last two lines per page
	for _, idx := range byPage {
		for j, i := range idx {
			if j < 2 || j >= len(idx)-2 {
				edge[i] = true
			}
		}
	}
	counts := map[string]int{}
	for i := range edge {
		counts[digitsRE.ReplaceAllString(strings.ToLower(lines[i].text), "#")]++
	}
	out := lines[:0:0]
	for i, l := range lines {
		if edge[i] {
			if pageNumberRE.MatchString(l.text) {
				continue
			}
			if pages >= 3 && counts[digitsRE.ReplaceAllString(strings.ToLower(l.text), "#")] >= max(3, pages/2) {
				continue
			}
		}
		out = append(out, l)
	}
	return out
}

var bulletRE = regexp.MustCompile(`^([•◦▪▫●○■□‣⁃\-–*]|\d{1,3}[.)]|[a-zA-Z][.)])\s+`)

// renderPDF turns lines into Markdown with headings inferred from font size
// and a page marker at each page start.
func renderPDF(lines []pdfLine, pages int) string {
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
			b.WriteString(PageMarker(page) + "\n\n")
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
		b.WriteString(PageMarker(page) + "\n\n")
	}
	return cleanMarkdown(b.String())
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
