// Image uploads (docs/ocr.md §5a): a PNG or JPEG is a one-page document
// read with OCR, and a TIFF has a page per image directory, each read with
// OCR like a scanned PDF page. Without OCR an image has no text
// (ErrNeedsOCR); uploads are refused before that when OCR is off for the
// source.

package parse

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/draw"
	_ "image/jpeg" // registers the JPEG decoder
	"image/png"
	"io"
	"strings"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/tiff" // also registers the TIFF decoder (first page)
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

// parseImage reads an image upload with OCR: page 1, or every page of a
// multi-page TIFF (up to lim.MaxPages, like a PDF).
func parseImage(ctx context.Context, in Input, lim Limits) (Document, error) {
	if in.OCR == nil || in.OCR.Engine == nil {
		return Document{Pages: 1}, ErrNeedsOCR
	}
	if dirs, more := tiffDirectories(in.Data, lim.MaxPages); len(dirs) > 1 || more {
		return parseTIFFPages(ctx, in, dirs, more)
	}
	img, err := pageFromImage(in.Data)
	if err != nil {
		return Document{}, err
	}
	o := *in.OCR
	pages, warnings, err := ocrPlan(ctx, &o, []int{1})
	if err != nil {
		return Document{}, err
	}
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
	md := cleanMarkdown(PageMarker(1) + "\n\n" + CleanOCRText(res.Text))
	return Document{Title: imageTitle(md, in.Name), Markdown: md, Pages: 1, Parser: parserName("builtin:image", info), Warnings: warnings, OCR: info}, nil
}

// parseTIFFPages reads each page of a multi-page TIFF (its image
// directories at dirs) with OCR, under the page's marker. A page that can't
// be decoded or read is a warning, as for a PDF page.
func parseTIFFPages(ctx context.Context, in Input, dirs []uint32, more bool) (Document, error) {
	n := len(dirs)
	var warnings []string
	if more {
		warnings = append(warnings, fmt.Sprintf("only the first %d pages of this TIFF were processed", n))
	}
	// The first page decides whether the file is readable at all.
	if cfg, err := tiff.DecodeConfig(newTIFFPageReader(in.Data, dirs[0])); err != nil {
		return Document{}, fmt.Errorf("%w: unreadable image: %v", ErrCorrupt, err)
	} else if err := checkPixels(cfg); err != nil {
		return Document{}, err
	}
	all := make([]int, n)
	for i := range all {
		all[i] = i + 1
	}
	o := *in.OCR
	pages, planned, err := ocrPlan(ctx, &o, all)
	if err != nil {
		return Document{}, err
	}
	warnings = append(warnings, planned...)
	if len(pages) == 0 {
		return Document{Pages: n, Warnings: warnings}, ErrNeedsOCR
	}
	texts, info, read, err := ocrPages(ctx, &o, pages, func(p int) ([]byte, error) { return tiffPagePNG(in.Data, dirs[p-1]) })
	if err != nil {
		return Document{}, err
	}
	warnings = append(warnings, read...)
	var b strings.Builder
	for p := 1; p <= n; p++ {
		writePageStart(&b, p, texts)
	}
	md := cleanMarkdown(b.String())
	return Document{Title: imageTitle(md, in.Name), Markdown: md, Pages: n, Parser: parserName("builtin:image", info), Warnings: warnings, OCR: info}, nil
}

// imageTitle is the first heading OCR found, or the file name.
func imageTitle(md, name string) string {
	if h := firstHeading(md); h != "" {
		return h
	}
	return titleFromName(name)
}

// pageFromImage decodes an image (a TIFF's first page) and re-encodes it
// as the page every OCR backend gets.
func pageFromImage(data []byte) ([]byte, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: unreadable image: %v", ErrCorrupt, err)
	}
	if err := checkPixels(cfg); err != nil {
		return nil, err
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: unreadable image: %v", ErrCorrupt, err)
	}
	return ocrPNG(src)
}

// tiffPagePNG decodes the TIFF page whose image directory is at dir and
// re-encodes it for OCR. The file is read as if its header pointed at that
// directory (Go's decoder reads the first directory only); data is not
// changed or copied.
func tiffPagePNG(data []byte, dir uint32) ([]byte, error) {
	r := newTIFFPageReader(data, dir)
	cfg, err := tiff.DecodeConfig(r)
	if err != nil {
		return nil, fmt.Errorf("%w: unreadable TIFF page: %v", ErrCorrupt, err)
	}
	if err := checkPixels(cfg); err != nil {
		return nil, err
	}
	src, err := tiff.Decode(newTIFFPageReader(data, dir))
	if err != nil {
		return nil, fmt.Errorf("%w: unreadable TIFF page: %v", ErrCorrupt, err)
	}
	return ocrPNG(src)
}

// checkPixels refuses an image above maxImagePixels before it is decoded.
func checkPixels(cfg image.Config) error {
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > maxImagePixels {
		return fmt.Errorf("%w: the image is %d x %d pixels (at most %d megapixels)", ErrTooLarge, cfg.Width, cfg.Height, maxImagePixels/1_000_000)
	}
	return nil
}

// ocrPNG re-encodes an image as the greyscale PNG every OCR backend gets,
// no larger than ocrMaxPixels on its longest side.
func ocrPNG(src image.Image) ([]byte, error) {
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
		return nil, err
	}
	return out.Bytes(), nil
}

// tiffDirectories lists the offsets of a classic TIFF's image file
// directories (its pages) in order, at most limit of them; more reports
// that the file has further pages. The chain is walked with bounds and loop
// checks: a directory that is outside the file, cut short or seen before
// ends it. Anything else (BigTIFF, PNG, JPEG) has none.
func tiffDirectories(data []byte, limit int) (dirs []uint32, more bool) {
	if len(data) < 8 {
		return nil, false
	}
	var order binary.ByteOrder
	switch string(data[:4]) {
	case "II*\x00":
		order = binary.LittleEndian
	case "MM\x00*":
		order = binary.BigEndian
	default:
		return nil, false
	}
	seen := map[uint32]bool{}
	size := int64(len(data))
	off := order.Uint32(data[4:8])
	for off >= 8 && !seen[off] && int64(off)+2 <= size {
		entries := int64(order.Uint16(data[off:]))
		next := int64(off) + 2 + entries*12
		if next+4 > size {
			break
		}
		if len(dirs) == limit {
			return dirs, true
		}
		seen[off] = true
		dirs = append(dirs, off)
		off = order.Uint32(data[next : next+4])
	}
	return dirs, false
}

// tiffPageReader reads a TIFF file whose header's first-directory offset
// (bytes 4-7) is replaced, so a decoder reads that directory's page.
type tiffPageReader struct {
	data []byte
	head [8]byte
	pos  int64
}

func newTIFFPageReader(data []byte, dir uint32) *tiffPageReader {
	r := &tiffPageReader{data: data}
	copy(r.head[:], data[:8])
	order := binary.ByteOrder(binary.LittleEndian)
	if data[0] == 'M' {
		order = binary.BigEndian
	}
	order.PutUint32(r.head[4:8], dir)
	return r
}

func (r *tiffPageReader) ReadAt(p []byte, off int64) (int, error) {
	if off < 0 {
		return 0, fmt.Errorf("negative offset %d", off)
	}
	if off >= int64(len(r.data)) {
		return 0, io.EOF
	}
	n := copy(p, r.data[off:])
	for i := off; i < int64(len(r.head)) && i < off+int64(n); i++ {
		p[i-off] = r.head[i]
	}
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}

func (r *tiffPageReader) Read(p []byte) (int, error) {
	n, err := r.ReadAt(p, r.pos)
	r.pos += int64(n)
	return n, err
}
