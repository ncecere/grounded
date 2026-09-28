package ocr

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Config is the OCR configuration (config.OCR and TIKA_URL). Only
// configured backends can be chosen.
type Config struct {
	TesseractURL string        // OCR_TESSERACT_URL
	Timeout      time.Duration // one page's request (OCR_TIMEOUT)
	// Tika is the Tika client when TIKA_URL is set (its Recognize reads
	// page images).
	Tika *parse.Tika
	// MaxPagesPerDocument (OCR_MAX_PAGES_PER_DOCUMENT) and Concurrency
	// (OCR_CONCURRENCY, pages at once per process).
	MaxPagesPerDocument int
	Concurrency         int
}

// Service stores the parsing settings and gives ingestion its OCR.
type Service struct {
	Pool    *pgxpool.Pool
	Catalog *catalog.Service
	// Limits enforces ocr_pages_per_day (nil: no daily limit).
	Limits *limits.Service
	Config Config
	Log    *slog.Logger
	// Now is the clock (tests may replace it).
	Now func() time.Time

	q         *dbgen.Queries
	tesseract *Tesseract
	sem       chan struct{} // pages read at once in this process

	mu       sync.Mutex
	cached   *Stored
	cachedAt time.Time
}

// settingsTTL is how long a process reuses the settings it read: ingestion
// asks for every PDF, and an admin's change reaches every worker within it.
const settingsTTL = 5 * time.Second

// New returns a Service.
func New(pool *pgxpool.Pool, cat *catalog.Service, lim *limits.Service, cfg Config, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	if cfg.MaxPagesPerDocument <= 0 {
		cfg.MaxPagesPerDocument = parse.DefaultOCRMaxPages
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 2
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 2 * time.Minute
	}
	s := &Service{Pool: pool, Catalog: cat, Limits: lim, Config: cfg, Log: log, Now: time.Now,
		q: dbgen.New(pool), sem: make(chan struct{}, cfg.Concurrency)}
	if cfg.TesseractURL != "" {
		s.tesseract = NewTesseract(cfg.TesseractURL, cfg.Timeout)
	}
	return s
}

// configured reports whether a backend's service is configured. The vision
// backend needs only a vision model, chosen in the settings.
func (s *Service) configured(backend string) bool {
	switch backend {
	case BackendTesseract:
		return s.tesseract != nil
	case BackendTika:
		return s.Config.Tika != nil
	case BackendVision:
		return true
	}
	return false
}

// configKey is the setting that configures a backend.
func (s *Service) configKey(backend string) string {
	switch backend {
	case BackendTesseract:
		return "OCR_TESSERACT_URL"
	case BackendTika:
		return "TIKA_URL"
	}
	return "a vision model"
}

// BackendStatus is one backend as Admin -> Parsing shows it.
type BackendStatus struct {
	Backend    string
	Configured bool
	// ConfigKey is what configures it (an environment variable, or "a
	// vision model").
	ConfigKey string
}

// BackendStatuses lists the backends and whether each can be chosen.
func (s *Service) BackendStatuses() []BackendStatus {
	out := make([]BackendStatus, 0, len(Backends))
	for _, b := range Backends {
		out = append(out, BackendStatus{Backend: b, Configured: s.configured(b), ConfigKey: s.configKey(b)})
	}
	return out
}

// Load returns the settings, read at most every settingsTTL per process.
func (s *Service) Load(ctx context.Context) (Stored, error) {
	s.mu.Lock()
	if s.cached != nil && time.Since(s.cachedAt) < settingsTTL {
		st := *s.cached
		s.mu.Unlock()
		return st, nil
	}
	s.mu.Unlock()
	st, err := s.load(ctx, s.q, false)
	if err != nil {
		return st, err
	}
	s.mu.Lock()
	s.cached, s.cachedAt = &st, time.Now()
	s.mu.Unlock()
	return st, nil
}

// forget drops the cached settings (after a change in this process).
func (s *Service) forget() {
	s.mu.Lock()
	s.cached = nil
	s.mu.Unlock()
}

// limited bounds the pages read at once in this process (OCR_CONCURRENCY),
// across every document, so OCR can't take all of a worker's capacity.
type limited struct {
	parse.OCR
	sem chan struct{}
}

func (l limited) Recognize(ctx context.Context, img []byte, langs string) (parse.OCRResult, error) {
	select {
	case l.sem <- struct{}{}:
	case <-ctx.Done():
		return parse.OCRResult{}, ctx.Err()
	}
	defer func() { <-l.sem }()
	return l.OCR.Recognize(ctx, img, langs)
}
