package httpapi_test

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Record SQL only while the request is in flight, never fixture/startup work.
type aboutQueryTrace struct {
	mu     sync.Mutex
	active bool
	sql    []string
}

func (q *aboutQueryTrace) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.active {
		q.sql = append(q.sql, d.SQL)
	}
	return ctx
}
func (*aboutQueryTrace) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}
func (q *aboutQueryTrace) start()                                                        { q.mu.Lock(); defer q.mu.Unlock(); q.sql = nil; q.active = true }
func (q *aboutQueryTrace) stop() []string {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.active = false
	return append([]string(nil), q.sql...)
}

type aboutBlobTrap struct {
	blob.Store
	reads atomic.Int32
}

func (b *aboutBlobTrap) Get(context.Context, string) (io.ReadCloser, error) {
	b.reads.Add(1)
	return nil, errors.New("About must not read blob bodies")
}

func TestAssistantAboutNoWork(t *testing.T) {
	serial(t) // replaces http.DefaultTransport
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "No work")
	if err := env.app.stopWorker(); err != nil {
		t.Fatal(err)
	}
	trap := &aboutBlobTrap{Store: env.app.Svc.Sources.Blob}
	env.app.Svc.Sources.Blob = trap
	// Positive control: this dependency trap really observes body reads.
	_, _ = trap.Get(context.Background(), "positive-control")
	if trap.reads.Swap(0) != 1 {
		t.Fatal("blob trap inactive")
	}

	// Clone the normal transport, preserving its concrete type so gateway
	// clones inherit the dial trap. Only HTTP test clients may reach the app.
	old := http.DefaultTransport
	transport := old.(*http.Transport).Clone()
	u, _ := url.Parse(env.app.URL)
	var outbound atomic.Int32
	dial := transport.DialContext
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		if addr != u.Host {
			outbound.Add(1)
			return nil, errors.New("unexpected outbound request")
		}
		return dial(ctx, network, addr)
	}
	http.DefaultTransport = transport
	defer func() { http.DefaultTransport = old; transport.CloseIdleConnections() }()
	_, _ = transport.DialContext(context.Background(), "tcp", "127.0.0.1:1")
	if outbound.Swap(0) != 1 {
		t.Fatal("network trap inactive")
	}
	anon := newVisitor(t, env.app.URL)
	jobs := env.scalar(t, requestJobs)
	for _, path := range []string{"/v1/public/agents/" + pub.Id.String(), "/v1/agents/id/" + pub.Id.String()} {
		env.app.queries.start()
		var aboutPresent bool
		if strings.Contains(path, "/public/") {
			var got apitypes.PublicAgent
			code, _ := anon.call("GET", path, nil, &got)
			aboutPresent = code == 200 && got.About != nil
		} else {
			var got apitypes.AgentCard
			code := env.member.get(path, &got)
			aboutPresent = code == 200 && got.About != nil
		}
		sql := env.app.queries.stop()
		if !aboutPresent {
			t.Fatal("positive authorized About missing", path)
		}
		if len(sql) == 0 {
			t.Fatal("SQL tracer inactive")
		}
		aggregate := 0
		for _, query := range sql {
			lower := strings.ToLower(query)
			// Explicitly permit only the metadata aggregate to touch documents.
			if strings.Contains(lower, "from documents") {
				if !strings.Contains(query, "AssistantAboutSources") || !strings.Contains(lower, "limit 501") || !strings.Contains(lower, "limit 10001") {
					t.Errorf("unexpected document read: %s", query)
				}
				aggregate++
			}
			for _, forbidden := range []string{"from chunks", "join chunks", "insert into river_job", "body_key", "markdown_key", "original_key"} {
				if strings.Contains(lower, forbidden) {
					t.Errorf("request work/body SQL: %s", query)
				}
			}
		}
		if aggregate != 1 {
			t.Errorf("metadata query count %d", aggregate)
		}
	}
	if trap.reads.Load() != 0 || outbound.Load() != 0 || jobs != env.scalar(t, requestJobs) {
		t.Fatalf("request work: blobs=%d outbound=%d", trap.reads.Load(), outbound.Load())
	}
}

// Failure of the metadata query must withhold the whole disclosure, including
// the published note; the existing successful profile status remains unchanged.
func TestAssistantAboutMetadataTimeout(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Timeout")
	if err := env.app.stopWorker(); err != nil {
		t.Fatal(err)
	}
	tx, err := env.app.Pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(context.Background(), "LOCK documents IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	anon := newVisitor(t, env.app.URL)
	var got apitypes.PublicAgent
	code, _ := anon.call("GET", "/v1/public/agents/"+pub.Id.String(), nil, &got)
	if code != 200 || got.About != nil {
		t.Fatalf("timeout disclosed partial facts: %d %+v", code, got.About)
	}
	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	got = apitypes.PublicAgent{}
	code, _ = anon.call("GET", "/v1/public/agents/"+pub.Id.String(), nil, &got)
	if code != 200 || got.About == nil {
		t.Fatalf("recovery: %d %+v", code, got.About)
	}
}

func TestAssistantAboutCurrentSourceAndTeam(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Current metadata")
	anon := newVisitor(t, env.app.URL)
	path := "/v1/public/agents/" + pub.Id.String()
	read := func() *apitypes.AssistantAbout {
		t.Helper()
		var got apitypes.PublicAgent
		code, _ := anon.call("GET", path, nil, &got)
		if code != 200 {
			t.Fatalf("profile status changed: %d", code)
		}
		return got.About
	}
	if a := read(); a == nil || a.SourceCount != 1 {
		t.Fatal("missing positive control", a)
	}
	// Raising a current source classification revokes public disclosure immediately.
	if _, err := env.app.Pool.Exec(context.Background(), "UPDATE data_sources SET classification='sensitive' WHERE id=$1", env.upload.Id); err != nil {
		t.Fatal(err)
	}
	if a := read(); a != nil {
		t.Fatal("policy-revoked source disclosed", a)
	}
	if _, err := env.app.Pool.Exec(context.Background(), "UPDATE data_sources SET classification='open' WHERE id=$1", env.upload.Id); err != nil {
		t.Fatal(err)
	}
	if a := read(); a == nil || a.SourceCount != 1 {
		t.Fatal("restored source missing", a)
	}
	if _, err := env.app.Pool.Exec(context.Background(), "DELETE FROM kb_sources WHERE kb_id=$1 AND source_id=$2", env.kb.Id, env.upload.Id); err != nil {
		t.Fatal(err)
	}
	if a := read(); a == nil || a.SourceCount != 0 || a.LastProcessedAt != nil {
		t.Fatal("stale detached source", a)
	}
	if _, err := env.app.Pool.Exec(context.Background(), "UPDATE teams SET status='archived' WHERE slug=$1", env.team); err != nil {
		t.Fatal(err)
	}
	if a := read(); a != nil {
		t.Fatal("inactive team disclosure", a)
	}
}

func TestAssistantAboutRouter(t *testing.T) {
	env := newRouterEnv(t)
	router := env.router(t, "Disclosed router", nil)
	var got apitypes.AgentCard
	if code := env.member.get("/v1/agents/id/"+router.Id.String(), &got); code != 200 || got.About == nil {
		t.Fatalf("router %d %+v", code, got.About)
	}
	a := got.About
	if a.Router == nil || !*a.Router || a.PassageJudging != "unknown" || a.ClaimChecks != "unknown" || a.Moderation != "unknown" {
		t.Fatalf("router claims destination checks: %+v", a)
	}
}
