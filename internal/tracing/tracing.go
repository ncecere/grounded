// Package tracing sets up OpenTelemetry tracing (docs/operations/tracing.md)
// and holds the small helpers every instrumented package uses.
//
// Tracing is off unless OTEL_EXPORTER_OTLP_ENDPOINT is set: Setup then
// installs nothing, the global tracer provider stays OpenTelemetry's no-op
// one (no exporter, no goroutines) and no trace context is read from or
// written to requests. With an endpoint, spans are batched to an OTLP/HTTP
// collector (Tempo, Jaeger, an OpenTelemetry Collector) and W3C trace
// context (traceparent, tracestate) is read and written.
//
// Spans never carry prompts, answers, questions, document content or
// people's email addresses: only IDs, names from the catalog (models, tools,
// MCP servers), counts, sizes, durations and outcomes.
package tracing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/buildinfo"
)

// ScopeName is the instrumentation scope of every Grounded span.
const ScopeName = "github.com/ncecere/grounded"

// Tracer is Grounded's tracer from the global provider (a no-op until Setup
// installs one).
func Tracer() trace.Tracer { return otel.Tracer(ScopeName) }

// Start starts an internal span.
func Start(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	return Tracer().Start(ctx, name, trace.WithAttributes(attrs...))
}

// StartKind starts a span of the given kind (client, server, consumer).
func StartKind(ctx context.Context, name string, kind trace.SpanKind, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	return Tracer().Start(ctx, name, trace.WithSpanKind(kind), trace.WithAttributes(attrs...))
}

// End ends a span, marking it failed when err is set. Only the error's type
// is recorded (errors can quote user input): error.type, as in the semantic
// conventions.
func End(span trace.Span, err error) {
	if err != nil {
		Fail(span, fmt.Sprintf("%T", err))
	}
	span.End()
}

// Fail marks a span failed with an error class (a short, bounded string
// such as "timeout" or a gateway error kind).
func Fail(span trace.Span, class string) {
	span.SetAttributes(attribute.String("error.type", class))
	span.SetStatus(codes.Error, class)
}

// Options are the exporter settings (config.Tracing, validated there; this
// package can't import config, which imports the crawler).
type Options struct {
	// Endpoint is the OTLP/HTTP base URL; empty turns tracing off.
	Endpoint string
	// Headers are sent with every export; they may carry a token.
	Headers     map[string]string
	ServiceName string
	Sampler     string
	SamplerArg  float64
	// Mode is the process mode (serve, api, worker), a resource attribute.
	Mode string
}

// Setup installs the global tracer provider and propagator when tracing is
// configured. shutdown flushes buffered spans; it is a no-op when tracing
// is off.
func Setup(ctx context.Context, cfg Options, log *slog.Logger) (shutdown func(context.Context) error, err error) {
	noop := func(context.Context) error { return nil }
	if cfg.Endpoint == "" {
		return noop, nil
	}
	opts := []otlptracehttp.Option{otlptracehttp.WithEndpointURL(cfg.Endpoint + "/v1/traces")}
	if len(cfg.Headers) > 0 {
		opts = append(opts, otlptracehttp.WithHeaders(cfg.Headers))
	}
	exp, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		return noop, fmt.Errorf("tracing: OTLP exporter: %w", err)
	}
	res, err := resource.New(ctx, resource.WithFromEnv(), resource.WithTelemetrySDK(), resource.WithAttributes(
		attribute.String("service.name", cfg.ServiceName),
		attribute.String("service.version", buildinfo.Version),
		attribute.String("grounded.mode", cfg.Mode),
		attribute.String("grounded.commit", buildinfo.Commit),
	))
	if err != nil && !errors.Is(err, resource.ErrPartialResource) {
		return noop, fmt.Errorf("tracing: resource: %w", err)
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(Sampler(cfg.Sampler, cfg.SamplerArg)),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	otel.SetErrorHandler(&errorHandler{log: log})
	// The endpoint is logged without the headers, which may carry a token.
	log.Info("tracing on", "endpoint", cfg.Endpoint, "sampler", cfg.Sampler, "sampler_arg", cfg.SamplerArg)
	return tp.Shutdown, nil
}

// Sampler builds an OTEL_TRACES_SAMPLER sampler (config validated the name).
func Sampler(name string, arg float64) sdktrace.Sampler {
	ratio := sdktrace.TraceIDRatioBased(arg)
	switch name {
	case "always_on":
		return sdktrace.AlwaysSample()
	case "always_off":
		return sdktrace.NeverSample()
	case "traceidratio":
		return ratio
	case "parentbased_always_on":
		return sdktrace.ParentBased(sdktrace.AlwaysSample())
	case "parentbased_always_off":
		return sdktrace.ParentBased(sdktrace.NeverSample())
	}
	return sdktrace.ParentBased(ratio)
}

// errorHandler logs export failures at most once a minute, so a collector
// that is down doesn't flood the logs.
type errorHandler struct {
	log  *slog.Logger
	mu   sync.Mutex
	last time.Time
}

func (h *errorHandler) Handle(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if time.Since(h.last) < time.Minute {
		return
	}
	h.last = time.Now()
	h.log.Warn("tracing: export failed (repeats are not logged for a minute)", "err", err)
}
