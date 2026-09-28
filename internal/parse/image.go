// Image uploads (docs/ocr.md §5a): a PNG, JPEG or TIFF is a one-page
// document read with OCR. Without OCR it has no text (ErrNeedsOCR); uploads
// are refused before that when OCR is off for the source.

package parse

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"strings"

	_ "image/jpeg" // registers the JPEG decoder
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/tiff" // registers the TIFF decoder (first page only)
)

// maxImagePixels bounds a decoded image (a decompression bomb is refused
// before decoding): 100 megapixels, e.g. 10000 x 10000.
const maxImagePixels = 100_000_000

// IsImage reports whether content starts like a PNG, JPEG or TIFF file.
func IsImage(head []byte) bool {
	switch {
	case bytes.HasPrefix(head, []byte("\x89PNG\r\n\x1a\n")):
		return true
	case bytes.HasPrefix(head, []byte{0xFF, 0xD8, 0xFF}):
		return true
	case bytes.HasPrefix(head, []byte("II*\x00")), bytes.HasPrefix(head, []byte("MM\x00*")):
		return true
	}
	return false
}

// parseImage reads an image upload with OCR as page 1.
func parseImage(ctx context.Context, in Input) (Document, error) {
	if in.OCR == nil || in.OCR.Engine == nil {
		return Document{Pages: 1}, ErrNeedsOCR
	}
	img, warnings, err := pageFromImage(in.Data)
	if err != nil {
		return Document{}, err
	}
	o := *in.OCR
	pages, more, err := ocrPlan(ctx, &o, []int{1})
	if err != nil {
		return Document{}, err
	}
	warnings = append(warnings, more...)
	if len(pages) == 0 {
		return Document{Pages: 1, Warnings: warnings}, ErrNeedsOCR
	}
	res, err := o.Engine.Recognize(ctx, img, o.Languages)
	if err != nil {
		if fatalOCRError(ctx, err) {
			return Document{}, err
		}
		return Document{}, fmt.Errorf("%w: OCR could not read the image: %v", ErrCorrupt, err)
	}
	info := &OCRInfo{Backend: o.Backend, Pages: []int{1}, TokensIn: res.TokensIn, TokensOut: res.TokensOut}
	text := cleanOCRText(res.Text)
	title := titleFromName(in.Name)
	md := cleanMarkdown(PageMarker(1) + "\n\n" + text)
	if h := firstHeading(md); h != "" {
		title = h
	}
	return Document{Title: title, Markdown: md, Pages: 1, Parser: parserName("builtin:image", info), Warnings: warnings, OCR: info}, nil
}

// pageFromImage decodes an image and re-encodes it as the greyscale PNG
// every OCR backend gets, no larger than ocrMaxPixels on its longest side.
func pageFromImage(data []byte) ([]byte, []string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, nil, fmt.Errorf("%w: unreadable image: %v", ErrCorrupt, err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > maxImagePixels {
		return nil, nil, fmt.Errorf("%w: the image is %d x %d pixels (at most %d megapixels)", ErrTooLarge, cfg.Width, cfg.Height, maxImagePixels/1_000_000)
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, nil, fmt.Errorf("%w: unreadable image: %v", ErrCorrupt, err)
	}
	var warnings []string
	if format == "tiff" && tiffPages(data) > 1 {
		warnings = append(warnings, "only the first page of this multi-page TIFF was read")
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if side := max(w, h); side > ocrMaxPixels {
		w, h = max(w*ocrMaxPixels/side, 1), max(h*ocrMaxPixels/side, 1)
	}
	grey := image.NewGray(image.Rect(0, 0, w, h))
	if w == b.Dx() && h == b.Dy() {
		draw.Draw(grey, grey.Bounds(), src, b.Min, draw.Src)
	} else {
		xdraw.ApproxBiLinear.Scale(grey, grey.Bounds(), src, b, xdraw.Src, nil)
	}
	var out bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&out, grey); err != nil {
		return nil, nil, err
	}
	return out.Bytes(), warnings, nil
}

// tiffPages counts a TIFF's pages (image file directories), up to 2: Go's
// decoder reads only the first, so a multi-page TIFF gets a warning.
func tiffPages(data []byte) int {
	if len(data) < 8 {
		return 0
	}
	var order binary.ByteOrder = binary.LittleEndian
	if strings.HasPrefix(string(data[:2]), "MM") {
		order = binary.BigEndian
	}
	off := int64(order.Uint32(data[4:8]))
	pages := 0
	for off > 0 && off+2 <= int64(len(data)) && pages < 2 {
		pages++
		entries := int64(order.Uint16(data[off : off+2]))
		next := off + 2 + entries*12
		if next+4 > int64(len(data)) {
			break
		}
		off = int64(order.Uint32(data[next : next+4]))
	}
	return pages
}
