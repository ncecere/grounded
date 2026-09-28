package parse

import (
	"bytes"
	"image"
	"testing"

	"github.com/ncecere/grounded/internal/testutil"
)

// Scanned fixtures come from testutil (text rendered into an image without
// a text layer); these adapt them to this package's tests.

type scanPage struct {
	height float64
	text   []pdfTextAt
	scan   string
}

func scannedPDF(t testing.TB, pages []scanPage) []byte {
	conv := make([]testutil.ScanPage, len(pages))
	for i, p := range pages {
		conv[i] = testutil.ScanPage{Height: p.height, Scan: p.scan}
		for _, l := range p.text {
			conv[i].Text = append(conv[i].Text, testutil.ScanText{Size: l.size, X: l.x, Y: l.y, Text: l.text})
		}
	}
	return testutil.ScannedPDF(t, conv)
}

func textImage(text string) *image.Gray { return testutil.TextImage(text) }

func encodeImage(t testing.TB, format, text string) []byte {
	return testutil.EncodeImage(t, format, text)
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
