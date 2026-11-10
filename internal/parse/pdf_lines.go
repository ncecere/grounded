package parse

import (
	"math"
	"regexp"
	"strings"

	"github.com/klippa-app/go-pdfium/responses"
)

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
