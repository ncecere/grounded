package tracing

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel/trace"
)

// LogHandler adds trace_id and span_id to records logged with a context
// carrying a sampled span (…Context logging calls within a traced request
// or job), so a log line in Loki links to its trace. Without tracing no span
// is ever sampled and records pass through unchanged.
func LogHandler(h slog.Handler) slog.Handler { return &logHandler{Handler: h} }

type logHandler struct{ slog.Handler }

func (h *logHandler) Handle(ctx context.Context, r slog.Record) error {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() && sc.IsSampled() {
		r = r.Clone()
		r.AddAttrs(slog.String("trace_id", sc.TraceID().String()), slog.String("span_id", sc.SpanID().String()))
	}
	return h.Handler.Handle(ctx, r)
}

func (h *logHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &logHandler{Handler: h.Handler.WithAttrs(attrs)}
}

func (h *logHandler) WithGroup(name string) slog.Handler {
	return &logHandler{Handler: h.Handler.WithGroup(name)}
}
