package public

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/testutil"
)

func n64(v int64) *int64 { return &v }

// set builds effective limits with the public defaults overridden.
func set(o limits.Overrides) limits.Set {
	st := map[limits.Key]limits.Setting{}
	for _, d := range limits.Defs() {
		st[d.Key] = limits.Setting{Default: d.Default}
	}
	return limits.Set{Platform: limits.Platform{Settings: st}, Overrides: o}
}

func admission(o limits.Overrides) Admission {
	return Admission{AgentID: uuid.New(), IPPrefix: "203.0.113.0/24", SessionID: uuid.New(), Limits: set(o)}
}

func code(err error) string {
	if e, ok := apperr.As(err); ok {
		return e.Code
	}
	return ""
}

func TestGuardValkey(t *testing.T) {
	store := testutil.NewKV(t)
	g := &Guard{Counters: ValkeyCounters{KV: store}}
	ctx := context.Background()

	// Per session: 2 per minute.
	in := admission(limits.Overrides{limits.PublicQueriesPerSessionPerMinute: 2})
	for i := 0; i < 2; i++ {
		rel, err := g.Admit(ctx, in)
		if err != nil {
			t.Fatalf("question %d: %v", i, err)
		}
		rel()
	}
	_, err := g.Admit(ctx, in)
	e, _ := apperr.As(err)
	if code(err) != "rate_limited" || e.RetryAfter <= 0 || e.Details.(map[string]any)["limit"] != "public_queries_per_session_per_minute" {
		t.Fatalf("third question: %v", err)
	}

	// Per address: a new session from the same /24 is still limited.
	ip := admission(limits.Overrides{limits.PublicQueriesPerIPPerMinute: 1})
	if rel, err := g.Admit(ctx, ip); err != nil {
		t.Fatal(err)
	} else {
		rel()
	}
	ip.SessionID = uuid.New()
	if _, err := g.Admit(ctx, ip); code(err) != "rate_limited" {
		t.Fatalf("same address: %v", err)
	}
	// A key override raises the address limit (within ceilings).
	ip.Key.PerIPPerMinute = n64(5)
	if _, err := g.Admit(ctx, ip); err != nil {
		t.Fatalf("key override: %v", err)
	}

	// Concurrency per agent: 1 slot.
	c := admission(limits.Overrides{limits.PublicConcurrentChatsPerAgent: 1})
	rel, err := g.Admit(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	c.SessionID = uuid.New()
	if _, err := g.Admit(ctx, c); code(err) != "rate_limited" {
		t.Fatalf("second concurrent chat: %v", err)
	}
	rel()
	if rel, err := g.Admit(ctx, c); err != nil {
		t.Fatalf("after release: %v", err)
	} else {
		rel()
	}
}

func TestGuardDailyCaps(t *testing.T) {
	g := &Guard{Counters: fakeCounters{}, Now: func() time.Time { return time.Date(2026, 9, 26, 23, 0, 0, 0, time.UTC) }}
	in := admission(limits.Overrides{limits.PublicQueriesPerAgentPerDay: 10, limits.PublicTokensPerAgentPerDay: 1000})
	in.Usage = func(context.Context) (int64, int64, error) { return 10, 5, nil }
	_, err := g.Admit(context.Background(), in)
	e, _ := apperr.As(err)
	if code(err) != "quota_exceeded" || e.RetryAfter != time.Hour {
		t.Fatalf("daily questions: %v", err)
	}
	in.Usage = func(context.Context) (int64, int64, error) { return 3, 1000, nil }
	if _, err := g.Admit(context.Background(), in); code(err) != "quota_exceeded" {
		t.Fatalf("daily tokens: %v", err)
	}
	in.Usage = func(context.Context) (int64, int64, error) { return 3, 999, nil }
	if _, err := g.Admit(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	in.Usage = func(context.Context) (int64, int64, error) { return 0, 0, errors.New("db down") }
	if _, err := g.Admit(context.Background(), in); err == nil {
		t.Fatal("a ledger error must refuse")
	}
	// 0 blocks without reading the ledger.
	blocked := admission(limits.Overrides{limits.PublicQueriesPerAgentPerDay: 0})
	if _, err := g.Admit(context.Background(), blocked); code(err) != "quota_exceeded" {
		t.Fatalf("blocked: %v", err)
	}
}

// TestGuardFailsClosed: anonymous traffic is refused when Valkey is down.
func TestGuardFailsClosed(t *testing.T) {
	dead := &kv.Store{Client: redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, DialTimeout: 100 * time.Millisecond}), Prefix: "x:"}
	defer dead.Close()
	errs := 0
	for _, g := range []*Guard{{Counters: ValkeyCounters{KV: dead}, OnBackendError: func() { errs++ }}, {Counters: nil}} {
		_, err := g.Admit(context.Background(), admission(nil))
		e, _ := apperr.As(err)
		if code(err) != "limits_unavailable" || e.Status != 503 || e.RetryAfter <= 0 {
			t.Fatalf("got %v", err)
		}
	}
	if errs != 1 {
		t.Fatalf("backend errors reported: %d", errs)
	}
	// With per-minute limits and concurrency off (unlimited), nothing needs Valkey.
	open := admission(nil)
	for _, k := range []limits.Key{limits.PublicQueriesPerIPPerMinute, limits.PublicQueriesPerSessionPerMinute, limits.PublicConcurrentChatsPerAgent} {
		st := open.Limits.Platform.Settings[k]
		st.Default = nil
		open.Limits.Platform.Settings[k] = st
	}
	if _, err := (&Guard{}).Admit(context.Background(), open); err != nil {
		t.Fatalf("unlimited: %v", err)
	}
}

type fakeCounters struct{}

func (fakeCounters) Allow(context.Context, string, int, time.Duration) (ratelimit.Result, error) {
	return ratelimit.Result{Allowed: true}, nil
}
func (fakeCounters) Acquire(context.Context, string, int64, time.Duration) (bool, error) {
	return true, nil
}
func (fakeCounters) Release(context.Context, string) {}
