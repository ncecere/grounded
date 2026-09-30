package tracing

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// W3C trace context keys: HTTP headers, MCP _meta keys (protocol
// 2026-07-28) and River job metadata keys alike.
const (
	KeyTraceparent = "traceparent"
	KeyTracestate  = "tracestate"
)

// InjectHeader writes ctx's trace context into h (nothing when tracing is
// off or ctx has no span).
func InjectHeader(ctx context.Context, h http.Header) {
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(h))
}

// ExtractHeader returns ctx with the remote trace context from h, if any.
func ExtractHeader(ctx context.Context, h http.Header) context.Context {
	return otel.GetTextMapPropagator().Extract(ctx, propagation.HeaderCarrier(h))
}

// InjectMeta writes ctx's trace context into an MCP _meta map (or River job
// metadata): traceparent and tracestate as strings. It returns meta
// unchanged when there is nothing to write, and a new map (never nil) when
// there is and meta was nil.
func InjectMeta(ctx context.Context, meta map[string]any) map[string]any {
	c := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, c)
	if len(c) == 0 {
		return meta
	}
	if meta == nil {
		meta = map[string]any{}
	}
	for k, v := range c {
		meta[k] = v
	}
	return meta
}

// ExtractMeta returns ctx with the remote trace context from an MCP _meta
// map, if it has one. Only string traceparent and tracestate values are read.
func ExtractMeta(ctx context.Context, meta map[string]any) context.Context {
	c := propagation.MapCarrier{}
	for _, k := range []string{KeyTraceparent, KeyTracestate} {
		if s, ok := meta[k].(string); ok && s != "" {
			c[k] = s
		}
	}
	if len(c) == 0 {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, c)
}

// InjectJSON adds ctx's trace context to a JSON object (River job metadata):
// raw unchanged when there is nothing to add or raw is not an object.
func InjectJSON(ctx context.Context, raw []byte) []byte {
	if !trace.SpanContextFromContext(ctx).IsValid() {
		return raw
	}
	m := map[string]any{}
	if len(raw) > 0 && json.Unmarshal(raw, &m) != nil {
		return raw
	}
	before := len(m)
	m = InjectMeta(ctx, m)
	if len(m) == before {
		return raw
	}
	out, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return out
}

// ExtractJSON returns ctx with the trace context of a JSON object, if any.
func ExtractJSON(ctx context.Context, raw []byte) context.Context {
	var m map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &m) != nil {
		return ctx
	}
	return ExtractMeta(ctx, m)
}

// Transport wraps an HTTP RoundTripper with a client span per request
// (method, host and status: never the path, query or body), which ends when
// the response headers arrive. With inject,
// the request carries the trace context (traceparent) to the server: for
// servers Grounded is configured to trust (model gateways, MCP servers),
// never for the crawler, which would hand trace IDs to every web site.
//
// It wraps the RoundTripper, not the dialer, so SSRF guards in the wrapped
// transport or its dialer still see every request and connection.
func Transport(next http.RoundTripper, inject bool) http.RoundTripper {
	if next == nil {
		next = http.DefaultTransport
	}
	return &transport{next: next, inject: inject}
}

type transport struct {
	next   http.RoundTripper
	inject bool
}

func (t *transport) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx, span := StartKind(req.Context(), "HTTP "+req.Method, trace.SpanKindClient,
		attribute.String("http.request.method", req.Method), attribute.String("server.address", req.URL.Hostname()))
	if !span.IsRecording() && !t.inject {
		span.End()
		return t.next.RoundTrip(req)
	}
	if t.inject {
		// RoundTrippers must not change the caller's request.
		req = req.Clone(ctx)
		InjectHeader(ctx, req.Header)
	}
	res, err := t.next.RoundTrip(req)
	if err != nil {
		End(span, err)
		return nil, err
	}
	span.SetAttributes(attribute.Int("http.response.status_code", res.StatusCode))
	if res.StatusCode >= 400 {
		Fail(span, strconv.Itoa(res.StatusCode))
	}
	span.End()
	return res, nil
}
