package parse

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/klippa-app/go-pdfium"
	pdfiumerrors "github.com/klippa-app/go-pdfium/errors"
	"github.com/klippa-app/go-pdfium/references"
	"github.com/klippa-app/go-pdfium/requests"
	"github.com/klippa-app/go-pdfium/webassembly"
	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/experimental"
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

// pdfCompiled keeps PDFium's compiled machine code for the process. Compiling
// the module takes seconds of CPU; with the cache every engine after the
// first starts from the compiled code (one engine in production, one per
// test application in the tests). pdfInit lets one engine start at a time, so
// engines starting together wait for the first one's compilation instead of
// each compiling.
var (
	pdfCompiled = wazero.NewCompilationCache()
	pdfInit     sync.Mutex
)

func (e *pdfEngine) instance() (pdfium.Pdfium, error) {
	e.once.Do(func() {
		n := max(e.workers, 1)
		pdfInit.Lock()
		defer pdfInit.Unlock()
		e.pool, e.err = webassembly.Init(webassembly.Config{MinIdle: 1, MaxIdle: n, MaxTotal: n,
			// go-pdfium's own default (its module needs the exception handling
			// feature), plus the shared cache.
			RuntimeConfig: wazero.NewRuntimeConfig().
				WithCoreFeatures(api.CoreFeaturesV2 | experimental.CoreFeaturesExceptionHandling).
				WithCompilationCache(pdfCompiled)})
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

	lines, empty, unread, err := readPages(ctx, inst, opened.Document, pages)
	if err != nil {
		return Document{}, err
	}
	warnings = append(warnings, unread...)
	// Pages without a text layer are read with OCR when it is on
	// (docs/ocr.md); pages with text never are.
	var ocrTexts map[int]string
	var info *OCRInfo
	if in.OCR != nil && len(empty) > 0 {
		var more []string
		if ocrTexts, info, more, err = ocrPDF(ctx, inst, opened.Document, in.OCR, empty); err != nil {
			return Document{}, err
		}
		warnings = append(warnings, more...)
	}
	if len(lines) == 0 && len(ocrTexts) == 0 && pages > 0 {
		if info != nil {
			return Document{Pages: pages, Parser: parserName("builtin:pdf", info), OCR: info, Warnings: warnings}, nil // Router: empty
		}
		return Document{Pages: pages}, ErrNeedsOCR
	}
	var needsOCR []int
	if in.OCR == nil && len(empty) > 0 {
		needsOCR = empty
		warnings = append(warnings, scannedPagesWarning(empty, pages))
	}

	md := renderPDF(removeRunningHeaders(lines, pages), pages, ocrTexts)
	if len(md) > lim.MaxMarkdownBytes {
		return Document{}, fmt.Errorf("%w: converted text exceeds the limit", ErrTooLarge)
	}
	title := pdfTitle(inst, opened.Document, md, in.Name)
	return Document{Title: title, Markdown: md, Pages: pages, Parser: parserName("builtin:pdf", info), Warnings: warnings, OCR: info, NeedsOCR: needsOCR}, nil
}

// scannedPagesWarning says which pages had no text layer and were skipped
// because OCR is off for the document, and how to read them: the document
// needs OCR (Document.NeedsOCR), so once OCR is on it is retried with the
// others that need it, or on its own.
func scannedPagesWarning(empty []int, pages int) string {
	if len(empty) == 1 {
		return fmt.Sprintf("1 of %d pages (page %d) had no text layer (possibly scanned) and was skipped, because OCR is off for this document. "+
			"Once OCR is on, retry the document to read it.", pages, empty[0])
	}
	return fmt.Sprintf("%d of %d pages (pages %s) had no text layer (possibly scanned) and were skipped, because OCR is off for this document. "+
		"Once OCR is on, retry the document to read them.", len(empty), pages, PageList(empty))
}

// pdfTitle is the document's Title metadata, unless it is missing or looks
// like a file name: then the first heading, or the file name.
func pdfTitle(inst pdfium.Pdfium, doc references.FPDF_DOCUMENT, md, name string) string {
	title := ""
	if meta, err := inst.FPDF_GetMetaText(&requests.FPDF_GetMetaText{Document: doc, Tag: "Title"}); err == nil {
		title = strings.TrimSpace(meta.Value)
	}
	if title != "" && !looksLikeFilename(title) {
		return title
	}
	if h := firstHeading(md); h != "" {
		return h
	}
	return titleFromName(name)
}

// readPages reads the text lines of the first pages, and lists the pages
// without text (1-based; unreadable ones too, with a warning).
func readPages(ctx context.Context, inst pdfium.Pdfium, doc references.FPDF_DOCUMENT, pages int) ([]pdfLine, []int, []string, error) {
	var lines []pdfLine
	var empty []int
	var warnings []string
	for i := 0; i < pages; i++ {
		if err := ctx.Err(); err != nil {
			return nil, nil, nil, err
		}
		st, err := inst.GetPageTextStructured(&requests.GetPageTextStructured{
			Page:                   requests.Page{ByIndex: &requests.PageByIndex{Document: doc, Index: i}},
			Mode:                   requests.GetPageTextStructuredModeRects,
			CollectFontInformation: true,
		})
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("page %d could not be read", i+1))
			empty = append(empty, i+1)
			continue
		}
		pageLines := linesFromRects(i+1, st.Rects)
		if len(pageLines) == 0 {
			empty = append(empty, i+1)
		}
		lines = append(lines, pageLines...)
	}
	return lines, empty, warnings, nil
}

var fileNameRE = regexp.MustCompile(`(?i)\.[a-z0-9]{2,5}$`)

// looksLikeFilename catches producer-supplied titles such as
// "regchapfinal.dvi" or "Microsoft Word - draft".
func looksLikeFilename(s string) bool {
	l := strings.ToLower(s)
	return fileNameRE.MatchString(l) && !strings.Contains(l, " ") || strings.HasPrefix(l, "microsoft word")
}
