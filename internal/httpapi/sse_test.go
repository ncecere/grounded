package httpapi

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type syncRecorder struct {
	mu sync.Mutex
	*httptest.ResponseRecorder
}

func (r *syncRecorder) Write(b []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ResponseRecorder.Write(b)
}

func (r *syncRecorder) body() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.Body.String()
}

func TestSSEWriterEventsAndHeartbeat(t *testing.T) {
	old := sseHeartbeat
	sseHeartbeat = 20 * time.Millisecond
	defer func() { sseHeartbeat = old }()

	rec := &syncRecorder{ResponseRecorder: httptest.NewRecorder()}
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := newSSE(rec, cancel)
	if s.isStarted() {
		t.Fatal("started before the first event")
	}
	s.event("text_delta", map[string]string{"delta": "hi"})
	time.Sleep(70 * time.Millisecond)
	s.data("[DONE]")
	s.close()
	s.event("late", nil) // ignored after close
	body := rec.body()
	if rec.Header().Get("Content-Type") != "text/event-stream; charset=utf-8" || rec.Header().Get("X-Accel-Buffering") != "no" {
		t.Errorf("headers = %v", rec.Header())
	}
	if !strings.HasPrefix(body, "event: text_delta\ndata: {\"delta\":\"hi\"}\n\n") || !strings.Contains(body, ": ping\n\n") ||
		!strings.HasSuffix(body, "data: [DONE]\n\n") || strings.Contains(body, "late") {
		t.Fatalf("body = %q", body)
	}
}
