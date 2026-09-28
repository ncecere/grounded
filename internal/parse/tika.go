package parse

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/htmlmd"
)

// Tika is an optional parser backed by an Apache Tika server (TIKA_URL). It
// asks Tika for XHTML, marks <div class="page"> boundaries as pages and
// converts the result to Markdown. If Tika runs with OCR (the -full image),
// it can also handle scanned PDFs that the built-in parser cannot.
type Tika struct {
	BaseURL string
	HTTP    *http.Client
	Limits  Limits
}

func NewTika(baseURL string, timeout time.Duration, lim Limits) *Tika {
	return &Tika{BaseURL: strings.TrimRight(baseURL, "/"), HTTP: &http.Client{Timeout: timeout}, Limits: lim.withDefaults()}
}

func (t *Tika) Name() string { return "tika" }

// Supports: images are read with OCR under Grounded's own page limits
// (Recognize), never parsed by the fallback.
func (t *Tika) Supports(k Kind) bool { return k != KindMarkdown && k != KindText && k != KindImage }

// Ping checks that the Tika server answers (GET /version).
func (t *Tika) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.BaseURL+"/version", nil)
	if err != nil {
		return err
	}
	res, err := t.HTTP.Do(req)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("tika returned HTTP %d", res.StatusCode)
	}
	return nil
}

var tikaPageRE = regexp.MustCompile(`<div class="page">`)

func (t *Tika) Parse(ctx context.Context, in Input) (Document, error) {
	// /tika/html returns XHTML on Tika 2.x through 4.x (Tika 4 rejects
	// content negotiation on plain /tika).
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, t.BaseURL+"/tika/html", bytes.NewReader(in.Data))
	if err != nil {
		return Document{}, err
	}
	req.Header.Set("Content-Type", in.Kind.MIMEType())
	res, err := t.HTTP.Do(req)
	if err != nil {
		return Document{}, fmt.Errorf("tika unavailable: %w", err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, int64(t.Limits.MaxMarkdownBytes)*4+1))
	if err != nil {
		return Document{}, fmt.Errorf("tika response: %w", err)
	}
	switch {
	case res.StatusCode == http.StatusUnprocessableEntity && bytes.Contains(bytes.ToLower(body), []byte("encrypt")):
		return Document{}, ErrEncrypted
	case res.StatusCode == http.StatusUnprocessableEntity || res.StatusCode == http.StatusUnsupportedMediaType:
		return Document{}, fmt.Errorf("%w: tika could not parse the document (HTTP %d)", ErrCorrupt, res.StatusCode)
	case res.StatusCode != http.StatusOK:
		return Document{}, fmt.Errorf("tika returned HTTP %d", res.StatusCode)
	}
	if int64(len(body)) > int64(t.Limits.MaxMarkdownBytes)*4 {
		return Document{}, fmt.Errorf("%w: tika output exceeds the limit", ErrTooLarge)
	}
	pages := 0
	marked := tikaPageRE.ReplaceAllFunc(body, func(m []byte) []byte {
		pages++
		return []byte(`<div class="page"><!-- grounded:page ` + strconv.Itoa(pages) + ` -->`)
	})
	out, err := htmlmd.Convert(marked, htmlmd.Options{MaxInputBytes: t.Limits.MaxMarkdownBytes * 4})
	if err != nil {
		return Document{}, fmt.Errorf("%w: %v", ErrTooLarge, err)
	}
	md := cleanMarkdown(out.Markdown)
	title := out.Title
	if title == "" {
		title = firstHeading(md)
	}
	if title == "" {
		title = titleFromName(in.Name)
	}
	return Document{Title: title, Markdown: md, Pages: pages, Parser: "tika"}, nil
}

// Recognize reads one page image with Tika's Tesseract OCR (docs/ocr.md §2;
// the apache/tika "-full" image has Tesseract). It makes Tika an OCR
// backend. Tika without Tesseract returns no text.
func (t *Tika) Recognize(ctx context.Context, img []byte, langs string) (OCRResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, t.BaseURL+"/tika", bytes.NewReader(img))
	if err != nil {
		return OCRResult{}, err
	}
	req.Header.Set("Content-Type", "image/png")
	req.Header.Set("Accept", "text/plain")
	if langs != "" {
		req.Header.Set("X-Tika-OCRLanguage", langs)
	}
	res, err := t.HTTP.Do(req)
	if err != nil {
		return OCRResult{}, fmt.Errorf("%w: tika: %v", ErrOCRUnavailable, err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, int64(t.Limits.MaxMarkdownBytes)))
	if err != nil {
		return OCRResult{}, fmt.Errorf("%w: tika response: %v", ErrOCRUnavailable, err)
	}
	switch {
	case res.StatusCode >= 500 || res.StatusCode == http.StatusTooManyRequests:
		return OCRResult{}, fmt.Errorf("%w: tika returned HTTP %d", ErrOCRUnavailable, res.StatusCode)
	case res.StatusCode != http.StatusOK:
		return OCRResult{}, fmt.Errorf("tika could not read the image (HTTP %d)", res.StatusCode)
	}
	return OCRResult{Text: string(body)}, nil
}
