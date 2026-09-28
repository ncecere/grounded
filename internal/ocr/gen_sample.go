//go:build ignore

// Generates sample.png, the page Admin -> Parsing's Test button reads:
// go run gen_sample.go (from internal/ocr).
package main

import (
	"image"
	"image/draw"
	"image/png"
	"log"
	"os"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// SampleLines must match sampleText in check.go.
var lines = []string{
	"Grounded OCR test page",
	"The quick brown fox jumps over the lazy dog.",
	"Invoice 2026-0142: total 318.50",
}

func main() {
	f, err := opentype.Parse(goregular.TTF)
	if err != nil {
		log.Fatal(err)
	}
	face, err := opentype.NewFace(f, &opentype.FaceOptions{Size: 36, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		log.Fatal(err)
	}
	img := image.NewGray(image.Rect(0, 0, 1000, 60+len(lines)*60))
	draw.Draw(img, img.Bounds(), image.White, image.Point{}, draw.Src)
	d := font.Drawer{Dst: img, Src: image.Black, Face: face}
	for i, l := range lines {
		d.Dot = fixed.P(40, 70+i*60)
		d.DrawString(l)
	}
	out, err := os.Create("sample.png")
	if err != nil {
		log.Fatal(err)
	}
	defer out.Close()
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(out, img); err != nil {
		log.Fatal(err)
	}
}
