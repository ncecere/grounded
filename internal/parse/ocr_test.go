package parse

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeOCR "reads" a page image: it answers with the image's height, so a
// test knows which page's image was sent (pages have different heights).
type fakeOCR struct {
	mu      sync.Mutex
	heights []int
	langs   []string
	text    func(height int) string
	err     func(height int) error
}

func (f *fakeOCR) Recognize(_ context.Context, img []byte, langs string) (OCRResult, error) {
	h := approx(imageHeight(img))
	f.mu.Lock()
	f.heights = append(f.heights, h)
	f.langs = append(f.langs, langs)
	f.mu.Unlock()
	if f.err != nil {
		if err := f.err(h); err != nil {
			return OCRResult{}, err
		}
	}
	if f.text != nil {
		return OCRResult{Text: f.text(h), TokensIn: 10, TokensOut: 5}, nil
	}
	return OCRResult{Text: fmt.Sprintf("Scanned page %d pixels tall.\f", h), TokensIn: 10, TokensOut: 5}, nil
}

func (f *fakeOCR) calls() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := slices.Clone(f.heights)
	slices.Sort(out)
	return out
}

func ocrOn(engine OCR) *OCROptions {
	return &OCROptions{Engine: engine, Backend: "fake", Languages: "eng+spa", Concurrency: 2}
}

// pxAt300 is a page's rendered height at 300 DPI (to the nearest 10
// pixels: PDFium's rounding differs by one).
func pxAt300(points float64) int { return approx(int(points * 300 / 72)) }

func approx(px int) int { return (px + 5) / 10 * 10 }

// mixedPDF: text on pages 1 and 3, scans on pages 2 (792 pt) and 4 (720 pt).
func mixedPDF(t *testing.T) []byte {
	return scannedPDF(t, []scanPage{
		{text: []pdfTextAt{{11, 72, 700, "Typed page one."}}},
		{scan: "SCANNED PAGE TWO"},
		{text: []pdfTextAt{{11, 72, 700, "Typed page three."}}},
		{height: 720, scan: "SCANNED PAGE FOUR"},
	})
}

func TestOCROnlyPagesWithoutText(t *testing.T) {
	f := &fakeOCR{}
	doc, err := builtin().Parse(context.Background(), Input{Name: "mixed.pdf", Kind: KindPDF, Data: mixedPDF(t), OCR: ocrOn(f)})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := f.calls(), []int{pxAt300(720), pxAt300(792)}; !slices.Equal(got, want) {
		t.Fatalf("OCR calls (heights) = %v, want %v", got, want)
	}
	if f.langs[0] != "eng+spa" {
		t.Errorf("languages = %q", f.langs[0])
	}
	// Each page's text lands under its own marker, in order.
	md := doc.Markdown
	order := []string{PageMarker(1), "Typed page one.", PageMarker(2), fmt.Sprintf("Scanned page %d pixels tall.", pxAt300(792)),
		PageMarker(3), "Typed page three.", PageMarker(4), fmt.Sprintf("Scanned page %d pixels tall.", pxAt300(720))}
	pos := 0
	for _, w := range order {
		i := strings.Index(md[pos:], w)
		if i < 0 {
			t.Fatalf("%q missing or out of order in:\n%s", w, md)
		}
		pos += i + len(w)
	}
	absent(t, md, "\f")
	if doc.Parser != "builtin:pdf+ocr:fake" || doc.OCR == nil || !slices.Equal(doc.OCR.Pages, []int{2, 4}) {
		t.Errorf("parser %q, ocr %+v", doc.Parser, doc.OCR)
	}
	if doc.OCR.TokensIn != 20 || doc.OCR.TokensOut != 10 {
		t.Errorf("usage = %+v", doc.OCR)
	}
	if len(doc.Warnings) != 0 {
		t.Errorf("warnings = %v", doc.Warnings)
	}
}

func TestOCRFullyScanned(t *testing.T) {
	data := scannedPDF(t, []scanPage{{scan: "PAGE ONE"}, {height: 700, scan: "PAGE TWO"}})
	r := &Router{Builtin: builtin()}
	// OCR off: as before B4.
	if _, err := r.Parse(context.Background(), Input{Name: "scan.pdf", Kind: KindPDF, Data: data}); !errors.Is(err, ErrNeedsOCR) {
		t.Fatalf("OCR off: %v", err)
	}
	doc, err := r.Parse(context.Background(), Input{Name: "scan.pdf", Kind: KindPDF, Data: data, OCR: ocrOn(&fakeOCR{})})
	if err != nil {
		t.Fatal(err)
	}
	contains(t, doc.Markdown, PageMarker(1), PageMarker(2), fmt.Sprintf("%d pixels", pxAt300(700)))
	if doc.Pages != 2 || !slices.Equal(doc.OCR.Pages, []int{1, 2}) {
		t.Errorf("doc = %+v", doc)
	}
	// OCR found nothing: empty (not "needs OCR"), and the pages still count.
	blank := &fakeOCR{text: func(int) string { return " \n" }}
	doc, err = r.Parse(context.Background(), Input{Name: "scan.pdf", Kind: KindPDF, Data: data, OCR: ocrOn(blank)})
	if !errors.Is(err, ErrEmpty) || doc.OCR == nil || len(doc.OCR.Pages) != 2 {
		t.Errorf("blank: %v %+v", err, doc.OCR)
	}
}

func TestOCRCapsAndReservation(t *testing.T) {
	data := mixedPDF(t)
	parse := func(o *OCROptions) (Document, error) {
		return builtin().Parse(context.Background(), Input{Name: "mixed.pdf", Kind: KindPDF, Data: data, OCR: o})
	}
	// Per-document cap: the first page without text only.
	f := &fakeOCR{}
	o := ocrOn(f)
	o.MaxPages = 1
	doc, err := parse(o)
	if err != nil || !slices.Equal(doc.OCR.Pages, []int{2}) || len(f.calls()) != 1 {
		t.Fatalf("cap: %v %+v %v", err, doc.OCR, f.calls())
	}
	contains(t, strings.Join(doc.Warnings, "\n"), "1 pages without text were not read with OCR: at most 1 pages per document")

	// The reservation sees the capped count and may admit fewer.
	var asked int
	o = ocrOn(&fakeOCR{})
	o.Reserve = func(_ context.Context, n int) (int, error) { asked = n; return 1, nil }
	doc, err = parse(o)
	if err != nil || asked != 2 || !slices.Equal(doc.OCR.Pages, []int{2}) {
		t.Fatalf("reserve: %v asked %d %+v", err, asked, doc.OCR)
	}
	contains(t, strings.Join(doc.Warnings, "\n"), "more than the team's daily OCR page limit")

	// Blocked (0): nothing is read, the text pages remain.
	f = &fakeOCR{}
	o = ocrOn(f)
	o.Reserve = func(context.Context, int) (int, error) { return 0, nil }
	doc, err = parse(o)
	if err != nil || doc.OCR != nil || len(f.calls()) != 0 {
		t.Fatalf("blocked: %v %+v", err, doc.OCR)
	}
	contains(t, strings.Join(doc.Warnings, "\n"), "OCR is blocked for this team")

	// Waiting for tomorrow: parsing stops and nothing falls back to Tika.
	until := time.Date(2026, 9, 29, 0, 0, 0, 0, time.UTC)
	o = ocrOn(&fakeOCR{})
	o.Reserve = func(_ context.Context, n int) (int, error) { return 0, &OCRWait{Until: until, Pages: n} }
	tk := &fakeParser{name: "tika", doc: Document{Markdown: "tika\n"}}
	_, err = (&Router{Builtin: builtin(), Tika: tk}).Parse(context.Background(), Input{Name: "m.pdf", Kind: KindPDF, Data: data, OCR: o})
	var wait *OCRWait
	if !errors.As(err, &wait) || !errors.Is(err, ErrOCRLimit) || wait.Until != until || tk.calls != 0 {
		t.Fatalf("wait: %v, tika calls %d", err, tk.calls)
	}
}

func TestOCRErrors(t *testing.T) {
	data := mixedPDF(t)
	// One page failing is a warning; the rest of the document is indexed.
	bad := pxAt300(720)
	f := &fakeOCR{err: func(h int) error {
		if h == bad {
			return errors.New("unreadable")
		}
		return nil
	}}
	doc, err := builtin().Parse(context.Background(), Input{Name: "m.pdf", Kind: KindPDF, Data: data, OCR: ocrOn(f)})
	if err != nil || !slices.Equal(doc.OCR.Pages, []int{2}) {
		t.Fatalf("%v %+v", err, doc.OCR)
	}
	contains(t, strings.Join(doc.Warnings, "\n"), "OCR could not read page 4")

	// The backend being down fails the document (to be retried), without a
	// Tika fallback that would skip the scanned pages.
	down := &fakeOCR{err: func(int) error { return fmt.Errorf("%w: connection refused", ErrOCRUnavailable) }}
	tk := &fakeParser{name: "tika", doc: Document{Markdown: "tika\n"}}
	_, err = (&Router{Builtin: builtin(), Tika: tk}).Parse(context.Background(), Input{Name: "m.pdf", Kind: KindPDF, Data: data, OCR: ocrOn(down)})
	if !errors.Is(err, ErrOCRUnavailable) || tk.calls != 0 {
		t.Fatalf("down: %v, tika calls %d", err, tk.calls)
	}
}

func TestImageUploads(t *testing.T) {
	for _, format := range []string{"png", "jpeg", "tiff"} {
		t.Run(format, func(t *testing.T) {
			data := encodeImage(t, format, "RECEIPT 42")
			kind, err := Detect("receipt."+format, data)
			if err != nil || kind != KindImage {
				t.Fatalf("detect: %v %v", kind, err)
			}
			f := &fakeOCR{text: func(int) string { return "# Receipt\n\nTotal 42" }}
			doc, err := (&Router{Builtin: builtin()}).Parse(context.Background(), Input{Name: "receipt." + format, Kind: kind, Data: data, OCR: ocrOn(f)})
			if err != nil {
				t.Fatal(err)
			}
			contains(t, doc.Markdown, PageMarker(1), "Total 42")
			if doc.Title != "Receipt" || doc.Pages != 1 || doc.Parser != "builtin:image+ocr:fake" || !slices.Equal(doc.OCR.Pages, []int{1}) {
				t.Errorf("doc = %+v", doc)
			}
			if h := f.calls(); len(h) != 1 || h[0] != approx(textImage("RECEIPT 42").Bounds().Dy()) {
				t.Errorf("sent heights %v", h)
			}
		})
	}
	// OCR off: nothing to read (uploads are refused earlier; this is the
	// document uploaded before OCR was turned off).
	if _, err := builtin().Parse(context.Background(), Input{Name: "a.png", Kind: KindImage, Data: encodeImage(t, "png", "x")}); !errors.Is(err, ErrNeedsOCR) {
		t.Errorf("OCR off: %v", err)
	}
	// Only a multi-page TIFF's first page is read.
	doc, err := builtin().Parse(context.Background(), Input{Name: "a.tiff", Kind: KindImage, Data: twoPageTIFF(t), OCR: ocrOn(&fakeOCR{})})
	if err != nil {
		t.Fatal(err)
	}
	contains(t, strings.Join(doc.Warnings, "\n"), "only the first page of this multi-page TIFF was read")
	// A renamed text file is not an image.
	if _, err := Detect("notes.png", []byte("just text")); !errors.Is(err, ErrCorrupt) {
		t.Errorf("renamed: %v", err)
	}
	if _, err := builtin().Parse(context.Background(), Input{Name: "b.png", Kind: KindImage, Data: []byte("\x89PNG\r\n\x1a\nbroken"), OCR: ocrOn(&fakeOCR{})}); !errors.Is(err, ErrCorrupt) {
		t.Errorf("broken image: %v", err)
	}
}

func TestOCRHelpers(t *testing.T) {
	if got := PageList([]int{1, 3, 4, 5, 7, 9, 10}); got != "1, 3-5, 7, 9-10" {
		t.Errorf("PageList = %q", got)
	}
	if got := cleanOCRText("Line one  \r\n<!-- grounded:page 9 -->\nLine\x00 two\f"); got != "Line one\nLine two" {
		t.Errorf("clean = %q", got)
	}
	if ocrDPIFor(612, 792) != 300 || ocrDPIFor(2384, 3370) != 128 || ocrDPIFor(100000, 100000) != 72 {
		t.Errorf("dpi: %d %d %d", ocrDPIFor(612, 792), ocrDPIFor(2384, 3370), ocrDPIFor(100000, 100000))
	}
}

func TestTikaRecognize(t *testing.T) {
	var gotLang, gotType string
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotLang, gotType = r.Header.Get("X-Tika-OCRLanguage"), r.Header.Get("Content-Type")
		if r.Method != http.MethodPut || r.URL.Path != "/tika" || r.Header.Get("Accept") != "text/plain" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte("Scanned words\n"))
	}))
	defer srv.Close()
	tk := NewTika(srv.URL, 5*time.Second, Limits{})
	res, err := tk.Recognize(context.Background(), []byte("png"), "eng+deu")
	if err != nil || res.Text != "Scanned words\n" || gotLang != "eng+deu" || gotType != "image/png" {
		t.Fatalf("%+v %v %q %q", res, err, gotLang, gotType)
	}
	status = http.StatusServiceUnavailable
	if _, err := tk.Recognize(context.Background(), []byte("png"), "eng"); !errors.Is(err, ErrOCRUnavailable) {
		t.Errorf("503: %v", err)
	}
	if tk.Supports(KindImage) {
		t.Error("Tika must not parse images as a fallback")
	}
}
