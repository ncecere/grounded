package parse

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

var (
	sharedOnce sync.Once
	shared     *Builtin
)

// builtin shares one PDF engine across tests; starting PDFium is not free.
func builtin() *Builtin {
	sharedOnce.Do(func() { shared = NewBuiltin(Limits{}, 2) })
	return shared
}

func mustParse(t *testing.T, name string, data []byte) Document {
	t.Helper()
	kind, err := Detect(name, data)
	if err != nil {
		t.Fatalf("detect %s: %v", name, err)
	}
	doc, err := builtin().Parse(context.Background(), Input{Name: name, Kind: kind, Data: data})
	if err != nil {
		t.Fatalf("parse %s: %v", name, err)
	}
	return doc
}

func contains(t *testing.T, md string, want ...string) {
	t.Helper()
	for _, w := range want {
		if !strings.Contains(md, w) {
			t.Errorf("missing %q in:\n%s", w, md)
		}
	}
}

func absent(t *testing.T, md string, unwanted ...string) {
	t.Helper()
	for _, w := range unwanted {
		if strings.Contains(md, w) {
			t.Errorf("unexpected %q in:\n%s", w, md)
		}
	}
}

func TestDetect(t *testing.T) {
	docx := docxFile(t, wPara("", "x"), "")
	cases := []struct {
		name string
		data []byte
		want Kind
		err  error
	}{
		{"a.pdf", []byte("%PDF-1.7 ..."), KindPDF, nil},
		{"wrong-name.txt", []byte("%PDF-1.4 ..."), KindPDF, nil},
		{"a.docx", docx, KindDOCX, nil},
		{"a.bin", docx, KindDOCX, nil},
		{"a.pptx", pptxFile(t, []slide{{title: "x"}}), KindPPTX, nil},
		{"a.zip", zipFiles(t, map[string]string{"x.txt": "hi"}), "", ErrUnsupported},
		{"page.html", []byte("<p>hi</p>"), KindHTML, nil},
		{"notes.md", []byte("# Hi"), KindMarkdown, nil},
		{"notes.txt", []byte("hello"), KindText, nil},
		{"README", []byte("hello"), KindText, nil},
		{"saved", []byte("<!DOCTYPE html><html><body>x</body></html>"), KindHTML, nil},
		{"image.png", []byte("\x89PNG\r\n\x1a\n\x00\x00"), KindImage, nil},
		{"photo", []byte("\xFF\xD8\xFF\xE0\x00"), KindImage, nil},
		{"scan.tif", []byte("II*\x00\x08\x00"), KindImage, nil},
		{"a.gif", []byte("GIF89a\x00\x00"), "", ErrUnsupported},
		{"fake.pdf", []byte("just text"), "", ErrCorrupt},
		{"sheet.xlsx", zipFiles(t, map[string]string{"xl/workbook.xml": "<x/>"}), "", ErrUnsupported},
	}
	for _, tc := range cases {
		got, err := Detect(tc.name, tc.data)
		if tc.err != nil {
			if !errors.Is(err, tc.err) {
				t.Errorf("%s: err = %v, want %v", tc.name, err, tc.err)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Errorf("%s: got %q %v, want %q", tc.name, got, err, tc.want)
		}
	}
}

func TestTextAndMarkdown(t *testing.T) {
	doc := mustParse(t, "Fall_2026-notes.txt", []byte("caf\xe9 \x96 menu\r\n\r\n\r\n\r\nsecond"))
	if doc.Title != "Fall 2026 notes" {
		t.Errorf("title = %q", doc.Title)
	}
	contains(t, doc.Markdown, "café – menu\n\nsecond")
	utf16 := []byte{0xFF, 0xFE, 'h', 0, 'i', 0}
	if d := mustParse(t, "u.txt", utf16); strings.TrimSpace(d.Markdown) != "hi" {
		t.Errorf("utf16 = %q", d.Markdown)
	}
	md := mustParse(t, "guide.md", []byte("\xef\xbb\xbf# Admissions\n\nText"))
	if md.Title != "Admissions" || !strings.HasPrefix(md.Markdown, "# Admissions") {
		t.Errorf("markdown = %+v", md)
	}
}

func TestDOCX(t *testing.T) {
	body := wPara("Title", "Student Handbook") +
		wPara("Heading1", "Registration") +
		wPara("", "Register before the deadline.") +
		wPara("PolicyHeading", "Late registration") +
		wListItem(0, "Pay the late fee") +
		wListItem(1, "Fee is $100") +
		`<w:p><w:r><w:t>Kept </w:t></w:r><w:del><w:r><w:delText>deleted words</w:delText></w:r></w:del><w:r><w:t>text</w:t></w:r></w:p>` +
		`<w:tbl><w:tr><w:tc>` + wPara("", "Term") + `</w:tc><w:tc>` + wPara("", "Deadline") + `</w:tc></w:tr>` +
		`<w:tr><w:tc>` + wPara("", "Fall | 2026") + `</w:tc><w:tc>` + wPara("", "Aug 20") + `</w:tc></w:tr></w:tbl>`
	doc := mustParse(t, "handbook.docx", docxFile(t, body, "Example University Student Handbook"))
	if doc.Title != "Example University Student Handbook" || doc.Parser != "builtin:docx" {
		t.Errorf("doc = %+v", doc)
	}
	contains(t, doc.Markdown,
		"# Student Handbook", "# Registration", "Register before the deadline.",
		"## Late registration", // custom style based on Heading 2
		"- Pay the late fee\n  - Fee is $100",
		"Kept text",
		"| Term | Deadline |\n| --- | --- |\n| Fall \\| 2026 | Aug 20 |")
	absent(t, doc.Markdown, "deleted words")
}

func TestDOCXDecompressionLimit(t *testing.T) {
	big := wPara("", strings.Repeat("A", 200_000))
	data := docxFile(t, big, "")
	_, err := parseDOCX(Input{Name: "big.docx", Data: data}, Limits{MaxUnzippedBytes: 50_000}.withDefaults())
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}
}

func TestPPTX(t *testing.T) {
	data := pptxFile(t, []slide{
		{title: "Welcome", bullets: []string{"Orientation week", ">Bring your campus ID card"}, notes: "Greet students"},
		{title: "Deadlines", table: [][]string{{"Item", "Date"}, {"Drop/add", "Aug 28"}}},
	})
	doc := mustParse(t, "orientation.pptx", data)
	if doc.Pages != 2 {
		t.Fatalf("pages = %d", doc.Pages)
	}
	contains(t, doc.Markdown,
		PageMarker(1)+"\n\n## Slide 1: Welcome", "- Orientation week\n  - Bring your campus ID card", "**Notes:** Greet students",
		PageMarker(2)+"\n\n## Slide 2: Deadlines", "| Drop/add | Aug 28 |")
	absent(t, doc.Markdown, "99") // slide number placeholder
	if strings.Index(doc.Markdown, "Welcome") > strings.Index(doc.Markdown, "Deadlines") {
		t.Error("slides out of presentation order")
	}
}

func TestPDF(t *testing.T) {
	footer := func(n int) pdfText { return pdfText{9, 40, fmt.Sprintf("Page %d of 3", n)} }
	header := pdfText{9, 760, "Example University"}
	data := pdfFile(t, "", [][]pdfText{
		{header, {24, 700, "Admissions Guide"}, {11, 670, "Applicants must submit transcripts and test"}, {11, 656, "scores before the priority deadline."},
			{16, 620, "Deadlines"}, {11, 596, "• Fall term: November 1"}, {11, 582, "• Spring term: July 1"}, footer(1)},
		{header, {16, 700, "Financial aid"}, {11, 676, "Complete the FAFSA to be con-"}, {11, 662, "sidered for grants. A well-"}, {11, 648, "known deadline applies."}, footer(2)},
		{header, {11, 700, "Contact the admissions office with questions."}, footer(3)},
	})
	doc := mustParse(t, "admissions.pdf", data)
	if doc.Pages != 3 || doc.Parser != "builtin:pdf" {
		t.Fatalf("doc = %+v", doc)
	}
	if doc.Title != "Admissions Guide" {
		t.Errorf("title = %q", doc.Title)
	}
	contains(t, doc.Markdown,
		PageMarker(1), "# Admissions Guide",
		"Applicants must submit transcripts and test scores before the priority deadline.",
		"## Deadlines", "- Fall term: November 1", "- Spring term: July 1",
		// PDFium reports every line-end hyphen as a break hyphen, so a real
		// hyphenated compound split across lines is joined too ("wellknown").
		// Joining is the better default for search ("considered", not "con-sidered").
		PageMarker(2), "## Financial aid", "Complete the FAFSA to be considered for grants. A wellknown deadline applies.",
		PageMarker(3), "Contact the admissions office with questions.")
	absent(t, doc.Markdown, "Example University", "Page 1 of 3", "Page 3 of 3")
	if strings.Index(doc.Markdown, PageMarker(2)) > strings.Index(doc.Markdown, "Financial aid") {
		t.Error("page marker after its content")
	}
}

func TestPDFIndentedParagraphs(t *testing.T) {
	// Paragraphs marked only by a first-line indent, with no vertical gap.
	data := pdfFileAt(t, [][]pdfTextAt{{
		{11, 72, 700, "The first paragraph starts here and"}, {11, 72, 687, "continues on this line."},
		{11, 90, 674, "A second paragraph is indented and"}, {11, 72, 661, "wraps back to the margin."},
		{11, 72, 648, "Still the second paragraph."},
	}})
	doc := mustParse(t, "paper.pdf", data)
	contains(t, doc.Markdown,
		"The first paragraph starts here and continues on this line.\n\nA second paragraph is indented and wraps back to the margin. Still the second paragraph.")
	if looksLikeFilename("Principles of Regulatory Policy Design") || !looksLikeFilename("regchapfinal.dvi") {
		t.Error("filename title detection wrong")
	}
}

func TestPDFMetadataTitleAndScannedPages(t *testing.T) {
	data := pdfFile(t, "Official Catalog 2026", [][]pdfText{{{11, 700, "Some text on page one."}}, {}})
	doc := mustParse(t, "catalog.pdf", data)
	if doc.Title != "Official Catalog 2026" {
		t.Errorf("title = %q", doc.Title)
	}
	if len(doc.Warnings) != 1 || !strings.Contains(doc.Warnings[0], "1 of 2 pages had no text layer (possibly scanned) and was skipped") {
		t.Errorf("warnings = %v", doc.Warnings)
	}
}

func TestPDFErrors(t *testing.T) {
	r := &Router{Builtin: builtin()}
	scanned := pdfFile(t, "", [][]pdfText{{}, {}})
	if _, err := r.Parse(context.Background(), Input{Name: "scan.pdf", Kind: KindPDF, Data: scanned}); !errors.Is(err, ErrNeedsOCR) {
		t.Errorf("scanned: %v", err)
	}
	if _, err := r.Parse(context.Background(), Input{Name: "bad.pdf", Kind: KindPDF, Data: []byte("%PDF-1.4\ngarbage")}); !errors.Is(err, ErrCorrupt) {
		t.Errorf("corrupt: %v", err)
	}
}

type fakeParser struct {
	name  string
	doc   Document
	err   error
	calls int
}

func (f *fakeParser) Name() string       { return f.name }
func (f *fakeParser) Supports(Kind) bool { return true }
func (f *fakeParser) Parse(context.Context, Input) (Document, error) {
	f.calls++
	return f.doc, f.err
}

func TestRouterFallback(t *testing.T) {
	ok := Document{Markdown: "hello\n", Parser: "tika"}
	cases := []struct {
		name       string
		builtinErr error
		prefer     bool
		wantParser string
		wantErr    error
		tikaCalls  int
	}{
		{"builtin succeeds", nil, false, "builtin", nil, 0},
		{"falls back on corrupt", ErrCorrupt, false, "tika", nil, 1},
		{"falls back on needs OCR", ErrNeedsOCR, false, "tika", nil, 1},
		{"never retries encrypted", ErrEncrypted, false, "", ErrEncrypted, 0},
		{"prefers tika", nil, true, "tika", nil, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b := &fakeParser{name: "builtin", doc: Document{Markdown: "b\n", Parser: "builtin"}, err: tc.builtinErr}
			tk := &fakeParser{name: "tika", doc: ok}
			r := &Router{Builtin: b, Tika: tk, PreferTika: map[Kind]bool{KindPDF: tc.prefer}}
			doc, err := r.Parse(context.Background(), Input{Kind: KindPDF})
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v", err)
				}
			} else if err != nil || doc.Parser != tc.wantParser {
				t.Fatalf("got %+v %v", doc, err)
			}
			if tk.calls != tc.tikaCalls {
				t.Errorf("tika calls = %d, want %d", tk.calls, tc.tikaCalls)
			}
		})
	}
	// Without Tika, the built-in error is returned.
	r := &Router{Builtin: &fakeParser{err: ErrCorrupt}}
	if _, err := r.Parse(context.Background(), Input{Kind: KindPDF}); !errors.Is(err, ErrCorrupt) {
		t.Errorf("no tika: %v", err)
	}
}

func TestTikaClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/version":
			_, _ = w.Write([]byte("Apache Tika 3.2.0"))
		case r.Method == http.MethodPut && r.URL.Path == "/tika/html":
			_, _ = w.Write([]byte(`<html><head><title>Scanned Memo</title></head><body>` +
				`<div class="page"><h1>Memo</h1><p>First page text.</p></div>` +
				`<div class="page"><p>Second page text.</p></div></body></html>`))
		default:
			http.Error(w, "bad", http.StatusBadRequest)
		}
	}))
	defer srv.Close()
	tk := NewTika(srv.URL, 5*time.Second, Limits{})
	if err := tk.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	doc, err := tk.Parse(context.Background(), Input{Name: "memo.pdf", Kind: KindPDF, Data: []byte("%PDF-")})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Title != "Scanned Memo" || doc.Pages != 2 {
		t.Errorf("doc = %+v", doc)
	}
	contains(t, doc.Markdown, PageMarker(1), "# Memo", "First page text.", PageMarker(2), "Second page text.")
}

func TestPageMarkers(t *testing.T) {
	if n, ok := ParsePageMarker("  " + PageMarker(12) + " "); !ok || n != 12 {
		t.Errorf("parse = %d %v", n, ok)
	}
	if _, ok := ParsePageMarker("<!-- other -->"); ok {
		t.Error("non-marker parsed")
	}
	if PageMarker(3) != "<!-- grounded:page 3 -->" {
		t.Errorf("PageMarker(3) = %q", PageMarker(3))
	}
	// Legacy markers from parsed text stored before the rename are still read.
	if n, ok := ParsePageMarker("<!-- ragd:page 7 -->"); !ok || n != 7 {
		t.Errorf("legacy parse = %d %v", n, ok)
	}
	if _, ok := ParsePageMarker("<!-- other:page 7 -->"); ok {
		t.Error("foreign marker parsed")
	}
	if got := stripMarkers("<!-- ragd:page 1 -->\na\n" + PageMarker(2) + "\nb"); got != "a\nb\n" {
		t.Errorf("stripMarkers = %q", got)
	}
}

// Web pages keep only their main content; uploaded HTML keeps everything.
func TestHTMLWebPageMainContent(t *testing.T) {
	page := []byte(`<!DOCTYPE html><html><head><title>Registrar | Deadlines</title></head><body>
<header><nav><a href="/">Home</a> <a href="/menu-item-one">Menu item one</a> <a href="/menu-item-two">Menu item two</a></nav></header>
<main><article><h1>Drop deadlines</h1>
<p>Students may drop a course without a W grade until the end of drop/add. After that, a W appears on the transcript.
See the <a href="/calendar">academic calendar</a> for exact dates each term, and contact your advisor before dropping below full time.</p>
<p>Withdrawal from all courses requires a separate process through the Dean of Students office, which reviews each request.</p>
</article></main>
<footer>Copyright University Footer Text</footer></body></html>`)
	web, err := builtin().Parse(context.Background(), Input{Name: "https://example.edu/deadlines", Kind: KindHTML, Data: page, WebPage: true, BaseURL: "https://example.edu/deadlines"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(web.Markdown, "Menu item one") || strings.Contains(web.Markdown, "University Footer") {
		t.Errorf("navigation/footer kept:\n%s", web.Markdown)
	}
	if !strings.Contains(web.Markdown, "Drop deadlines") || !strings.Contains(web.Markdown, "https://example.edu/calendar") {
		t.Errorf("main content or absolute link missing:\n%s", web.Markdown)
	}
	if web.Title != "Registrar | Deadlines" {
		t.Errorf("title = %q", web.Title)
	}
	upload, err := builtin().Parse(context.Background(), Input{Name: "saved.html", Kind: KindHTML, Data: page})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(upload.Markdown, "Menu item one") {
		t.Errorf("uploaded HTML lost content:\n%s", upload.Markdown)
	}
}
