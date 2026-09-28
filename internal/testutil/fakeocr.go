package testutil

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/png" // decodes the page images
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// FakeOCR is a fake grounded-ocr sidecar (cmd/grounded-ocr's API): POST
// /ocr "reads" a PNG as FakeOCRText of its size, GET /languages lists
// eng and spa.
type FakeOCR struct {
	*httptest.Server

	mu     sync.Mutex
	calls  int
	langs  []string
	status int // non-zero: /ocr answers it
}

// FakeOCRText is what the fake reads on a page image of w x h pixels.
func FakeOCRText(w, h int) string {
	return fmt.Sprintf("Scanned text read by OCR from a page of %d x %d pixels.", w, h)
}

// NewFakeOCR starts a fake sidecar for one test.
func NewFakeOCR(t testing.TB) *FakeOCR {
	t.Helper()
	f := &FakeOCR{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /ocr", f.ocr)
	mux.HandleFunc("GET /languages", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"languages": []string{"eng", "spa"}})
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ok\n") })
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

// Calls is how many pages were read.
func (f *FakeOCR) Calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// Languages are the lang parameters received, in order.
func (f *FakeOCR) Languages() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.langs...)
}

// FailWith makes /ocr answer status (0: succeed again).
func (f *FakeOCR) FailWith(status int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.status = status
}

func (f *FakeOCR) ocr(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	status := f.status
	f.mu.Unlock()
	if status != 0 {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "failure (test)"})
		return
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil || format != "png" {
		w.WriteHeader(http.StatusUnsupportedMediaType)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "the body must be a PNG image"})
		return
	}
	f.mu.Lock()
	f.calls++
	f.langs = append(f.langs, r.URL.Query().Get("lang"))
	f.mu.Unlock()
	_ = json.NewEncoder(w).Encode(map[string]any{"text": FakeOCRText(cfg.Width, cfg.Height) + "\n", "confidence": 0.9})
}
