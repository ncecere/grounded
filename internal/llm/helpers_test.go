package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
)

// recorder is an httptest server that records request bodies and replies
// with a handler.
type recorder struct {
	*httptest.Server
	mu     sync.Mutex
	bodies []map[string]any
	auth   []string
}

func newRecorder(t *testing.T, h func(w http.ResponseWriter, r *http.Request)) *recorder {
	t.Helper()
	rec := &recorder{}
	rec.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		rec.mu.Lock()
		rec.bodies = append(rec.bodies, body)
		rec.auth = append(rec.auth, r.Header.Get("Authorization"))
		rec.mu.Unlock()
		h(w, r)
	}))
	t.Cleanup(rec.Close)
	return rec
}

func (r *recorder) body(i int) map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.bodies[i]
}

// sseHandler serves raw SSE text.
func sseHandler(raw string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, raw)
	}
}

func fixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// sse builds an SSE body from chunk JSON strings, ending with [DONE].
func sse(chunks ...string) string {
	var b strings.Builder
	for _, c := range chunks {
		fmt.Fprintf(&b, "data: %s\n\n", c)
	}
	b.WriteString("data: [DONE]\n\n")
	return b.String()
}

func delta(d string) string {
	return `{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":` + d + `}]}`
}

func finish(reason string) string {
	return `{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"` + reason + `"}]}`
}

const usageChunk = `{"id":"c1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`

func testModel() Model {
	return Model{ID: "gpt-oss-120b", ContextWindow: 131072, MaxOutputTokens: 4096, SupportsTools: true, Compat: DecodeCompat(nil)}
}

func provider(url string, timeout time.Duration) *OpenAI {
	return NewOpenAI(gateway.New(url, "sk-secret", timeout))
}

func collect(t *testing.T, ch <-chan Event) []Event {
	t.Helper()
	var out []Event
	timeout := time.After(10 * time.Second)
	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				checkInvariants(t, out)
				return out
			}
			out = append(out, ev)
		case <-timeout:
			t.Fatal("stream did not close")
		}
	}
}

// checkInvariants asserts the stream contract from the package docs.
func checkInvariants(t *testing.T, evs []Event) {
	t.Helper()
	if len(evs) == 0 {
		t.Fatal("no events")
	}
	terminals := 0
	for _, e := range evs {
		if e.Type.Terminal() {
			terminals++
		}
	}
	last := evs[len(evs)-1]
	if terminals != 1 || !last.Type.Terminal() {
		t.Fatalf("want exactly one terminal event, last; got %d (last %s)", terminals, last.Type)
	}
	if last.Type == EventDone && evs[0].Type != EventStart {
		t.Fatalf("done stream must begin with start, got %s", evs[0].Type)
	}
	for i, e := range evs {
		if e.Type == EventStart && i != 0 {
			t.Fatalf("start at position %d", i)
		}
		if (e.Type == EventStart || e.Type.Terminal()) && e.ContentIndex != -1 {
			t.Fatalf("%s has content index %d", e.Type, e.ContentIndex)
		}
	}
	// Per block: start, delta*, end; nothing after end.
	state := map[int]string{} // "open" | "ended"
	for _, e := range evs {
		kind, phase, ok := strings.Cut(string(e.Type), "_")
		if !ok || e.Type == EventStart {
			continue
		}
		_ = kind
		switch phase {
		case "start":
			if state[e.ContentIndex] != "" {
				t.Fatalf("block %d started twice", e.ContentIndex)
			}
			if e.ContentIndex != len(e.Message.Content)-1 {
				t.Fatalf("block start index %d but content has %d blocks", e.ContentIndex, len(e.Message.Content))
			}
			state[e.ContentIndex] = "open"
		case "delta", "end":
			if state[e.ContentIndex] != "open" {
				t.Fatalf("%s for block %d in state %q", e.Type, e.ContentIndex, state[e.ContentIndex])
			}
			if phase == "end" {
				state[e.ContentIndex] = "ended"
			}
		}
	}
	if last.Type == EventDone {
		for idx, s := range state {
			if s != "ended" {
				t.Fatalf("block %d not ended before done", idx)
			}
		}
		if last.Reason != last.Message.StopReason {
			t.Fatalf("done reason %s vs message %s", last.Reason, last.Message.StopReason)
		}
	}
}

func count(evs []Event, typ EventType) int {
	n := 0
	for _, e := range evs {
		if e.Type == typ {
			n++
		}
	}
	return n
}

func terminal(evs []Event) Event { return evs[len(evs)-1] }

func stream(t *testing.T, p Provider, c Context, o Options) []Event {
	t.Helper()
	return collect(t, p.Stream(context.Background(), testModel(), c, o))
}
