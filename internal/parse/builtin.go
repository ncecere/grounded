package parse

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/ncecere/grounded/internal/htmlmd"
)

// Builtin parses every supported kind in-process.
type Builtin struct {
	Limits Limits
	pdf    *pdfEngine
}

// NewBuiltin returns the built-in parser. pdfWorkers bounds concurrent PDF
// parses (each PDFium WebAssembly instance uses tens of MB of memory).
func NewBuiltin(lim Limits, pdfWorkers int) *Builtin {
	return &Builtin{Limits: lim.withDefaults(), pdf: &pdfEngine{workers: pdfWorkers}}
}

func (b *Builtin) Name() string { return "builtin" }

func (b *Builtin) Supports(k Kind) bool {
	for _, s := range Kinds {
		if s == k {
			return true
		}
	}
	return false
}

// Close releases the PDF engine.
func (b *Builtin) Close() error { return b.pdf.Close() }

func (b *Builtin) Parse(ctx context.Context, in Input) (Document, error) {
	switch in.Kind {
	case KindPDF:
		return b.pdf.parse(ctx, in, b.Limits)
	case KindDOCX:
		return parseDOCX(in, b.Limits)
	case KindPPTX:
		return parsePPTX(in, b.Limits)
	case KindHTML:
		return parseHTML(in, b.Limits)
	case KindMarkdown:
		return parseMarkdown(in)
	case KindText:
		return parseText(in)
	case KindImage:
		return parseImage(ctx, in, b.Limits)
	}
	return Document{}, fmt.Errorf("%w: %s", ErrUnsupported, in.Kind)
}

// parseHTML converts an HTML document. Uploaded files are documents the team
// chose, so the whole body is kept (no boilerplate pruning); web pages keep
// only their main content (Input.WebPage).
// HTMLParser names the built-in HTML parser's output. The "@2" version reads
// UTF-8 pages whose first non-ASCII text comes after 1,024 bytes correctly
// (they were garbled as windows-1252); web sources re-read pages stored by an
// older version on their next sync (StaleHTML).
const HTMLParser = "builtin:html@2"

// StaleHTML reports whether a document was parsed by an older version of the
// built-in HTML parser and should be parsed again.
func StaleHTML(parser string) bool {
	return (parser == "builtin:html" || strings.HasPrefix(parser, "builtin:html@")) && parser != HTMLParser
}

func parseHTML(in Input, lim Limits) (Document, error) {
	opts := htmlmd.Options{MaxInputBytes: lim.MaxMarkdownBytes, MainContentOnly: in.WebPage}
	if in.BaseURL != "" {
		if u, err := url.Parse(in.BaseURL); err == nil && (u.Scheme == "http" || u.Scheme == "https") {
			opts.BaseURL = u
		}
	}
	res, err := htmlmd.Convert([]byte(decodeText(in.Data)), opts)
	if err != nil {
		return Document{}, fmt.Errorf("%w: %v", ErrTooLarge, err)
	}
	md := cleanMarkdown(res.Markdown)
	title := res.Title
	if title == "" {
		title = firstHeading(md)
	}
	if title == "" {
		title = titleFromName(in.Name)
	}
	return Document{Title: title, Markdown: md, Parser: HTMLParser}, nil
}
