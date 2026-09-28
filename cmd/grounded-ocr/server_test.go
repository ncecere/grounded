package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// The test binary doubles as a fake tesseract when GROUNDED_OCR_FAKE is
// set, so the tests run without Tesseract installed.
func TestMain(m *testing.M) {
	if os.Getenv("GROUNDED_OCR_FAKE") == "1" {
		os.Exit(fakeTesseract(os.Args[1:]))
	}
	os.Exit(m.Run())
}

// fakeTesseract mimics the tesseract CLI: --version, --list-langs and
// "IN OUTBASE -l LANGS txt tsv". An image whose body contains "BROKEN"
// fails; the language "slow" sleeps.
func fakeTesseract(args []string) int {
	switch {
	case len(args) == 1 && args[0] == "--version":
		fmt.Println("tesseract 5.3.0\n leptonica-1.82.0")
		return 0
	case len(args) == 1 && args[0] == "--list-langs":
		fmt.Println("List of available languages in \"/usr/share/tesseract-ocr/5/tessdata/\" (4):\neng\nosd\nslow\nspa")
		return 0
	case len(args) == 6 && args[2] == "-l":
		img, _ := os.ReadFile(args[0])
		if bytes.Contains(img, []byte("BROKEN")) {
			fmt.Fprintln(os.Stderr, "Error in pixReadStream: Unknown format: no pix returned")
			return 1
		}
		if strings.Contains(args[3], "slow") {
			time.Sleep(400 * time.Millisecond)
		}
		if os.Getenv("OMP_THREAD_LIMIT") != "1" {
			return 3
		}
		_ = os.WriteFile(args[1]+".txt", []byte("Fake text in "+args[3]+" from "+fmt.Sprint(len(img))+" bytes\n\f"), 0o600)
		tsv := "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
			"1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90.5\tFake\n5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t95.5\ttext\n"
		_ = os.WriteFile(args[1]+".tsv", []byte(tsv), 0o600)
		return 0
	}
	fmt.Fprintln(os.Stderr, "unexpected arguments", args)
	return 2
}

func fakeServer(t *testing.T, opts Options) (*httptest.Server, *Server) {
	t.Helper()
	t.Setenv("GROUNDED_OCR_FAKE", "1")
	srv, err := NewServer(context.Background(), &Tesseract{Program: os.Args[0]}, opts, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	hs := httptest.NewServer(srv)
	t.Cleanup(hs.Close)
	return hs, srv
}

func post(t *testing.T, url string, body []byte) (int, map[string]any) {
	t.Helper()
	res, err := http.Post(url, "image/png", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

var fakePNG = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 100)...)

func TestServer(t *testing.T) {
	hs, srv := fakeServer(t, Options{Concurrency: 2, MaxBytes: 1024, Timeout: 5 * time.Second})
	if got := strings.Join(srv.Languages(), ","); got != "eng,slow,spa" {
		t.Fatalf("languages = %s", got)
	}
	status, out := post(t, hs.URL+"/ocr?lang=eng%2Bspa", fakePNG)
	if status != 200 || out["text"] != "Fake text in eng+spa from 108 bytes\n" || out["confidence"] != 0.93 {
		t.Fatalf("%d %v", status, out)
	}
	for _, tc := range []struct {
		name, lang string
		body       []byte
		status     int
		want       string
	}{
		{"unknown language", "deu", fakePNG, 400, `"deu" is not installed`},
		{"argument injection", "-psm", fakePNG, 400, "language codes"},
		{"not a PNG", "eng", []byte("GIF89a"), 415, "PNG"},
		{"too large", "eng", append(fakePNG, make([]byte, 1024)...), 413, "larger than 1024"},
		{"unreadable", "eng", append(fakePNG, []byte("BROKEN")...), 422, "Unknown format"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, out := post(t, hs.URL+"/ocr?lang="+tc.lang, tc.body)
			if status != tc.status || !strings.Contains(fmt.Sprint(out["error"]), tc.want) {
				t.Errorf("%d %v", status, out)
			}
		})
	}
	res, err := http.Get(hs.URL + "/languages")
	if err != nil || res.StatusCode != 200 {
		t.Fatal(err)
	}
	res.Body.Close()
	res, err = http.Get(hs.URL + "/healthz")
	if err != nil || res.StatusCode != 200 {
		t.Fatal(err)
	}
	res.Body.Close()
	if res, _ := http.Get(hs.URL + "/ocr"); res.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("GET /ocr = %d", res.StatusCode)
	}
}

func TestServerBoundsConcurrencyAndTime(t *testing.T) {
	hs, _ := fakeServer(t, Options{Concurrency: 1, MaxBytes: 1024, Timeout: 1500 * time.Millisecond})
	var ok, busy atomic.Int32
	var wg sync.WaitGroup
	for range 6 { // one slot, at least 400 ms each, a 1.5 s budget: some finish, some don't
		wg.Add(1)
		go func() {
			defer wg.Done()
			switch status, _ := post(t, hs.URL+"/ocr?lang=slow", fakePNG); status {
			case 200:
				ok.Add(1)
			case 503:
				busy.Add(1)
			}
		}()
	}
	wg.Wait()
	if ok.Load() < 1 || busy.Load() < 1 || ok.Load()+busy.Load() != 6 {
		t.Errorf("ok %d, busy %d", ok.Load(), busy.Load())
	}
	// Temporary files are removed.
	left, _ := filepath.Glob(filepath.Join(os.TempDir(), "grounded-ocr-*"))
	for _, d := range left {
		if fi, err := os.Stat(d); err == nil && time.Since(fi.ModTime()) < time.Minute {
			t.Errorf("temporary directory left behind: %s", d)
		}
	}
}

func TestMeanConfidence(t *testing.T) {
	tsv := "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
		"4\t1\t1\t1\t1\t0\t0\t0\t1\t1\t-1\t\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t80\tA\n5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t-1\t \n5\t1\t1\t1\t1\t3\t0\t0\t1\t1\t90\tB\n"
	if got := meanConfidence(strings.NewReader(tsv)); got != 0.85 {
		t.Errorf("confidence = %v", got)
	}
	if got := meanConfidence(strings.NewReader("")); got != 0 {
		t.Errorf("empty = %v", got)
	}
}

// renderText renders a line of text large enough for Tesseract.
func renderText(t *testing.T, text string) []byte {
	f, err := opentype.Parse(goregular.TTF)
	if err != nil {
		t.Fatal(err)
	}
	face, err := opentype.NewFace(f, &opentype.FaceOptions{Size: 40, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewGray(image.Rect(0, 0, 1200, 120))
	draw.Draw(img, img.Bounds(), image.White, image.Point{}, draw.Src)
	d := font.Drawer{Dst: img, Src: image.Black, Face: face, Dot: fixed.P(40, 75)}
	d.DrawString(text)
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// TestRealTesseract runs when tesseract is installed (CI's ocr job).
func TestRealTesseract(t *testing.T) {
	if _, err := exec.LookPath("tesseract"); err != nil {
		t.Skip("tesseract is not installed")
	}
	srv, err := NewServer(context.Background(), &Tesseract{Program: "tesseract"}, Options{Concurrency: 1, Timeout: time.Minute},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	hs := httptest.NewServer(srv)
	defer hs.Close()
	status, out := post(t, hs.URL+"/ocr?lang=eng", renderText(t, "The quick brown fox jumps over the lazy dog"))
	text := strings.ToLower(fmt.Sprint(out["text"]))
	if status != 200 || !strings.Contains(text, "quick brown fox") {
		t.Fatalf("%d %v", status, out)
	}
	if c, _ := out["confidence"].(float64); c < 0.5 {
		t.Errorf("confidence %v", c)
	}
}
