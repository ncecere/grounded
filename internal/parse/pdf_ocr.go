// Rendering a PDF's pages without text for OCR (docs/ocr.md §1): PDFium
// renders each page to a greyscale PNG at 300 DPI, and the configured
// backend reads it. Pages are rendered one at a time as the backend takes
// them, so at most Concurrency page images are held in memory.

package parse

import (
	"context"
	"fmt"
	"image/png"

	"github.com/klippa-app/go-pdfium"
	"github.com/klippa-app/go-pdfium/references"
	"github.com/klippa-app/go-pdfium/requests"
)

// OCR rendering: 300 DPI is what Tesseract reads best; the longest side is
// capped so a poster-sized page can't take gigabytes (a letter page is 2550
// x 3300 pixels at 300 DPI).
const (
	ocrDPI       = 300
	ocrMinDPI    = 72
	ocrMaxPixels = 6000
)

// ocrDPIFor is the DPI that keeps a page of w x h points within
// ocrMaxPixels on its longest side.
func ocrDPIFor(w, h float64) int {
	side := max(w, h)
	if side <= 0 {
		return ocrDPI
	}
	dpi := int(float64(ocrMaxPixels) * 72 / side)
	return max(min(dpi, ocrDPI), ocrMinDPI)
}

// ocrPDF reads the pages (1-based) with OCR and returns their text by page,
// the OCR record and warnings. The PDFium instance renders; the engine
// reads.
func ocrPDF(ctx context.Context, inst pdfium.Pdfium, doc references.FPDF_DOCUMENT, o *OCROptions, pages []int) (map[int]string, *OCRInfo, []string, error) {
	pages, warnings, err := ocrPlan(ctx, o, pages)
	if err != nil || len(pages) == 0 {
		return nil, nil, warnings, err
	}
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
		img, err := renderPage(inst, doc, p-1)
		images <- pageImage{page: p, png: img, err: err}
	}
	close(images)
	<-done
	if ocrErr != nil {
		return nil, nil, nil, ocrErr
	}
	texts, info, more := collectOCR(o.Backend, pages, results)
	return texts, info, append(warnings, more...), nil
}

// renderPage renders one page (0-based) to a greyscale PNG.
func renderPage(inst pdfium.Pdfium, doc references.FPDF_DOCUMENT, index int) ([]byte, error) {
	page := requests.Page{ByIndex: &requests.PageByIndex{Document: doc, Index: index}}
	dpi := ocrDPI
	if size, err := inst.GetPageSize(&requests.GetPageSize{Page: page}); err == nil {
		dpi = ocrDPIFor(size.Width, size.Height)
	}
	res, err := inst.RenderToFile(&requests.RenderToFile{
		RenderPageInDPI: &requests.RenderPageInDPI{Page: page, DPI: dpi, ImageFormat: requests.RenderImageFormatGrayscale},
		OutputFormat:    requests.RenderToFileOutputFormatPNG,
		OutputTarget:    requests.RenderToFileOutputTargetBytes,
		// Faster than the default and still far smaller than raw pixels;
		// the image only travels to the OCR backend.
		PNGCompressionLevel: png.BestSpeed,
	})
	if err != nil {
		return nil, fmt.Errorf("render page %d: %w", index+1, err)
	}
	if res.ImageBytes == nil {
		return nil, fmt.Errorf("render page %d: no image", index+1)
	}
	return *res.ImageBytes, nil
}
