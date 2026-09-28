// Command grounded-ocr is Grounded's Tesseract sidecar (docs/ocr.md §3): a
// small HTTP server that reads one page image per request with the
// tesseract command-line program. Grounded renders the pages and calls it
// through OCR_TESSERACT_URL; the image is the Kustomize component
// components/ocr-tesseract.
//
//	POST /ocr?lang=eng   PNG body -> {"text": "...", "confidence": 0.93}
//	GET  /languages      -> {"languages": ["eng", ...]}
//	GET  /healthz        -> ok
//
// Requests are bounded: at most -concurrency run at once (default one per
// CPU; others wait for a slot within the timeout), the body is at most
// -max-bytes, each run is killed after -timeout, and nothing is written
// but a temporary directory per request, removed afterwards.
//
// Every flag can be set with an environment variable: OCR_ADDR,
// OCR_CONCURRENCY, OCR_MAX_BYTES, OCR_TIMEOUT and OCR_TESSERACT (the
// program to run). `grounded-ocr version` prints the version.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/ncecere/grounded/internal/buildinfo"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "version" {
		t := &Tesseract{Program: envOr("OCR_TESSERACT", "tesseract")}
		v, err := t.Version(context.Background())
		if err != nil {
			fmt.Fprintf(os.Stderr, "grounded-ocr %s (%s): %v\n", buildinfo.Version, buildinfo.Commit, err)
			os.Exit(1)
		}
		fmt.Printf("grounded-ocr %s (%s), %s\n", buildinfo.Version, buildinfo.Commit, v)
		return
	}
	if err := run(); err != nil {
		slog.Error("grounded-ocr stopped", "err", err)
		os.Exit(1)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return n
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if d, err := time.ParseDuration(os.Getenv(key)); err == nil {
		return d
	}
	return def
}

func run() error {
	addr := flag.String("addr", envOr("OCR_ADDR", ":8080"), "listen address")
	concurrency := flag.Int("concurrency", envInt("OCR_CONCURRENCY", runtime.NumCPU()), "tesseract runs at once")
	maxBytes := flag.Int64("max-bytes", int64(envInt("OCR_MAX_BYTES", 32<<20)), "largest image accepted, in bytes")
	timeout := flag.Duration("timeout", envDuration("OCR_TIMEOUT", 2*time.Minute), "longest a request may take, waiting included")
	program := flag.String("tesseract", envOr("OCR_TESSERACT", "tesseract"), "the tesseract program")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	t := &Tesseract{Program: *program}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	srv, err := NewServer(ctx, t, Options{Concurrency: *concurrency, MaxBytes: *maxBytes, Timeout: *timeout}, log)
	if err != nil {
		return err
	}
	hs := &http.Server{Addr: *addr, Handler: srv, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: *timeout, WriteTimeout: *timeout + 10*time.Second}
	errc := make(chan error, 1)
	go func() { errc <- hs.ListenAndServe() }()
	log.Info("grounded-ocr listening", "addr", *addr, "version", buildinfo.Version, "concurrency", *concurrency, "languages", srv.Languages())
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := hs.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
