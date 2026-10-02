package testutil

import (
	"encoding/binary"
	"testing"
)

// MultiPageTIFF encodes each text (rendered by TextImage) as one page of an
// uncompressed 8-bit greyscale TIFF, little-endian ("II") or, with
// bigEndian, big-endian ("MM"). Go's encoder writes one page only. Pages
// with a different number of lines have different heights, which fakes use
// to tell them apart.
func MultiPageTIFF(t testing.TB, bigEndian bool, texts ...string) []byte {
	t.Helper()
	if len(texts) == 0 {
		t.Fatal("MultiPageTIFF needs at least one page")
	}
	var order interface {
		binary.ByteOrder
		binary.AppendByteOrder
	} = binary.LittleEndian
	data := []byte("II*\x00\x00\x00\x00\x00")
	if bigEndian {
		order = binary.BigEndian
		data = []byte("MM\x00*\x00\x00\x00\x00")
	}
	next := 4 // where the offset of the next directory goes
	for _, text := range texts {
		img := TextImage(text)
		w, h := img.Bounds().Dx(), img.Bounds().Dy()
		pix := len(data)
		for y := range h {
			data = append(data, img.Pix[y*img.Stride:y*img.Stride+w]...)
		}
		if len(data)%2 == 1 {
			data = append(data, 0) // directories start on a word boundary
		}
		order.PutUint32(data[next:], uint32(len(data)))
		const short, long = 3, 4
		entries := []struct {
			tag, typ uint16
			value    uint32
		}{
			{256, long, uint32(w)},     // ImageWidth
			{257, long, uint32(h)},     // ImageLength
			{258, short, 8},            // BitsPerSample
			{259, short, 1},            // Compression: none
			{262, short, 1},            // PhotometricInterpretation: BlackIsZero
			{273, long, uint32(pix)},   // StripOffsets
			{277, short, 1},            // SamplesPerPixel
			{278, long, uint32(h)},     // RowsPerStrip
			{279, long, uint32(w * h)}, // StripByteCounts
		}
		data = order.AppendUint16(data, uint16(len(entries)))
		for _, e := range entries {
			data = order.AppendUint16(data, e.tag)
			data = order.AppendUint16(data, e.typ)
			data = order.AppendUint32(data, 1)
			if e.typ == short { // a SHORT value is left-justified in the field
				data = order.AppendUint16(data, uint16(e.value))
				data = append(data, 0, 0)
			} else {
				data = order.AppendUint32(data, e.value)
			}
		}
		next = len(data)
		data = append(data, 0, 0, 0, 0) // no next directory (yet)
	}
	return data
}
