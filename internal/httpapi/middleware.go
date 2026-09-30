package httpapi

import (
	"bufio"
	"cmp"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/tracing"
)

// statusRecorder captures the status code while still supporting streaming
// (Flush) and connection hijacking.
type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wrote {
		s.status, s.wrote = code, true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wrote {
		s.status, s.wrote = http.StatusOK, true
	}
	return s.ResponseWriter.Write(b)
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := s.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, errors.New("hijacking not supported")
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

var quietRoutes = map[string]bool{"GET /healthz": true, "GET /readyz": true, "GET /metrics": true}

// chain applies request IDs, security headers, panic recovery, access
// logging and metrics around the router.
func chain(mux *http.ServeMux, d Deps) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		reqID := httpx.NewID(12)
		r, span := startSpan(r, reqID)
		r = r.WithContext(httpx.WithRequestID(r.Context(), reqID))

		h := w.Header()
		h.Set("X-Request-ID", reqID)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "DENY")

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		d.Metrics.InFlight().Inc()
		defer func() {
			d.Metrics.InFlight().Dec()
			if p := recover(); p != nil {
				if p == http.ErrAbortHandler {
					panic(p)
				}
				d.Log.ErrorContext(r.Context(), "panic serving request",
					"panic", p, "request_id", reqID, "stack", string(debug.Stack()))
				if !rec.wrote {
					httpx.Error(rec, http.StatusInternalServerError, "internal", "Something went wrong")
				}
				rec.status = http.StatusInternalServerError
			}
			// ServeMux sets r.Pattern on the request it routes; it is empty
			// for unmatched paths, which keeps metric labels bounded.
			elapsed := time.Since(start)
			if rec.status >= 500 && httpx.ClientGone(r) {
				// The client went away first: not a server error (httpx.Internal).
				rec.status = httpx.StatusClientClosedRequest
			}
			endSpan(span, r.Pattern, rec.status)
			d.Metrics.ObserveHTTP(r.Method, r.Pattern, rec.status, elapsed)
			level := slog.LevelInfo
			if quietRoutes[r.Pattern] {
				level = slog.LevelDebug
			}
			d.Log.Log(r.Context(), level, "http request",
				"method", r.Method, "route", r.Pattern, "status", rec.status,
				"duration_ms", elapsed.Milliseconds(), "request_id", reqID,
				"client_ip", httpx.ClientIP(r, d.Config.TrustedProxies))
		}()
		mux.ServeHTTP(rec, r)
	})
}

// startSpan starts the request's server span (none for health checks and
// metrics). The W3C trace context of the request continues its trace,
// except on public-agent and widget routes: their callers are anonymous, so
// they start a new trace and can't make Grounded sample (or not) at will.
func startSpan(r *http.Request, reqID string) (*http.Request, trace.Span) {
	if quietRoutes["GET "+r.URL.Path] {
		return r, trace.SpanFromContext(r.Context()) // a no-op span
	}
	ctx := r.Context()
	if observability.RouteGroup(r.URL.Path) != observability.GroupPublic {
		ctx = tracing.ExtractHeader(ctx, r.Header)
	}
	// Named by method until routed; endSpan names it by route pattern.
	ctx, span := tracing.StartKind(ctx, r.Method, trace.SpanKindServer,
		attribute.String("http.request.method", r.Method), attribute.String("grounded.request_id", reqID))
	return r.WithContext(ctx), span
}

// endSpan names the span by the matched route pattern (never the raw path,
// which holds IDs) and records the status.
func endSpan(span trace.Span, pattern string, status int) {
	if !span.IsRecording() {
		span.End()
		return
	}
	name := cmp.Or(pattern, "unmatched")
	route := name
	if _, path, ok := strings.Cut(name, " "); ok {
		route = path
	}
	span.SetName(name)
	span.SetAttributes(attribute.String("http.route", route), attribute.Int("http.response.status_code", status))
	if status >= 500 {
		tracing.Fail(span, strconv.Itoa(status))
	}
	span.End()
}
