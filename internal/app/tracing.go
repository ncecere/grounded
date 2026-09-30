package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/tracing"
)

// tracingFlushTimeout bounds the flush of buffered spans at shutdown.
const tracingFlushTimeout = 5 * time.Second

// startTracing installs OpenTelemetry tracing when OTEL_EXPORTER_OTLP_ENDPOINT
// is set (docs/operations/tracing.md). stop flushes buffered spans; call it
// after the servers and the worker have stopped. A failure to set tracing up
// is logged, not fatal: traces are diagnostics.
func startTracing(ctx context.Context, cfg config.Tracing, mode string, log *slog.Logger) (stop func()) {
	shutdown, err := tracing.Setup(ctx, tracing.Options{
		Endpoint: cfg.Endpoint, Protocol: cfg.Protocol, Headers: cfg.Headers, ServiceName: cfg.ServiceName,
		Sampler: cfg.Sampler, SamplerArg: cfg.SamplerArg, Mode: mode,
	}, log)
	if err != nil {
		log.Error("tracing is off: it could not be set up", "err", err)
	}
	return func() {
		fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), tracingFlushTimeout)
		defer cancel()
		if err := shutdown(fctx); err != nil {
			log.Warn("tracing: flushing spans at shutdown failed", "err", err)
		}
	}
}
