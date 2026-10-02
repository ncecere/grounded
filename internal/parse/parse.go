// Package parse turns uploaded and fetched documents into Markdown for
// chunking (ADR-0008).
//
// Built-in Go parsers handle every v1 format (PDF, DOCX, PPTX, HTML,
// Markdown, plain text), so no external service is required. Apache Tika is
// optional: when TIKA_URL is set, the router falls back to it when a built-in
// parser fails (or prefers it for configured formats).
//
// Paginated formats mark page boundaries with PageMarker lines so the chunker
// can record page numbers for citations.
package parse

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// Kind is a supported document format.
type Kind string

const (
	KindPDF      Kind = "pdf"
	KindDOCX     Kind = "docx"
	KindPPTX     Kind = "pptx"
	KindHTML     Kind = "html"
	KindMarkdown Kind = "markdown"
	KindText     Kind = "text"
	// KindImage is a PNG, JPEG or TIFF upload: one page read with OCR
	// (docs/ocr.md §5a).
	KindImage Kind = "image"
)

// Kinds lists every supported kind.
var Kinds = []Kind{KindPDF, KindDOCX, KindPPTX, KindHTML, KindMarkdown, KindText, KindImage}

// MIMEType returns the canonical MIME type for a kind.
func (k Kind) MIMEType() string {
	switch k {
	case KindPDF:
		return "application/pdf"
	case KindDOCX:
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case KindPPTX:
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case KindHTML:
		return "text/html"
	case KindMarkdown:
		return "text/markdown"
	case KindImage:
		return "image/png"
	default:
		return "text/plain"
	}
}

// Input is one document to parse.
type Input struct {
	Name string // original filename or URL path, used for detection and titles
	Kind Kind
	Data []byte

	// WebPage marks HTML fetched from a website: only the main content is
	// kept (navigation, headers, footers and sidebars are dropped) and
	// relative links resolve against BaseURL (the page URL).
	WebPage bool
	BaseURL string

	// OCR reads pages without a text layer (PDF) and images; nil: OCR is
	// off, and parsing is as without OCR.
	OCR *OCROptions
}

// Document is parser output.
type Document struct {
	Title    string
	Markdown string   // with PageMarker lines for paginated formats
	Pages    int      // number of pages/slides; 0 when not paginated
	Parser   string   // e.g. "builtin:pdf", "builtin:pdf+ocr:tesseract" or "tika"
	Warnings []string // non-fatal problems, shown to users
	// OCR lists the pages read with OCR; nil when none were. It is also
	// set with ErrEmpty when OCR ran and found no text, so its usage counts.
	OCR *OCRInfo
	// NeedsOCR lists the pages without a text layer that were skipped
	// because OCR is off (1-based, ascending): a partly scanned PDF. Parsed
	// again with OCR on, those pages are read (docs/ocr.md §5).
	NeedsOCR []int
}

// Errors callers act on. Wrap them with context; test with errors.Is.
var (
	ErrUnsupported = errors.New("unsupported document format")
	ErrNeedsOCR    = errors.New("document has no extractable text (it may be scanned) and OCR is off")
	ErrEncrypted   = errors.New("document is password-protected")
	ErrCorrupt     = errors.New("document is damaged or not the format its name suggests")
	ErrEmpty       = errors.New("document contains no text")
	ErrTooLarge    = errors.New("document is too large to process")
)

// Parser converts documents of some kinds.
type Parser interface {
	Name() string
	Supports(Kind) bool
	Parse(ctx context.Context, in Input) (Document, error)
}

// pageMarkerRE matches a page marker line. "ragd:page" is the legacy form,
// written before the product was renamed to Grounded: parsed text stored by
// older versions still contains it (boilerplate re-chunking reads that stored
// text), so both forms are read. Only "grounded:page" is written.
var pageMarkerRE = regexp.MustCompile(`^<!-- (?:grounded|ragd):page (\d+) -->$`)

// PageMarker is the line that starts page n (1-based).
func PageMarker(n int) string { return "<!-- grounded:page " + strconv.Itoa(n) + " -->" }

// MayContainPageMarker is a cheap check for text that might hold a page
// marker, current or legacy; ParsePageMarker decides.
func MayContainPageMarker(s string) bool {
	return strings.Contains(s, "grounded:page") || strings.Contains(s, "ragd:page")
}

// ParsePageMarker reports whether line is a page marker and its page number.
func ParsePageMarker(line string) (int, bool) {
	m := pageMarkerRE.FindStringSubmatch(strings.TrimSpace(line))
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	return n, err == nil
}

// Limits bound resource use for hostile or enormous files.
type Limits struct {
	MaxPages         int   // pages/slides processed (default 5000)
	MaxMarkdownBytes int   // output size (default 32 MiB)
	MaxUnzippedBytes int64 // total decompressed OOXML size (default 512 MiB)
	MaxZipEntries    int   // OOXML entries (default 20000)
}

func (l Limits) withDefaults() Limits {
	if l.MaxPages == 0 {
		l.MaxPages = 5000
	}
	if l.MaxMarkdownBytes == 0 {
		l.MaxMarkdownBytes = 32 << 20
	}
	if l.MaxUnzippedBytes == 0 {
		l.MaxUnzippedBytes = 512 << 20
	}
	if l.MaxZipEntries == 0 {
		l.MaxZipEntries = 20000
	}
	return l
}

// Detect determines a document's kind from its name and content. Content
// wins over a misleading extension; unknown or binary content is rejected.
func Detect(name string, data []byte) (Kind, error) {
	ext := strings.ToLower(path.Ext(name))
	head := data
	if len(head) > 1024 {
		head = head[:1024]
	}
	switch {
	case bytes.Contains(head, []byte("%PDF-")):
		return KindPDF, nil
	case bytes.HasPrefix(data, []byte("PK\x03\x04")):
		return detectOOXML(data)
	case IsImage(head):
		return KindImage, nil
	}
	if bytes.IndexByte(head, 0) >= 0 && !hasUTF16BOM(data) {
		return "", fmt.Errorf("%w: binary content", ErrUnsupported)
	}
	switch ext {
	case ".html", ".htm", ".xhtml":
		return KindHTML, nil
	case ".md", ".markdown", ".mdown":
		return KindMarkdown, nil
	case ".txt", ".text", "":
	case ".pdf", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".tif", ".tiff":
		return "", fmt.Errorf("%w: the file is named %s but its content does not match", ErrCorrupt, ext)
	default:
		if ct := http.DetectContentType(head); !strings.HasPrefix(ct, "text/") {
			return "", fmt.Errorf("%w: %s files are not supported", ErrUnsupported, ext)
		}
	}
	if strings.HasPrefix(http.DetectContentType(head), "text/html") {
		return KindHTML, nil
	}
	return KindText, nil
}

func hasUTF16BOM(b []byte) bool {
	return bytes.HasPrefix(b, []byte{0xFF, 0xFE}) || bytes.HasPrefix(b, []byte{0xFE, 0xFF})
}

func detectOOXML(data []byte) (Kind, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("%w: unreadable zip archive", ErrCorrupt)
	}
	for _, f := range zr.File {
		switch f.Name {
		case "word/document.xml":
			return KindDOCX, nil
		case "ppt/presentation.xml":
			return KindPPTX, nil
		}
	}
	return "", fmt.Errorf("%w: zip archives other than .docx and .pptx are not supported", ErrUnsupported)
}

// Router picks a parser per document: built-in first, then Tika (if
// configured) as a fallback. Kinds in PreferTika try Tika first.
type Router struct {
	Builtin    Parser
	Tika       Parser // nil when TIKA_URL is unset
	PreferTika map[Kind]bool
	Log        *slog.Logger
}

// Parse runs the best available parser and falls back on failure.
// Password-protected documents are never retried.
func (r *Router) Parse(ctx context.Context, in Input) (Document, error) {
	order := []Parser{r.Builtin}
	if r.Tika != nil {
		if r.PreferTika[in.Kind] {
			order = []Parser{r.Tika, r.Builtin}
		} else {
			order = append(order, r.Tika)
		}
	}
	var firstErr error
	for _, p := range order {
		if p == nil || !p.Supports(in.Kind) {
			continue
		}
		doc, err := p.Parse(ctx, in)
		if err == nil && strings.TrimSpace(stripMarkers(doc.Markdown)) == "" {
			err = ErrEmpty
			if doc.OCR != nil {
				// OCR read the pages and found nothing: no fallback, and
				// the pages it read still count.
				return Document{Pages: doc.Pages, OCR: doc.OCR, Warnings: doc.Warnings}, err
			}
			if in.Kind == KindPDF && doc.Pages > 0 {
				err = ErrNeedsOCR
			}
		}
		if err == nil {
			return doc, nil
		}
		if ctx.Err() != nil {
			return Document{}, ctx.Err()
		}
		if firstErr == nil {
			firstErr = err
		}
		// No fallback for a document that can't be read, or whose OCR must
		// wait or be retried (another parser would skip the scanned pages).
		if errors.Is(err, ErrEncrypted) || errors.Is(err, ErrTooLarge) || errors.Is(err, ErrOCRLimit) || fatalOCRError(ctx, err) {
			break
		}
		if r.Log != nil {
			r.Log.InfoContext(ctx, "parser failed; trying fallback", "parser", p.Name(), "kind", in.Kind, "err", err)
		}
	}
	if firstErr == nil {
		firstErr = fmt.Errorf("%w: no parser for %s", ErrUnsupported, in.Kind)
	}
	return Document{}, firstErr
}

// stripMarkers removes page marker lines.
func stripMarkers(md string) string {
	if !MayContainPageMarker(md) {
		return md
	}
	var b strings.Builder
	for _, line := range strings.Split(md, "\n") {
		if _, ok := ParsePageMarker(line); !ok {
			b.WriteString(line)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

// cleanMarkdown collapses runs of blank lines and trims the result.
func cleanMarkdown(md string) string {
	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines))
	blank := 0
	for _, l := range lines {
		l = strings.TrimRight(l, " \t")
		if l == "" {
			blank++
			if blank > 1 {
				continue
			}
		} else {
			blank = 0
		}
		out = append(out, l)
	}
	s := strings.TrimSpace(strings.Join(out, "\n"))
	if s == "" {
		return ""
	}
	return s + "\n"
}
