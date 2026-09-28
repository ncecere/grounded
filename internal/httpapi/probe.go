package httpapi

import (
	"net/http"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// probeRequest prepares an admin connection or model test (roadmap E12):
// its requests open a new connection, so the timings cover DNS, connect and
// TLS, and the first request's phases are traced.
func probeRequest(r *http.Request) *http.Request {
	ctx, _ := gateway.WithTrace(gateway.FreshConnection(r.Context()))
	return r.WithContext(ctx)
}

// probeTimings are the traced phases of a test prepared by probeRequest
// (nil when no request was sent, for example when the connection's own
// request limit refused it).
func probeTimings(r *http.Request) *apitypes.RequestTimings {
	tr := gateway.TraceFrom(r.Context())
	if tr == nil {
		return nil
	}
	t := tr.Timings()
	if t == (gateway.Timings{}) {
		return nil
	}
	return &apitypes.RequestTimings{
		DnsMs: millis(t.DNS), ConnectMs: millis(t.Connect), TlsMs: millis(t.TLS),
		FirstByteMs: millis(t.FirstByte), Reused: t.Reused,
	}
}

// millis is d in milliseconds with two decimals.
func millis(d time.Duration) float64 {
	return float64(d.Round(10*time.Microsecond)) / float64(time.Millisecond)
}
