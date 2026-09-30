// Package tracingtest records spans in memory for tests.
package tracingtest

import (
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

// Spans records the spans of a test in memory (tracing turned on with
// every trace sampled, as with OTEL_TRACES_SAMPLER=always_on). The tracer
// provider is global: other tests' spans may be recorded too, so look
// spans up by trace.
type Spans struct{ rec *tracetest.SpanRecorder }

// RecordSpans installs an in-memory tracer provider and the W3C trace
// context propagator until the test ends. Tests using it must not run in
// parallel with each other.
func RecordSpans(t testing.TB) *Spans {
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec), sdktrace.WithSampler(sdktrace.AlwaysSample()))
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTracerProvider(noop.NewTracerProvider())
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator())
		_ = tp.Shutdown(t.Context())
	})
	return &Spans{rec: rec}
}

// Ended returns the ended spans.
func (s *Spans) Ended() []sdktrace.ReadOnlySpan { return s.rec.Ended() }

// Find waits up to 5 seconds for an ended span named name (the first one
// matching accept, when set) and returns it.
func (s *Spans) Find(t testing.TB, name string, accept func(sdktrace.ReadOnlySpan) bool) sdktrace.ReadOnlySpan {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		for _, sp := range s.rec.Ended() {
			if sp.Name() == name && (accept == nil || accept(sp)) {
				return sp
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("no span %q; spans: %s", name, s.names())
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// Trace returns the ended spans of one trace.
func (s *Spans) Trace(id trace.TraceID) []sdktrace.ReadOnlySpan {
	var out []sdktrace.ReadOnlySpan
	for _, sp := range s.rec.Ended() {
		if sp.SpanContext().TraceID() == id {
			out = append(out, sp)
		}
	}
	return out
}

func (s *Spans) names() string {
	var names []string
	for _, sp := range s.rec.Ended() {
		names = append(names, sp.Name())
	}
	return strings.Join(names, ", ")
}

// Tree renders a trace's spans as an indented tree (parents first), for
// failure messages and assertions.
func Tree(spans []sdktrace.ReadOnlySpan) string {
	children := map[trace.SpanID][]sdktrace.ReadOnlySpan{}
	ids := map[trace.SpanID]bool{}
	for _, sp := range spans {
		ids[sp.SpanContext().SpanID()] = true
	}
	var roots []sdktrace.ReadOnlySpan
	for _, sp := range spans {
		if p := sp.Parent().SpanID(); ids[p] {
			children[p] = append(children[p], sp)
		} else {
			roots = append(roots, sp)
		}
	}
	for _, cs := range children {
		sort.Slice(cs, func(i, j int) bool { return cs[i].StartTime().Before(cs[j].StartTime()) })
	}
	var b strings.Builder
	var walk func(sp sdktrace.ReadOnlySpan, depth int)
	walk = func(sp sdktrace.ReadOnlySpan, depth int) {
		fmt.Fprintf(&b, "%s%s\n", strings.Repeat("  ", depth), sp.Name())
		for _, c := range children[sp.SpanContext().SpanID()] {
			walk(c, depth+1)
		}
	}
	for _, r := range roots {
		walk(r, 0)
	}
	return b.String()
}
