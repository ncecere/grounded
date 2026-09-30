package tracing_test

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"

	"github.com/ncecere/grounded/internal/tracing"
	"github.com/ncecere/grounded/internal/tracing/tracingtest"
)

// Off (no endpoint): nothing is installed, so spans are no-ops and no trace
// context is written.
func TestSetupOff(t *testing.T) {
	before := otel.GetTracerProvider()
	shutdown, err := tracing.Setup(context.Background(), tracing.Options{}, slog.New(slog.DiscardHandler))
	if err != nil || shutdown(context.Background()) != nil {
		t.Fatal(err)
	}
	if otel.GetTracerProvider() != before {
		t.Fatal("a tracer provider was installed without an endpoint")
	}
	if _, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider); ok {
		t.Fatal("the SDK provider is installed")
	}
	ctx, span := tracing.Start(context.Background(), "x")
	defer span.End()
	if span.IsRecording() {
		t.Fatal("a span records with tracing off")
	}
	h := http.Header{}
	tracing.InjectHeader(ctx, h)
	if len(h) != 0 {
		t.Fatalf("headers written with tracing off: %v", h)
	}
}

// On: the SDK provider with the configured sampler, and W3C propagation.
func TestSetupOn(t *testing.T) {
	var logs bytes.Buffer
	shutdown, err := tracing.Setup(context.Background(), tracing.Options{
		Endpoint: "http://127.0.0.1:9", Headers: map[string]string{"Authorization": "Bearer never-logged"},
		ServiceName: "grounded", Sampler: "parentbased_traceidratio", SamplerArg: 1, Mode: "api",
	}, slog.New(slog.NewTextHandler(&logs, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		otel.SetTracerProvider(noop.NewTracerProvider())
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator())
	})
	if _, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider); !ok {
		t.Fatalf("provider = %T", otel.GetTracerProvider())
	}
	ctx, span := tracing.Start(context.Background(), "x")
	h := http.Header{}
	tracing.InjectHeader(ctx, h)
	span.End()
	if !strings.HasPrefix(h.Get("traceparent"), "00-"+span.SpanContext().TraceID().String()) {
		t.Fatalf("traceparent = %q", h.Get("traceparent"))
	}
	if strings.Contains(logs.String(), "never-logged") || !strings.Contains(logs.String(), "tracing on") {
		t.Fatalf("logs = %s", logs.String())
	}
	sctx, cancel := context.WithTimeout(context.Background(), 1)
	defer cancel()
	_ = shutdown(sctx) // the collector isn't there; shutdown must still return
}

func TestSampler(t *testing.T) {
	for name, want := range map[string]string{
		"always_on": "AlwaysOnSampler", "always_off": "AlwaysOffSampler", "traceidratio": "TraceIDRatioBased{0.5}",
		"parentbased_always_on": "ParentBased{root:AlwaysOnSampler", "parentbased_traceidratio": "ParentBased{root:TraceIDRatioBased{0.5}",
	} {
		if got := tracing.Sampler(name, 0.5).Description(); !strings.HasPrefix(got, want) {
			t.Errorf("%s: %s", name, got)
		}
	}
}

func TestJSONMetadataRoundTrip(t *testing.T) {
	tracingtest.RecordSpans(t)
	ctx, span := tracing.Start(context.Background(), "enqueue")
	defer span.End()
	raw := tracing.InjectJSON(ctx, []byte(`{"periodic":false}`))
	if !bytes.Contains(raw, []byte(`"traceparent"`)) || !bytes.Contains(raw, []byte(`"periodic":false`)) {
		t.Fatalf("metadata = %s", raw)
	}
	got := trace.SpanContextFromContext(tracing.ExtractJSON(context.Background(), raw))
	if got.TraceID() != span.SpanContext().TraceID() || got.SpanID() != span.SpanContext().SpanID() || !got.IsRemote() {
		t.Fatalf("extracted %v", got)
	}
	if out := tracing.InjectJSON(context.Background(), []byte(`{}`)); string(out) != `{}` {
		t.Fatalf("no span: %s", out)
	}
	if out := tracing.InjectJSON(ctx, []byte(`[1]`)); string(out) != `[1]` {
		t.Fatalf("not an object: %s", out)
	}
}

// The transport records a client span; it writes traceparent only when told.
func TestTransport(t *testing.T) {
	spans := tracingtest.RecordSpans(t)
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.Header.Get("traceparent"))
		w.WriteHeader(http.StatusTeapot)
	}))
	defer srv.Close()
	ctx, parent := tracing.Start(context.Background(), "parent")
	for _, inject := range []bool{true, false} {
		req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/private/path?q=secret", nil)
		res, err := (&http.Client{Transport: tracing.Transport(nil, inject)}).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if req.Header.Get("traceparent") != "" {
			t.Fatal("the caller's request was changed")
		}
	}
	parent.End()
	if len(got) != 2 || !strings.Contains(got[0], parent.SpanContext().TraceID().String()) || got[1] != "" {
		t.Fatalf("traceparent headers = %q", got)
	}
	sp := spans.Find(t, "HTTP GET", nil)
	if sp.Parent().SpanID() != parent.SpanContext().SpanID() || sp.SpanKind() != trace.SpanKindClient || sp.Status().Description != "418" {
		t.Fatalf("span = %+v", sp)
	}
	for _, a := range sp.Attributes() {
		if strings.Contains(a.Value.Emit(), "secret") || strings.Contains(a.Value.Emit(), "/private") {
			t.Fatalf("attribute %s = %s", a.Key, a.Value.Emit())
		}
	}
}

func TestLogHandler(t *testing.T) {
	tracingtest.RecordSpans(t)
	var buf bytes.Buffer
	log := slog.New(tracing.LogHandler(slog.NewJSONHandler(&buf, nil))).With("mode", "api")
	ctx, span := tracing.Start(context.Background(), "request")
	log.InfoContext(ctx, "inside")
	span.End()
	log.InfoContext(context.Background(), "outside")
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	want := `"trace_id":"` + span.SpanContext().TraceID().String() + `","span_id":"` + span.SpanContext().SpanID().String() + `"`
	if len(lines) != 2 || !strings.Contains(lines[0], want) || strings.Contains(lines[1], "trace_id") {
		t.Fatalf("logs = %s", buf.String())
	}
}

// The MCP middlewares: the client writes trace context into _meta; the
// server continues it in a span named by the method and a known tool.
func TestMCPMiddlewares(t *testing.T) {
	spans := tracingtest.RecordSpans(t)
	var meta map[string]any
	srv := mcp.NewServer(&mcp.Implementation{Name: "s", Version: "1"}, nil)
	srv.AddReceivingMiddleware(tracing.MCPServerMiddleware("echo"))
	type in struct{}
	mcp.AddTool(srv, &mcp.Tool{Name: "echo"}, func(ctx context.Context, req *mcp.CallToolRequest, _ in) (*mcp.CallToolResult, any, error) {
		meta = req.Params.GetMeta()
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "ok"}}}, nil, nil
	})
	mcp.AddTool(srv, &mcp.Tool{Name: "other"}, func(context.Context, *mcp.CallToolRequest, in) (*mcp.CallToolResult, any, error) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "ok"}}}, nil, nil
	})
	ct, st := mcp.NewInMemoryTransports()
	ss, err := srv.Connect(t.Context(), st, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "c", Version: "1"}, nil)
	client.AddSendingMiddleware(tracing.MCPClientMiddleware())
	cs, err := client.Connect(t.Context(), ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()

	ctx, parent := tracing.Start(context.Background(), "agent")
	for _, name := range []string{"echo", "other"} {
		if _, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: name}); err != nil {
			t.Fatal(err)
		}
	}
	parent.End()
	tp, _ := meta["traceparent"].(string)
	if !strings.Contains(tp, parent.SpanContext().TraceID().String()) {
		t.Fatalf("_meta = %v", meta)
	}
	sp := spans.Find(t, "tools/call echo", nil)
	if sp.SpanContext().TraceID() != parent.SpanContext().TraceID() || sp.Parent().SpanID() != parent.SpanContext().SpanID() {
		t.Fatalf("server span not under the caller: %v", sp.Parent())
	}
	spans.Find(t, "tools/call unknown", nil) // a tool outside the list isn't named
}
