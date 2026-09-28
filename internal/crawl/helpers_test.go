package crawl

import (
	"context"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"

	"golang.org/x/net/dns/dnsmessage"
)

// fakeDNS is an in-process DNS server reached through net.Resolver.Dial over
// net.Pipe (TCP framing), so resolver tests exercise the real *net.Resolver
// injection path without touching the network.
type fakeDNS struct {
	mu      sync.Mutex
	queries map[string]int // A queries per name (without trailing dot)
	answer  func(name string, n int) []netip.Addr
}

func newFakeDNS(answer func(name string, n int) []netip.Addr) *fakeDNS {
	return &fakeDNS{queries: map[string]int{}, answer: answer}
}

// staticDNS maps names to fixed answers.
func staticDNS(m map[string][]string) *fakeDNS {
	return newFakeDNS(func(name string, _ int) []netip.Addr {
		var out []netip.Addr
		for _, s := range m[name] {
			out = append(out, netip.MustParseAddr(s))
		}
		return out
	})
}

func (d *fakeDNS) count(name string) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.queries[name]
}

func (d *fakeDNS) resolver() *net.Resolver {
	return &net.Resolver{PreferGo: true, Dial: func(context.Context, string, string) (net.Conn, error) {
		c1, c2 := net.Pipe()
		go d.serve(c2)
		return c1, nil
	}}
}

func (d *fakeDNS) serve(c net.Conn) {
	defer c.Close()
	for {
		var l [2]byte
		if _, err := io.ReadFull(c, l[:]); err != nil {
			return
		}
		msg := make([]byte, binary.BigEndian.Uint16(l[:]))
		if _, err := io.ReadFull(c, msg); err != nil {
			return
		}
		var p dnsmessage.Parser
		h, err := p.Start(msg)
		if err != nil {
			return
		}
		q, err := p.Question()
		if err != nil {
			return
		}
		name := strings.TrimSuffix(q.Name.String(), ".")
		d.mu.Lock()
		if q.Type == dnsmessage.TypeA {
			d.queries[name]++
		}
		n := d.queries[name]
		d.mu.Unlock()
		ips := d.answer(name, n)
		rcode := dnsmessage.RCodeSuccess
		if len(ips) == 0 {
			rcode = dnsmessage.RCodeNameError
		}
		b := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: h.ID, Response: true, Authoritative: true, RecursionDesired: h.RecursionDesired, RecursionAvailable: true, RCode: rcode})
		_ = b.StartQuestions()
		_ = b.Question(q)
		_ = b.StartAnswers()
		rh := dnsmessage.ResourceHeader{Name: q.Name, Class: dnsmessage.ClassINET, TTL: 60}
		for _, ip := range ips {
			switch {
			case q.Type == dnsmessage.TypeA && ip.Is4():
				rh.Type = dnsmessage.TypeA
				_ = b.AResource(rh, dnsmessage.AResource{A: ip.As4()})
			case q.Type == dnsmessage.TypeAAAA && ip.Is6():
				rh.Type = dnsmessage.TypeAAAA
				_ = b.AAAAResource(rh, dnsmessage.AAAAResource{AAAA: ip.As16()})
			}
		}
		out, err := b.Finish()
		if err != nil {
			return
		}
		binary.BigEndian.PutUint16(l[:], uint16(len(out)))
		if _, err := c.Write(append(l[:], out...)); err != nil {
			return
		}
	}
}

// routeDials sends every dial to srv, recording the (approved) addresses the
// fetcher asked for. This stands in for "the public internet".
type dialLog struct {
	mu    sync.Mutex
	addrs []string
}

func (l *dialLog) list() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.addrs...)
}

func routeDials(f *Fetcher, srv *httptest.Server) *dialLog {
	log := &dialLog{}
	target := srv.Listener.Addr().String()
	f.dial = func(ctx context.Context, network, addr string) (net.Conn, error) {
		log.mu.Lock()
		log.addrs = append(log.addrs, addr)
		log.mu.Unlock()
		var d net.Dialer
		return d.DialContext(ctx, network, target)
	}
	return log
}

// privateFetcher targets httptest servers directly.
func privateFetcher(cfg FetcherConfig) *Fetcher {
	cfg.AllowPrivateForTests = true
	return NewFetcher(cfg)
}

type hostPolicyFunc func(string) bool

func (p hostPolicyFunc) AllowHost(h string) bool { return p(h) }

func textHandler(ct, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", ct)
		_, _ = io.WriteString(w, body)
	}
}
