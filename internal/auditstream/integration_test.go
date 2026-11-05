package auditstream

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

type fixture struct {
	t     *testing.T
	ctx   context.Context
	pool  *pgxpool.Pool
	s     *Service
	admin authz.Actor
}

func newFixture(t *testing.T) *fixture {
	pool, _ := testutil.NewDB(t)
	box, err := secrets.New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, ctx: context.Background(), pool: pool}
	uid := uuid.New()
	if _, err := pool.Exec(f.ctx, `INSERT INTO users (id, oidc_issuer, oidc_subject, email, platform_role) VALUES ($1, 'i', 's', 'admin@example.edu', 'platform_admin')`, uid); err != nil {
		t.Fatal(err)
	}
	f.admin = authz.Actor{UserID: uid, PlatformRole: authz.PlatformAdmin}
	f.s = &Service{Pool: pool, Box: box, Sender: &Sender{AllowLoopback: true, Timeout: 3 * time.Second}, Instance: "Grounded", Hostname: "grounded.test",
		Log: testutil.Logger()}
	st, err := f.s.SetEnabled(f.ctx, f.admin, true, 1)
	if err != nil || !st.Enabled {
		t.Fatal(err)
	}
	return f
}

// record writes an audit entry in its own transaction.
func (f *fixture) record(action string) {
	f.t.Helper()
	if err := pgx.BeginFunc(f.ctx, f.pool, func(tx pgx.Tx) error {
		return audit.Record(f.ctx, dbgen.New(tx), audit.Entry{ActorKind: audit.ActorSystem, Action: action, TargetType: "team", TargetID: uuid.NewString()})
	}); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) destination(in Input) uuid.UUID {
	f.t.Helper()
	id, err := f.s.Create(f.ctx, f.admin, in)
	if err != nil {
		f.t.Fatal(err)
	}
	if err := f.s.SetDestinationEnabled(f.ctx, f.admin, id, true, f.dest(id).Revision); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *fixture) deliver(id uuid.UUID) int {
	f.t.Helper()
	n, err := f.s.Deliver(f.ctx, id, 10*time.Second)
	if err != nil {
		f.t.Fatal(err)
	}
	return n
}

func (f *fixture) dest(id uuid.UUID) dbgen.GetAuditStreamDestinationRow {
	f.t.Helper()
	d, err := dbgen.New(f.pool).GetAuditStreamDestination(f.ctx, id)
	if err != nil {
		f.t.Fatal(err)
	}
	return d
}

// collector is an HTTPS SIEM: it records each batch's events and header, and can be told to fail.
type collector struct {
	mu      sync.Mutex
	actions []string
	ids     []int64
	auth    []string
	fail    bool
}

func (c *collector) handler(hec bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.fail {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		c.auth = append(c.auth, r.Header.Get("Authorization"))
		dec := json.NewDecoder(r.Body)
		for {
			var e Event
			if hec {
				var env struct{ Event Event }
				if dec.Decode(&env) != nil {
					break
				}
				e = env.Event
			} else if dec.Decode(&e) != nil {
				break
			}
			c.actions, c.ids = append(c.actions, e.Action), append(c.ids, e.ID)
		}
	}
}

func (c *collector) got() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.actions...)
}

func trust(f *fixture, srv *httptest.Server) {
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	f.s.Sender.RootCAs = pool
}

// A stream starts with entries written after it is turned on; it sends in commit order, holds back an entry whose transaction
// is still open even when later entries committed, and sends nothing twice.
func TestStreamOrderAndStart(t *testing.T) {
	f := newFixture(t)
	c := &collector{}
	srv := httptest.NewTLSServer(c.handler(false))
	defer srv.Close()
	trust(f, srv)

	f.record("team.before_start")
	id := f.destination(Input{Name: "SIEM", Kind: KindHTTPS, Format: FormatNDJSON, Address: srv.URL + "/ingest"})
	f.record("team.one")

	// A transaction that writes an entry and stays open while another commits after it.
	slow, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := audit.Record(f.ctx, dbgen.New(slow), audit.Entry{ActorKind: audit.ActorSystem, Action: "team.late", TargetType: "team"}); err != nil {
		t.Fatal(err)
	}
	f.record("team.after_late")
	if n := f.deliver(id); n != 2 {
		t.Fatalf("delivered %d with a transaction open, want the switch-on and team.one", n)
	}
	if err := slow.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	f.deliver(id)
	f.deliver(id) // nothing new: nothing twice
	got := c.got()
	// The stream opens with the entry that turned it on.
	if strings.Join(got, ",") != "platform.audit_stream_enable,team.one,team.late,team.after_late" {
		t.Fatalf("delivered %v", got)
	}
	if d := f.dest(id); d.SentTotal != 4 || d.LastErrorClass != "" {
		t.Fatalf("destination %+v", d)
	}
}

// Splunk HEC with an authorization header (stored encrypted); a failure is classified and backs off, then the stream resumes
// where it stopped.
func TestStreamHECFailureAndRecovery(t *testing.T) {
	f := newFixture(t)
	c := &collector{}
	srv := httptest.NewTLSServer(c.handler(true))
	defer srv.Close()
	trust(f, srv)
	token := "Splunk 00000000-aaaa-bbbb-cccc-000000000000"
	id := f.destination(Input{Name: "Splunk", Kind: KindHTTPS, Format: FormatSplunkHEC, Address: srv.URL + "/services/collector/event", AuthHeader: &token})
	var stored []byte
	if err := f.pool.QueryRow(f.ctx, `SELECT auth_header FROM audit_stream_destinations WHERE id = $1`, id).Scan(&stored); err != nil ||
		strings.Contains(string(stored), "Splunk") {
		t.Fatalf("the header is stored in clear (%v)", err)
	}

	c.fail = true
	f.record("team.first")
	f.deliver(id)
	d := f.dest(id)
	if d.LastErrorClass != ClassHTTP5xx || d.Failures != 1 || d.NextAttemptAt == nil || time.Until(*d.NextAttemptAt) > 6*time.Second {
		t.Fatalf("after a 503: %+v", d)
	}
	if due, _ := dbgen.New(f.pool).DueAuditStreamDestinations(f.ctx); len(due) != 0 {
		t.Fatal("a backing-off destination is due")
	}
	c.fail = false
	f.record("team.second")
	f.deliver(id)
	if got := c.got(); strings.Join(got, ",") != "platform.audit_stream_enable,team.first,team.second" || c.auth[0] != token {
		t.Fatalf("after recovery: %v %v", got, c.auth)
	}
	if d := f.dest(id); d.Failures != 0 || d.LastErrorClass != "" || d.FailingSince != nil {
		t.Fatalf("not reset: %+v", d)
	}
	// A test entry isn't stored or streamed.
	if class, err := f.s.Test(f.ctx, f.admin, id); err != nil || class != "" {
		t.Fatalf("test = %q %v", class, err)
	}
	if n := scalar(t, f.pool, `SELECT count(*) FROM audit_log WHERE action = 'audit_stream.test'`); n != 0 {
		t.Fatal("the test entry was stored")
	}
}

// Syslog over TLS with the destination's own CA: RFC 5425 octet-counted RFC 5424 messages.
func TestStreamSyslogTLS(t *testing.T) {
	f := newFixture(t)
	srv := httptest.NewUnstartedServer(nil)
	srv.StartTLS() // only for a certificate the test trusts through the destination's CA
	cert := srv.TLS.Certificates[0]
	srv.Close()
	caPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Certificate[0]}))

	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{cert}})
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	msgs := make(chan string, 10)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				r := bufio.NewReader(conn)
				for {
					n, err := r.ReadString(' ')
					if err != nil {
						return
					}
					size, _ := strconv.Atoi(strings.TrimSpace(n))
					buf := make([]byte, size)
					if _, err := io.ReadFull(r, buf); err != nil {
						return
					}
					msgs <- string(buf)
				}
			}(conn)
		}
	}()
	// The listener's certificate names example.com; the destination uses that name, resolved to loopback.
	f.s.Sender.Lookup = func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	}
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	id := f.destination(Input{Name: "Syslog", Kind: KindSyslog, Address: "example.com:" + port, CAPEM: caPEM})
	f.record("team.syslog_one")
	f.record("team.syslog_two")
	if n := f.deliver(id); n != 3 {
		t.Fatalf("delivered %d", n)
	}
	for _, want := range []string{"platform.audit_stream_enable", "team.syslog_one", "team.syslog_two"} {
		select {
		case m := <-msgs:
			if !strings.HasPrefix(m, "<110>1 ") || !strings.Contains(m, " grounded.test grounded - "+want+" - {") {
				t.Fatalf("message %q", m)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("no message for %s", want)
		}
	}
	// Without the CA the handshake fails as tls.
	if err := f.s.Update(f.ctx, f.admin, id, Input{Name: "Syslog", Address: "example.com:" + port}, f.dest(id).Revision); err != nil {
		t.Fatal(err)
	}
	f.record("team.syslog_three")
	f.deliver(id)
	if d := f.dest(id); d.LastErrorClass != ClassTLS {
		t.Fatalf("without the CA: %+v", d)
	}
}

// The switch, the limit, the address rule and the audit entries.
func TestStreamSettingsAndLimits(t *testing.T) {
	f := newFixture(t)
	if _, err := f.s.Create(f.ctx, f.admin, Input{Name: "x", Kind: KindHTTPS, Format: FormatNDJSON, Address: "http://insecure.example.edu/"}); err == nil {
		t.Fatal("an http URL was accepted")
	}
	for i := 0; i < MaxDestinations; i++ {
		if _, err := f.s.Create(f.ctx, f.admin, Input{Name: "d" + strconv.Itoa(i), Kind: KindSyslog, Address: "siem.example.edu:6514"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.s.Create(f.ctx, f.admin, Input{Name: "sixth", Kind: KindSyslog, Address: "siem.example.edu:6514"}); err == nil {
		t.Fatal("a sixth destination was accepted")
	}
	if _, err := f.s.SetEnabled(f.ctx, f.admin, false, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.Create(f.ctx, f.admin, Input{Name: "off", Kind: KindSyslog, Address: "siem.example.edu:6514"}); err == nil {
		t.Fatal("created while streaming is off")
	}
	auditor := authz.Actor{UserID: uuid.New(), PlatformRole: authz.PlatformAuditor}
	if _, err := f.s.List(f.ctx, auditor); err != nil {
		t.Fatal("an auditor can't read")
	}
	if _, err := f.s.SetEnabled(f.ctx, auditor, true, 3); err == nil {
		t.Fatal("an auditor changed the switch")
	}
	// Loopback is refused outside tests.
	f.s.Sender.AllowLoopback = false
	if err := f.s.Sender.PostHTTPS(f.ctx, "https://127.0.0.1:1/x", "", "application/json", "", nil); Class(err) != ClassAddress {
		t.Fatalf("loopback = %v", err)
	}
	if n := scalar(t, f.pool, `SELECT count(*) FROM audit_log WHERE action LIKE 'platform.audit_stream%'`); n != 7 {
		t.Fatalf("audit entries = %d, want 2 switches and 5 creations", n)
	}
}

func scalar(t *testing.T, pool *pgxpool.Pool, sql string) int64 {
	t.Helper()
	var n int64
	if err := pool.QueryRow(context.Background(), sql).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
