package parse

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/tiff"
)

// Scanned fixtures: text rendered into a greyscale image and embedded in a
// PDF page as an image XObject, with no text layer, as a scanner makes
// them. Pages may instead (or also) carry real text.

// scanPage is one page of a fixture PDF.
type scanPage struct {
	height float64     // points; 792 (US Letter) when 0
	text   []pdfTextAt // a text layer
	scan   string      // text rendered into the page's image; "" for none
}

// textImage renders lines of text, black on white, scaled up so OCR can
// read it (basicfont's 7x13 glyphs at 4x).
func textImage(text string) *image.Gray {
	const scale = 4
	lines := strings.Split(text, "\n")
	w := 0
	for _, l := range lines {
		w = max(w, len(l)*7)
	}
	small := image.NewGray(image.Rect(0, 0, w+20, len(lines)*16+20))
	draw.Draw(small, small.Bounds(), image.White, image.Point{}, draw.Src)
	d := font.Drawer{Dst: small, Src: image.Black, Face: basicfont.Face7x13}
	for i, l := range lines {
		d.Dot = fixed.P(10, 10+13+i*16)
		d.DrawString(l)
	}
	big := image.NewGray(image.Rect(0, 0, small.Bounds().Dx()*scale, small.Bounds().Dy()*scale))
	for y := 0; y < big.Bounds().Dy(); y++ {
		for x := 0; x < big.Bounds().Dx(); x++ {
			big.SetGray(x, y, small.GrayAt(x/scale, y/scale))
		}
	}
	return big
}

// scannedPDF builds a PDF whose pages may hold an image of text (no text
// layer) and text.
func scannedPDF(t testing.TB, pages []scanPage) []byte {
	t.Helper()
	var objs []string
	add := func(s string) int { objs = append(objs, s); return len(objs) }
	add("")
	add("")
	font := add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
	var kids []string
	for _, pg := range pages {
		h := pg.height
		if h == 0 {
			h = 792
		}
		var content strings.Builder
		res := fmt.Sprintf("/Font << /F1 %d 0 R >>", font)
		if pg.scan != "" {
			img := textImage(pg.scan)
			var z bytes.Buffer
			zw := zlib.NewWriter(&z)
			_, _ = zw.Write(img.Pix)
			_ = zw.Close()
			b := img.Bounds()
			im := add(fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n%s\nendstream",
				b.Dx(), b.Dy(), z.Len(), z.String()))
			res += fmt.Sprintf(" /XObject << /Im1 %d 0 R >>", im)
			// 4 image pixels per point: about 290 DPI, like a scan.
			fmt.Fprintf(&content, "q %.2f 0 0 %.2f 36 %.2f cm /Im1 Do Q\n", float64(b.Dx())/4, float64(b.Dy())/4, h-36-float64(b.Dy())/4)
		}
		for _, l := range pg.text {
			fmt.Fprintf(&content, "BT /F1 %.1f Tf %.1f %.1f Td (%s) Tj ET\n", l.size, l.x, l.y, l.text)
		}
		stream := content.String()
		c := add(fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(stream), stream))
		p := add(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 %.0f] /Resources << %s >> /Contents %d 0 R >>", h, res, c))
		kids = append(kids, fmt.Sprintf("%d 0 R", p))
	}
	objs[0] = "<< /Type /Catalog /Pages 2 0 R >>"
	objs[1] = fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(kids))
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return b.Bytes()
}

// encodeImage encodes a text image as PNG, JPEG or TIFF.
func encodeImage(t testing.TB, format, text string) []byte {
	t.Helper()
	img := textImage(text)
	var b bytes.Buffer
	var err error
	switch format {
	case "png":
		err = png.Encode(&b, img)
	case "jpeg":
		err = jpeg.Encode(&b, img, &jpeg.Options{Quality: 90})
	case "tiff":
		err = tiff.Encode(&b, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// twoPageTIFF makes a TIFF whose first directory links to a second one
// (itself), which is how a multi-page TIFF looks to tiffPages.
func twoPageTIFF(t testing.TB) []byte {
	data := encodeImage(t, "tiff", "page one")
	off := int(data[4]) | int(data[5])<<8 | int(data[6])<<16 | int(data[7])<<24
	entries := int(data[off]) | int(data[off+1])<<8
	next := off + 2 + entries*12
	copy(data[next:next+4], data[4:8])
	return data
}

// imageHeight is the height in pixels of a PNG, for fakes that tell pages
// apart by their size.
func imageHeight(png []byte) int {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(png))
	if err != nil {
		return -1
	}
	return cfg.Height
}
