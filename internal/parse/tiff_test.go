package parse

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/testutil"
)

// Three pages of different heights (1, 2 and 3 lines of text), so the fake
// OCR's answers say which page it read.
var tiffTexts = []string{"PAGE ONE", "PAGE\nTWO", "PAGE\nTHREE\nEND"}

func tiffHeight(page int) int { return approx(textImage(tiffTexts[page-1]).Bounds().Dy()) }

func TestMultiPageTIFF(t *testing.T) {
	for _, big := range []bool{false, true} {
		t.Run(fmt.Sprintf("bigEndian=%v", big), func(t *testing.T) {
			data := testutil.MultiPageTIFF(t, big, tiffTexts...)
			if kind, err := Detect("scan.tiff", data); err != nil || kind != KindImage {
				t.Fatalf("detect: %v %v", kind, err)
			}
			f := &fakeOCR{}
			doc, err := (&Router{Builtin: builtin()}).Parse(context.Background(), Input{Name: "scan.tiff", Kind: KindImage, Data: data, OCR: ocrOn(f)})
			if err != nil {
				t.Fatal(err)
			}
			want := []int{tiffHeight(1), tiffHeight(2), tiffHeight(3)}
			if got := f.calls(); !slices.Equal(got, want) {
				t.Fatalf("OCR calls (heights) = %v, want %v", got, want)
			}
			// Each page's text under its own marker, in order.
			pos := 0
			for p := 1; p <= 3; p++ {
				for _, w := range []string{PageMarker(p), fmt.Sprintf("Scanned page %d pixels tall.", tiffHeight(p))} {
					i := strings.Index(doc.Markdown[pos:], w)
					if i < 0 {
						t.Fatalf("%q missing or out of order in:\n%s", w, doc.Markdown)
					}
					pos += i + len(w)
				}
			}
			if doc.Pages != 3 || doc.Parser != "builtin:image+ocr:fake" || doc.OCR == nil || !slices.Equal(doc.OCR.Pages, []int{1, 2, 3}) {
				t.Errorf("doc = %+v", doc)
			}
			if doc.OCR.TokensIn != 30 || len(doc.Warnings) != 0 || doc.Title != "scan" {
				t.Errorf("usage %+v, warnings %v, title %q", doc.OCR, doc.Warnings, doc.Title)
			}
			// The upload itself is never changed (Tika may read it next).
			if !slices.Equal(data, testutil.MultiPageTIFF(t, big, tiffTexts...)) {
				t.Error("the TIFF was modified")
			}
		})
	}
}

func TestMultiPageTIFFLimits(t *testing.T) {
	data := testutil.MultiPageTIFF(t, false, tiffTexts...)
	// The page limit PDFs use.
	small := &Builtin{Limits: Limits{MaxPages: 2}.withDefaults()}
	f := &fakeOCR{}
	doc, err := small.Parse(context.Background(), Input{Name: "scan.tif", Kind: KindImage, Data: data, OCR: ocrOn(f)})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Pages != 2 || len(f.calls()) != 2 || !slices.Equal(doc.OCR.Pages, []int{1, 2}) {
		t.Errorf("doc = %+v, calls %v", doc, f.calls())
	}
	contains(t, strings.Join(doc.Warnings, "\n"), "only the first 2 pages of this TIFF were processed")
	absent(t, doc.Markdown, PageMarker(3))
	// One page allowed: still read as a TIFF, with the warning.
	one := &Builtin{Limits: Limits{MaxPages: 1}.withDefaults()}
	if doc, err = one.Parse(context.Background(), Input{Name: "scan.tif", Kind: KindImage, Data: data, OCR: ocrOn(&fakeOCR{})}); err != nil || doc.Pages != 1 {
		t.Fatalf("one page: %+v %v", doc, err)
	}
	contains(t, strings.Join(doc.Warnings, "\n"), "only the first 1 pages of this TIFF were processed")

	// OCR's own per-document cap: the other pages keep their markers.
	o := ocrOn(&fakeOCR{})
	o.MaxPages = 1
	doc, err = builtin().Parse(context.Background(), Input{Name: "scan.tif", Kind: KindImage, Data: data, OCR: o})
	if err != nil {
		t.Fatal(err)
	}
	contains(t, doc.Markdown, PageMarker(1), PageMarker(2), PageMarker(3))
	contains(t, strings.Join(doc.Warnings, "\n"), "2 pages without text were not read with OCR: at most 1 pages per document are")

	// The daily limit admits none: the document needs OCR, as an image does.
	none := ocrOn(&fakeOCR{})
	none.Reserve = func(context.Context, int) (int, error) { return 0, nil }
	if _, err := builtin().Parse(context.Background(), Input{Name: "scan.tif", Kind: KindImage, Data: data, OCR: none}); !errors.Is(err, ErrNeedsOCR) {
		t.Errorf("blocked: %v", err)
	}
}

func TestMultiPageTIFFBadPages(t *testing.T) {
	data := testutil.MultiPageTIFF(t, false, tiffTexts...)
	dirs, _ := tiffDirectories(data, 10)
	if len(dirs) != 3 {
		t.Fatalf("directories = %v", dirs)
	}
	// Page 2 has an unsupported compression: a warning, the others read.
	bad := slices.Clone(data)
	setTIFFTag(t, bad, dirs[1], 259, 99)
	f := &fakeOCR{}
	doc, err := builtin().Parse(context.Background(), Input{Name: "scan.tif", Kind: KindImage, Data: bad, OCR: ocrOn(f)})
	if err != nil {
		t.Fatal(err)
	}
	if got := f.calls(); !slices.Equal(got, []int{tiffHeight(1), tiffHeight(3)}) || !slices.Equal(doc.OCR.Pages, []int{1, 3}) {
		t.Errorf("calls %v, ocr %+v", got, doc.OCR)
	}
	contains(t, strings.Join(doc.Warnings, "\n"), "OCR could not read page 2")
	// A damaged first page: the file is damaged.
	first := slices.Clone(data)
	setTIFFTag(t, first, dirs[0], 256, 0)
	if _, err := builtin().Parse(context.Background(), Input{Name: "scan.tif", Kind: KindImage, Data: first, OCR: ocrOn(&fakeOCR{})}); !errors.Is(err, ErrCorrupt) {
		t.Errorf("damaged first page: %v", err)
	}
	// The OCR service down fails the document (to be retried).
	down := &fakeOCR{err: func(int) error { return ErrOCRUnavailable }}
	if _, err := builtin().Parse(context.Background(), Input{Name: "scan.tif", Kind: KindImage, Data: data, OCR: ocrOn(down)}); !errors.Is(err, ErrOCRUnavailable) {
		t.Errorf("OCR down: %v", err)
	}
}

func TestTIFFDirectories(t *testing.T) {
	le := testutil.MultiPageTIFF(t, false, tiffTexts...)
	be := testutil.MultiPageTIFF(t, true, tiffTexts...)
	for name, data := range map[string][]byte{"little": le, "big": be} {
		if dirs, more := tiffDirectories(data, 10); len(dirs) != 3 || more {
			t.Errorf("%s: %v %v", name, dirs, more)
		}
		if dirs, more := tiffDirectories(data, 2); len(dirs) != 2 || !more {
			t.Errorf("%s capped: %v %v", name, dirs, more)
		}
	}
	dirs, _ := tiffDirectories(le, 10)
	last := func(data []byte) int { // where the last directory's next offset is
		return int(dirs[2]) + 2 + int(binary.LittleEndian.Uint16(data[dirs[2]:]))*12
	}
	// A chain that loops back reads each page once.
	loop := slices.Clone(le)
	binary.LittleEndian.PutUint32(loop[last(loop):], dirs[0])
	if got, more := tiffDirectories(loop, 10); len(got) != 3 || more {
		t.Errorf("loop: %v %v", got, more)
	}
	// A next offset past the end, or into the header, ends the chain.
	for _, off := range []uint32{uint32(len(le)), uint32(len(le) - 1), 1 << 31, 4} {
		bad := slices.Clone(le)
		binary.LittleEndian.PutUint32(bad[last(bad):], off)
		if got, _ := tiffDirectories(bad, 10); len(got) != 3 {
			t.Errorf("next %d: %v", off, got)
		}
	}
	// A directory cut short is not a page.
	if got, _ := tiffDirectories(le[:last(le)+2], 10); len(got) != 2 {
		t.Errorf("truncated: %v", got)
	}
	// Not classic TIFF.
	for _, data := range [][]byte{nil, []byte("II*\x00"), []byte("II+\x00\x08\x00\x04\x00"), encodeImage(t, "png", "x")} {
		if got, _ := tiffDirectories(data, 10); len(got) != 0 {
			t.Errorf("%q: %v", data, got)
		}
	}
	// Go's encoder writes one page; a single directory reads as an image.
	if got, more := tiffDirectories(encodeImage(t, "tiff", "x"), 10); len(got) != 1 || more {
		t.Errorf("single page: %v %v", got, more)
	}
}

// setTIFFTag sets the value of a tag in a little-endian directory.
func setTIFFTag(t *testing.T, data []byte, dir uint32, tag uint16, value uint32) {
	t.Helper()
	n := int(binary.LittleEndian.Uint16(data[dir:]))
	for i := range n {
		e := int(dir) + 2 + i*12
		if binary.LittleEndian.Uint16(data[e:]) != tag {
			continue
		}
		if binary.LittleEndian.Uint16(data[e+2:]) == 3 {
			binary.LittleEndian.PutUint16(data[e+8:], uint16(value))
		} else {
			binary.LittleEndian.PutUint32(data[e+8:], value)
		}
		return
	}
	t.Fatalf("tag %d not in the directory at %d", tag, dir)
}
