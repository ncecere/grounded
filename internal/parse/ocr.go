// OCR for pages without a text layer (docs/ocr.md §1). The parser decides
// which pages need it and renders them; a backend (Tesseract, Tika or a
// vision model, internal/ocr) reads one page image at a time, so the
// backends stay interchangeable and small.

package parse

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// OCR reads the text of one page image (PNG).
type OCR interface {
	// Recognize returns the page's text. langs are Tesseract language codes
	// joined with "+" (e.g. "eng+spa"); backends that detect the language
	// themselves ignore them.
	Recognize(ctx context.Context, img []byte, langs string) (OCRResult, error)
}

// OCRResult is one page's text and what reading it cost.
type OCRResult struct {
	Text string
	// Confidence is the backend's mean word confidence (0-1), or 0 when it
	// reports none.
	Confidence float64
	// TokensIn and TokensOut are a vision model's usage.
	TokensIn, TokensOut int
}

// OCROptions turn OCR on for one parse (Input.OCR; nil: off).
type OCROptions struct {
	Engine OCR
	// Backend names the engine in Document.Parser ("tesseract", "tika",
	// "vision").
	Backend   string
	Languages string
	// MaxPages bounds the pages read per document (OCR_MAX_PAGES_PER_DOCUMENT);
	// pages beyond it are skipped with a warning. 0 means 200.
	MaxPages int
	// Concurrency bounds the pages of this document read at once (default 1).
	Concurrency int
	// Reserve is called once, before any page is read, with the number of
	// pages to read. It returns how many may be read (fewer are skipped with
	// a warning; 0 reads none) or an error that stops parsing, such as
	// *OCRWait for the team's daily page limit. Nil admits every page.
	Reserve func(ctx context.Context, pages int) (int, error)
}

// OCRInfo records the pages a document had read with OCR.
type OCRInfo struct {
	Backend string `json:"backend"`
	Pages   []int  `json:"pages"` // 1-based, ascending
	// Usage: a vision model's tokens (not stored with the document).
	TokensIn  int `json:"-"`
	TokensOut int `json:"-"`
}

// DefaultOCRMaxPages is the per-document page cap when none is set.
const DefaultOCRMaxPages = 200

var (
	// ErrOCRLimit: reading the pages would pass the team's daily OCR page
	// limit. Parsing stops; the document waits (OCRWait).
	ErrOCRLimit = errors.New("the team's daily OCR page limit is reached")
	// ErrOCRUnavailable: the OCR backend could not be reached or failed
	// temporarily. The document is retried, not parsed without OCR.
	ErrOCRUnavailable = errors.New("the OCR service is unavailable")
)

// OCRWait is returned by OCROptions.Reserve when the document has to wait
// for the daily page limit until Until (the next UTC day).
type OCRWait struct {
	Until time.Time
	Pages int // the pages the document needs
}

func (w *OCRWait) Error() string {
	return fmt.Sprintf("%v: %d pages wait until %s", ErrOCRLimit, w.Pages, w.Until.UTC().Format(time.RFC3339))
}

func (w *OCRWait) Unwrap() error { return ErrOCRLimit }

// parserName is "builtin:pdf" or, with OCR, "builtin:pdf+ocr:tesseract".
func parserName(base string, info *OCRInfo) string {
	if info == nil {
		return base
	}
	return base + "+ocr:" + info.Backend
}

// ocrPlan applies the per-document cap and the daily reservation to the
// pages that need OCR (1-based) and returns the pages to read, with
// warnings for those left out.
func ocrPlan(ctx context.Context, o *OCROptions, pages []int) ([]int, []string, error) {
	var warnings []string
	maxPages := o.MaxPages
	if maxPages <= 0 {
		maxPages = DefaultOCRMaxPages
	}
	if len(pages) > maxPages {
		warnings = append(warnings, fmt.Sprintf("%d pages without text were not read with OCR: at most %d pages per document are",
			len(pages)-maxPages, maxPages))
		pages = pages[:maxPages]
	}
	if o.Reserve != nil {
		n, err := o.Reserve(ctx, len(pages))
		if err != nil {
			return nil, nil, err
		}
		n = max(n, 0)
		if n < len(pages) {
			if n == 0 {
				warnings = append(warnings, fmt.Sprintf("%d pages without text were not read: OCR is blocked for this team", len(pages)))
			} else {
				warnings = append(warnings, fmt.Sprintf("%d pages without text were not read with OCR: they are more than the team's daily OCR page limit",
					len(pages)-n))
			}
			pages = pages[:n]
		}
	}
	return pages, warnings, nil
}

// pageImage is one rendered page, or the error rendering it.
type pageImage struct {
	page int
	png  []byte
	err  error
}

// pageText is one page's OCR outcome.
type pageText struct {
	text string
	res  OCRResult
	err  error
}

// ocrPages reads the pages (1-based, already planned) with OCR and returns
// their text by page, the OCR record and warnings. render makes one page's
// image; pages are rendered one at a time as the engine takes them, so at
// most Concurrency page images are held in memory.
func ocrPages(ctx context.Context, o *OCROptions, pages []int, render func(page int) ([]byte, error)) (map[int]string, *OCRInfo, []string, error) {
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	images := make(chan pageImage, max(o.Concurrency, 1))
	done := make(chan struct{})
	var (
		results map[int]pageText
		ocrErr  error
	)
	go func() {
		defer close(done)
		results, ocrErr = recognizeAll(ctx, stop, o, images)
	}()
	for _, p := range pages {
		if ctx.Err() != nil {
			break // a fatal OCR error, or cancelled
		}
		img, err := render(p)
		images <- pageImage{page: p, png: img, err: err}
	}
	close(images)
	<-done
	if ocrErr != nil {
		return nil, nil, nil, ocrErr
	}
	texts, info, warnings := collectOCR(o.Backend, pages, results)
	return texts, info, warnings, nil
}

// recognizeAll reads rendered pages from images with up to o.Concurrency
// requests at once, until images is closed. The first error that makes the
// whole document retry (ErrOCRUnavailable, a cancelled context, or an error
// the engine marks as backpressure) calls stop, so the producer stops
// rendering, and is returned; other per-page failures become warnings.
func recognizeAll(ctx context.Context, stop context.CancelFunc, o *OCROptions, images <-chan pageImage) (map[int]pageText, error) {
	n := max(o.Concurrency, 1)
	var (
		mu    sync.Mutex
		out   = map[int]pageText{}
		first error
		wg    sync.WaitGroup
	)
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for img := range images {
				t := pageText{err: img.err}
				if img.err == nil && ctx.Err() == nil {
					t.res, t.err = o.Engine.Recognize(ctx, img.png, o.Languages)
					t.text = CleanOCRText(t.res.Text)
				}
				mu.Lock()
				out[img.page] = t
				if t.err != nil && first == nil && fatalOCRError(ctx, t.err) {
					first = t.err
					stop()
				}
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if first != nil {
		return nil, first
	}
	return out, ctx.Err()
}

// fatalOCRError reports whether an OCR error fails the document (to be
// retried) rather than one page.
func fatalOCRError(ctx context.Context, err error) bool {
	var bp interface{ Backpressure() bool }
	return ctx.Err() != nil || errors.Is(err, ErrOCRUnavailable) || errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &bp) && bp.Backpressure())
}

// collectOCR turns per-page results into the page texts that go into the
// document, the OCR record and warnings.
func collectOCR(backend string, pages []int, results map[int]pageText) (map[int]string, *OCRInfo, []string) {
	texts := map[int]string{}
	info := &OCRInfo{Backend: backend}
	var failed, empty []int
	for _, p := range pages {
		r := results[p]
		info.TokensIn += r.res.TokensIn
		info.TokensOut += r.res.TokensOut
		switch {
		case r.err != nil:
			failed = append(failed, p)
		case r.text == "":
			empty = append(empty, p)
			info.Pages = append(info.Pages, p)
		default:
			texts[p] = r.text
			info.Pages = append(info.Pages, p)
		}
	}
	var warnings []string
	if len(failed) > 0 {
		warnings = append(warnings, fmt.Sprintf("OCR could not read %s %s", pagesNoun(len(failed)), PageList(failed)))
	}
	if len(empty) > 0 {
		warnings = append(warnings, fmt.Sprintf("OCR found no text on %s %s", pagesNoun(len(empty)), PageList(empty)))
	}
	if len(info.Pages) == 0 && info.TokensIn == 0 && info.TokensOut == 0 {
		info = nil
	}
	return texts, info, warnings
}

func pagesNoun(n int) string {
	if n == 1 {
		return "page"
	}
	return "pages"
}

// PageList renders pages as ranges: "3-7, 9".
func PageList(pages []int) string {
	var b strings.Builder
	for i := 0; i < len(pages); {
		j := i
		for j+1 < len(pages) && pages[j+1] == pages[j]+1 {
			j++
		}
		if b.Len() > 0 {
			b.WriteString(", ")
		}
		if j > i {
			fmt.Fprintf(&b, "%d-%d", pages[i], pages[j])
		} else {
			fmt.Fprintf(&b, "%d", pages[i])
		}
		i = j + 1
	}
	return b.String()
}

// CleanOCRText normalises recognised text: line endings, control
// characters (Tesseract ends pages with a form feed), trailing spaces and
// lines that would read as page markers (a page must not be able to
// renumber the document).
func CleanOCRText(s string) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	s = strings.Map(func(r rune) rune {
		if r < 0x20 && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, s)
	lines := strings.Split(s, "\n")
	out := lines[:0]
	for _, l := range lines {
		if _, ok := ParsePageMarker(l); ok {
			continue
		}
		out = append(out, strings.TrimRight(l, " \t"))
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}
