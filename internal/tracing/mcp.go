package tracing

import (
	"context"
	"reflect"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// MCP trace context (protocol 2026-07-28): a request's params._meta carries
// traceparent and tracestate, as W3C trace context. The Go SDK (v1.8) passes
// _meta through but doesn't read or write trace context itself, so these
// middlewares do.

// MCPClientMiddleware is a sending middleware that writes the caller's trace
// context into every request's _meta (the HTTP request carries it too, in
// headers; see Transport).
func MCPClientMiddleware() mcp.Middleware {
	return func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			if p := params(req); p != nil && trace.SpanContextFromContext(ctx).IsValid() {
				meta := map[string]any{}
				for k, v := range p.GetMeta() {
					meta[k] = v
				}
				if meta = InjectMeta(ctx, meta); len(meta) > 0 {
					p.SetMeta(meta)
				}
			}
			return next(ctx, method, req)
		}
	}
}

// MCPServerMiddleware is a receiving middleware that runs each request in a
// server span ("tools/call search"): the method and, for tools/call of one
// of tools, the tool's name (another name is recorded as "unknown": it came
// from the client); never the arguments or the result. A traceparent in the
// request's _meta continues the caller's trace (linked to the HTTP
// request's span); when it names the trace the HTTP request already belongs
// to (a client that sends both), the span stays under the HTTP request's.
func MCPServerMiddleware(tools ...string) mcp.Middleware {
	known := map[string]bool{}
	for _, t := range tools {
		known[t] = true
	}
	return func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			parent, opts := ctx, []trace.SpanStartOption{trace.WithSpanKind(trace.SpanKindServer)}
			if p := params(req); p != nil {
				rsc := trace.SpanContextFromContext(ExtractMeta(context.Background(), p.GetMeta()))
				if cur := trace.SpanContextFromContext(ctx); rsc.IsValid() && rsc.TraceID() != cur.TraceID() {
					parent = trace.ContextWithRemoteSpanContext(ctx, rsc)
					if cur.IsValid() {
						opts = append(opts, trace.WithLinks(trace.Link{SpanContext: cur}))
					}
				}
			}
			name, attrs := method, []attribute.KeyValue{attribute.String("mcp.method.name", method)}
			if call, ok := req.GetParams().(*mcp.CallToolParamsRaw); ok && call != nil {
				tool := "unknown"
				if known[call.Name] {
					tool = call.Name
				}
				name += " " + tool
				attrs = append(attrs, attribute.String("gen_ai.tool.name", tool))
			}
			ctx, span := Tracer().Start(parent, name, append(opts, trace.WithAttributes(attrs...))...)
			res, err := next(ctx, method, req)
			if r, ok := res.(*mcp.CallToolResult); ok && err == nil && r != nil && r.IsError {
				Fail(span, "tool_error")
			}
			End(span, err)
			return res, err
		}
	}
}

// params returns a request's params, or nil (none, or a typed nil pointer).
func params(req mcp.Request) mcp.Params {
	p := req.GetParams()
	if p == nil {
		return nil
	}
	if v := reflect.ValueOf(p); v.Kind() == reflect.Pointer && v.IsNil() {
		return nil
	}
	return p
}
