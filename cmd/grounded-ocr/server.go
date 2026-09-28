package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"
)

// Options bound the server's work.
type Options struct {
	Concurrency int           // tesseract runs at once (at least 1)
	MaxBytes    int64         // largest request body
	Timeout     time.Duration // a request, including the wait for a slot
}

// Server serves /ocr, /languages and /healthz.
type Server struct {
	t     *Tesseract
	opts  Options
	log   *slog.Logger
	slots chan struct{}
	langs []string
	mux   *http.ServeMux
}

// NewServer checks that tesseract runs and reads its languages.
func NewServer(ctx context.Context, t *Tesseract, opts Options, log *slog.Logger) (*Server, error) {
	opts.Concurrency = max(opts.Concurrency, 1)
	if opts.MaxBytes <= 0 {
		opts.MaxBytes = 32 << 20
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 2 * time.Minute
	}
	langs, err := t.Languages(ctx)
	if err != nil {
		return nil, err
	}
	if len(langs) == 0 {
		return nil, errors.New("tesseract has no languages installed")
	}
	s := &Server{t: t, opts: opts, log: log, slots: make(chan struct{}, opts.Concurrency), langs: langs, mux: http.NewServeMux()}
	s.mux.HandleFunc("POST /ocr", s.ocr)
	s.mux.HandleFunc("GET /languages", s.languages)
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ok\n") })
	return s, nil
}

// Languages are the installed languages.
func (s *Server) Languages() []string { return s.langs }

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) languages(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"languages": s.langs})
}

var pngMagic = []byte("\x89PNG\r\n\x1a\n")

// checkLangs validates a lang parameter against the installed languages.
func (s *Server) checkLangs(langs string) error {
	if !langRE.MatchString(langs) {
		return errors.New("lang must be language codes joined with +, e.g. eng or eng+spa")
	}
	for _, l := range strings.Split(langs, "+") {
		if !slices.Contains(s.langs, l) {
			return fmt.Errorf("language %q is not installed (installed: %s)", l, strings.Join(s.langs, ", "))
		}
	}
	return nil
}

func (s *Server) ocr(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), s.opts.Timeout)
	defer cancel()
	langs := r.URL.Query().Get("lang")
	if langs == "" {
		langs = "eng"
	}
	if err := s.checkLangs(langs); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, s.opts.MaxBytes))
	var tooLarge *http.MaxBytesError
	switch {
	case errors.As(err, &tooLarge):
		fail(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("the image is larger than %d bytes", s.opts.MaxBytes))
		return
	case err != nil:
		fail(w, http.StatusBadRequest, "could not read the request body")
		return
	case !bytes.HasPrefix(body, pngMagic):
		fail(w, http.StatusUnsupportedMediaType, "the body must be a PNG image")
		return
	}
	select {
	case s.slots <- struct{}{}:
	case <-ctx.Done():
		fail(w, http.StatusServiceUnavailable, "busy: no OCR slot became free in time")
		return
	}
	defer func() { <-s.slots }()
	start := time.Now()
	res, err := s.t.Recognize(ctx, body, langs)
	switch {
	case errors.Is(err, errBadImage):
		fail(w, http.StatusUnprocessableEntity, err.Error())
	case ctx.Err() != nil:
		fail(w, http.StatusServiceUnavailable, "timed out")
	case err != nil:
		s.log.Error("ocr failed", "err", err)
		fail(w, http.StatusInternalServerError, "OCR failed")
	default:
		s.log.Info("ocr", "lang", langs, "bytes", len(body), "ms", time.Since(start).Milliseconds(), "chars", len(res.Text), "confidence", res.Confidence)
		writeJSON(w, http.StatusOK, res)
	}
}
