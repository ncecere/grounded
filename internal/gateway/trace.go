package gateway

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"time"
)

// Timings are the phases of one HTTP exchange, measured with
// net/http/httptrace (roadmap E12). They show where a slow call spends its
// time: name resolution, TCP connect, the TLS handshake, or the server.
type Timings struct {
	DNS     time.Duration // resolving the host name (0 for an IP address or a reused connection)
	Connect time.Duration // TCP connect (to the proxy, when one is used)
	TLS     time.Duration // TLS handshake
	// FirstByte is from the request being sent to the first byte of the
	// response: the server's (for a model, the proxy's and model's) time.
	FirstByte time.Duration
	// Reused reports that an idle keep-alive connection was reused, so there
	// was no DNS, connect or TLS phase.
	Reused bool
}

// String is a compact summary such as "DNS 3ms, connect 1ms, TLS 12ms, first byte 640ms".
func (t Timings) String() string {
	var parts []string
	if t.Reused {
		parts = append(parts, "reused connection")
	}
	add := func(name string, d time.Duration) {
		if d > 0 {
			parts = append(parts, name+" "+FormatDuration(d))
		}
	}
	add("DNS", t.DNS)
	add("connect", t.Connect)
	add("TLS", t.TLS)
	add("first byte", t.FirstByte)
	return strings.Join(parts, ", ")
}

// FormatDuration rounds d for people: 0.4ms, 12ms, 4.41s.
func FormatDuration(d time.Duration) string {
	switch {
	case d < 10*time.Millisecond:
		return d.Round(100 * time.Microsecond).String()
	case d < time.Second:
		return d.Round(time.Millisecond).String()
	default:
		return d.Round(10 * time.Millisecond).String()
	}
}

// Trace records the phases of the first HTTP exchange made with a context
// from WithTrace. Later exchanges (a second request of a multi-request test)
// are ignored, so the result describes one connection from start to end.
type Trace struct {
	mu                  sync.Mutex
	start               time.Time
	dnsStart, dnsDone   time.Time
	connStart, connDone time.Time
	tlsStart, tlsDone   time.Time
	wrote, firstByte    time.Time
	reused, gotConn     bool
	finished            bool   // the first exchange got its response
	dnsHost             string // the name looked up (the proxy's, when one is used)
}

type traceKey struct{}

// WithTrace returns a context whose HTTP requests are traced, and the trace.
// TraceFrom finds the trace again from the context.
func WithTrace(ctx context.Context) (context.Context, *Trace) {
	t := &Trace{}
	return context.WithValue(t.attach(ctx), traceKey{}, t), t
}

// TraceFrom returns the trace attached with WithTrace, or nil.
func TraceFrom(ctx context.Context) *Trace {
	t, _ := ctx.Value(traceKey{}).(*Trace)
	return t
}

// attach adds the trace's hooks to ctx; hooks already on ctx still run.
func (t *Trace) attach(ctx context.Context) context.Context {
	return httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
		GetConn: func(string) {
			t.at(func() {
				if t.start.IsZero() {
					t.start = time.Now()
				}
			})
		},
		DNSStart: func(i httptrace.DNSStartInfo) {
			t.at(func() {
				setOnce(&t.dnsStart)
				if t.dnsHost == "" {
					t.dnsHost = i.Host
				}
			})
		},
		DNSDone: func(httptrace.DNSDoneInfo) { t.at(func() { setOnce(&t.dnsDone) }) },
		ConnectStart: func(string, string) {
			t.at(func() { setOnce(&t.connStart) })
		},
		ConnectDone: func(_, _ string, err error) {
			if err == nil {
				t.at(func() { setOnce(&t.connDone) })
			}
		},
		TLSHandshakeStart: func() { t.at(func() { setOnce(&t.tlsStart) }) },
		TLSHandshakeDone: func(_ tls.ConnectionState, err error) {
			if err == nil {
				t.at(func() { setOnce(&t.tlsDone) })
			}
		},
		GotConn: func(i httptrace.GotConnInfo) {
			t.at(func() {
				if !t.gotConn {
					t.gotConn, t.reused = true, i.Reused
				}
			})
		},
		WroteRequest: func(httptrace.WroteRequestInfo) { t.at(func() { setOnce(&t.wrote) }) },
		GotFirstResponseByte: func() {
			t.at(func() { setOnce(&t.firstByte); t.finished = true })
		},
	})
}

// at runs f under the lock unless the first exchange is complete.
func (t *Trace) at(f func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.finished {
		f()
	}
}

func setOnce(ts *time.Time) {
	if ts.IsZero() {
		*ts = time.Now()
	}
}

func span(from, to time.Time) time.Duration {
	if from.IsZero() || to.IsZero() || to.Before(from) {
		return 0
	}
	return to.Sub(from)
}

// Timings returns the completed phases (a nil trace has none).
func (t *Trace) Timings() Timings {
	if t == nil {
		return Timings{}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return Timings{
		DNS:       span(t.dnsStart, t.dnsDone),
		Connect:   span(t.connStart, t.connDone),
		TLS:       span(t.tlsStart, t.tlsDone),
		FirstByte: span(t.wrote, t.firstByte),
		Reused:    t.reused,
	}
}

// Phases in progress when a request failed.
const (
	phaseDNS      = "DNS lookup"
	phaseConnect  = "connect"
	phaseTLS      = "TLS handshake"
	phaseResponse = "waiting for the response"
	phaseBody     = "reading the response"
)

// pending names the phase that had started but not finished ("" if none).
func (t *Trace) pending() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	switch {
	case !t.firstByte.IsZero():
		return phaseBody
	case !t.wrote.IsZero():
		return phaseResponse
	case !t.tlsStart.IsZero() && t.tlsDone.IsZero():
		return phaseTLS
	case !t.connStart.IsZero() && t.connDone.IsZero():
		return phaseConnect
	case !t.dnsStart.IsZero() && t.dnsDone.IsZero():
		return phaseDNS
	case !t.connDone.IsZero() && t.tlsStart.IsZero() && !t.gotConn:
		return phaseConnect // e.g. waiting for a proxy's CONNECT reply
	}
	return ""
}

func (t *Trace) lookedUp() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.dnsHost
}

func (t *Trace) tlsStarted() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return !t.tlsStart.IsZero()
}

func (t *Trace) connected() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return !t.connDone.IsZero()
}

type freshKey struct{}

// FreshConnection makes requests on ctx open a new connection instead of
// reusing an idle one, so a test measures DNS, connect and TLS every time.
func FreshConnection(ctx context.Context) context.Context {
	return context.WithValue(ctx, freshKey{}, true)
}

// httpClient is the client for a request on ctx: c.HTTP, or a copy with a
// keep-alive-free transport under FreshConnection.
func (c *Client) httpClient(ctx context.Context) *http.Client {
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{}
	}
	if fresh, _ := ctx.Value(freshKey{}).(bool); !fresh {
		return hc
	}
	base := hc.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	t, ok := base.(*http.Transport)
	if !ok {
		return hc
	}
	cp := *hc
	nt := t.Clone()
	nt.DisableKeepAlives = true
	cp.Transport = nt
	return &cp
}

// proxyFor returns the host of the HTTP proxy hc uses for req ("" if none).
func proxyFor(hc *http.Client, req *http.Request) string {
	base := hc.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	t, ok := base.(*http.Transport)
	if !ok || t.Proxy == nil {
		return ""
	}
	u, err := t.Proxy(req)
	if err != nil || u == nil {
		return ""
	}
	return u.Host
}

// timeoutMessage describes a timeout: how long, in which phase, and the
// phases that did complete.
func timeoutMessage(t *Trace, elapsed time.Duration, host string) string {
	secs := strings.TrimSuffix(fmt.Sprintf("%.1f", elapsed.Seconds()), ".0")
	msg := "timed out after " + secs + "s"
	phase := t.pending()
	if h := t.lookedUp(); h != "" {
		host = h
	}
	if phase == phaseDNS && host != "" {
		phase = "DNS lookup of " + host
	}
	done := t.Timings().String()
	switch {
	case phase != "" && done != "":
		msg += fmt.Sprintf(" (%s; %s)", phase, done)
	case phase != "":
		msg += " (" + phase + ")"
	case done != "":
		msg += " (" + done + ")"
	}
	return msg
}
