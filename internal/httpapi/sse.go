package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// sseHeartbeat is the interval of ": ping" comments that keep idle
// proxies from closing a stream while the model thinks.
var sseHeartbeat = 15 * time.Second

// sseWriteTimeout bounds one write, so a client that stops reading cannot
// hold a handler forever (the server has no WriteTimeout, by design).
const sseWriteTimeout = 30 * time.Second

// sseWriter writes Server-Sent Events. Headers are sent by start (or the
// first event), so a handler can still answer with a plain HTTP error until
// then. A failed write cancels the request's work through cancel.
type sseWriter struct {
	w       http.ResponseWriter
	rc      *http.ResponseController
	cancel  context.CancelFunc
	mu      sync.Mutex
	started bool
	failed  bool
	stop    chan struct{}
	stopped sync.Once
}

func newSSE(w http.ResponseWriter, cancel context.CancelFunc) *sseWriter {
	return &sseWriter{w: w, rc: http.NewResponseController(w), cancel: cancel, stop: make(chan struct{})}
}

// start sends the headers and starts the heartbeat. It is idempotent.
func (s *sseWriter) start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return
	}
	s.started = true
	h := s.w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache, no-store")
	h.Set("X-Accel-Buffering", "no") // nginx: do not buffer
	s.w.WriteHeader(http.StatusOK)
	s.flushLocked()
	go s.heartbeat()
}

func (s *sseWriter) isStarted() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.started
}

func (s *sseWriter) heartbeat() {
	t := time.NewTicker(sseHeartbeat)
	defer t.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-t.C:
			s.write(": ping\n\n")
		}
	}
}

func (s *sseWriter) flushLocked() {
	if err := s.rc.Flush(); err != nil {
		s.failLocked()
	}
}

func (s *sseWriter) failLocked() {
	if !s.failed {
		s.failed = true
		if s.cancel != nil {
			s.cancel()
		}
	}
}

// write sends raw SSE text and flushes it.
func (s *sseWriter) write(text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failed || !s.started {
		return
	}
	_ = s.rc.SetWriteDeadline(time.Now().Add(sseWriteTimeout))
	if _, err := fmt.Fprint(s.w, text); err != nil {
		s.failLocked()
		return
	}
	s.flushLocked()
}

// event sends a named event with a JSON payload, starting the stream if
// needed.
func (s *sseWriter) event(name string, data any) {
	s.start()
	b, err := json.Marshal(data)
	if err != nil {
		b = []byte("{}")
	}
	s.write("event: " + name + "\ndata: " + string(b) + "\n\n")
}

// data sends an unnamed event (OpenAI-style "data: ..." lines).
func (s *sseWriter) data(v any) {
	s.start()
	var line string
	if str, ok := v.(string); ok {
		line = str
	} else {
		b, err := json.Marshal(v)
		if err != nil {
			return
		}
		line = string(b)
	}
	s.write("data: " + line + "\n\n")
}

// close stops the heartbeat; nothing is written afterwards (the handler is
// about to return).
func (s *sseWriter) close() {
	s.mu.Lock()
	s.failed = true
	s.mu.Unlock()
	s.stopped.Do(func() { close(s.stop) })
}
