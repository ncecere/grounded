package healthcheck

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestJitter(t *testing.T) {
	var asked int64
	top := func(n int64) int64 { asked = n; return n - 1 }
	for _, c := range []struct {
		interval, span time.Duration
	}{
		{15 * time.Minute, 90 * time.Second}, // a tenth of the interval
		{5 * time.Minute, 30 * time.Second},
		{time.Hour, maxJitter}, // capped
		{24 * time.Hour, maxJitter},
	} {
		asked = 0
		got := Jitter(c.interval, top)
		if time.Duration(asked) != c.span || got != c.span-1 || got < 0 {
			t.Errorf("Jitter(%s) asked [0,%s) and got %s, want [0,%s)", c.interval, time.Duration(asked), got, c.span)
		}
	}
	if got := Jitter(0, func(int64) int64 { t.Fatal("no jitter without an interval"); return 0 }); got != 0 {
		t.Errorf("Jitter(0) = %s", got)
	}
	// With the real source every delay stays inside the span.
	for range 100 {
		if d := Jitter(15*time.Minute, func(n int64) int64 { return time.Now().UnixNano() % n }); d < 0 || d >= 90*time.Second {
			t.Fatalf("jitter %s out of range", d)
		}
	}
}

func TestPeriodic(t *testing.T) {
	if Periodic(0) != nil {
		t.Error("an interval of 0 schedules nothing")
	}
	if Periodic(DefaultInterval) == nil {
		t.Error("no schedule for the default interval")
	}
	now := time.Date(2026, 9, 30, 14, 14, 0, 0, time.UTC)
	o := InsertOpts(15*time.Minute, now, func(n int64) int64 { return n - 1 })
	if o.MaxAttempts != 1 || !o.ScheduledAt.After(now) || o.ScheduledAt.Sub(now) >= 90*time.Second || o.UniqueOpts.ByPeriod != 0 {
		t.Errorf("insert opts = %+v", o)
	}
	w := &Worker{Interval: 5 * time.Minute}
	if w.Timeout(nil) != 5*time.Minute {
		t.Errorf("a run outlasts its interval: %s", w.Timeout(nil))
	}
	if (&Worker{}).Timeout(nil) != runTimeout || (&Worker{Interval: time.Hour}).Timeout(nil) != runTimeout {
		t.Error("runs are bounded by runTimeout")
	}
}

// fakeStore records results and prunes nothing.
type fakeStore struct {
	mu      sync.Mutex
	results []Result
	pruned  []time.Duration
	fail    bool
}

func (s *fakeStore) Record(_ context.Context, r Result) (Check, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail {
		return Check{}, errors.New("database down")
	}
	s.results = append(s.results, r)
	return Check{}, nil
}

func (s *fakeStore) Prune(_ context.Context, keep time.Duration) (int64, error) {
	s.pruned = append(s.pruned, keep)
	return 3, nil
}

type staticChecker []Target

func (c staticChecker) Targets(context.Context) ([]Target, error) { return c, nil }

// tracked returns a probe that counts probes in flight overall and per key.
func tracked(key string, inFlight, peak *atomic.Int32, perKey map[string]*atomic.Int32, keyPeak *atomic.Int32) Target {
	return Target{Key: key, Probe: func(context.Context) ([]Result, error) {
		n := inFlight.Add(1)
		k := perKey[key].Add(1)
		for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
		}
		for p := keyPeak.Load(); k > p && !keyPeak.CompareAndSwap(p, k); p = keyPeak.Load() {
		}
		time.Sleep(15 * time.Millisecond)
		perKey[key].Add(-1)
		inFlight.Add(-1)
		return []Result{{Kind: KindConnection, SubjectID: uuid.New(), OK: true}}, nil
	}}
}

func TestRunnerBoundsConcurrency(t *testing.T) {
	var inFlight, peak, keyPeak atomic.Int32
	perKey := map[string]*atomic.Int32{}
	var targets staticChecker
	for i := range 12 {
		key := fmt.Sprintf("connection:%d", i%4) // 4 connections, 3 targets each
		if perKey[key] == nil {
			perKey[key] = &atomic.Int32{}
		}
		targets = append(targets, tracked(key, &inFlight, &peak, perKey, &keyPeak))
	}
	store := &fakeStore{}
	sum, err := (&Runner{Store: store, Checkers: []Checker{targets}, Concurrency: 3}).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if peak.Load() > 3 || peak.Load() < 2 {
		t.Errorf("peak probes in flight = %d, want 2-3", peak.Load())
	}
	if keyPeak.Load() != 1 {
		t.Errorf("a connection was probed %d times at once", keyPeak.Load())
	}
	if sum.Targets != 12 || sum.Healthy != 12 || len(store.results) != 12 {
		t.Errorf("summary = %+v, recorded %d", sum, len(store.results))
	}
}

func TestRunnerRecordsAndPrunes(t *testing.T) {
	id := uuid.New()
	targets := staticChecker{
		{Key: "a", Probe: func(context.Context) ([]Result, error) {
			return []Result{{Kind: KindConnection, SubjectID: id, OK: false, ErrorClass: "auth"}, {Kind: KindModel, SubjectID: uuid.New(), OK: true}}, nil
		}},
		{Key: "b", Probe: func(context.Context) ([]Result, error) { return nil, errors.New("deleted meanwhile") }},
	}
	store := &fakeStore{}
	sum, err := (&Runner{Store: store, Checkers: []Checker{targets}}).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if sum != (Summary{Targets: 2, Healthy: 1, Failing: 1, Errors: 1, Pruned: 3}) {
		t.Errorf("summary = %+v", sum)
	}
	for _, r := range store.results {
		if r.Trigger != TriggerScheduled || r.By.Valid {
			t.Errorf("result = %+v, want scheduled with nobody", r)
		}
	}
	if len(store.pruned) != 1 || store.pruned[0] != Keep {
		t.Errorf("pruned with %v, want %s", store.pruned, Keep)
	}

	// Nothing enabled: nothing probed, the history still pruned.
	store = &fakeStore{}
	sum, err = (&Runner{Store: store, Checkers: []Checker{staticChecker{}}, Keep: time.Hour}).Run(context.Background())
	if err != nil || sum.Targets != 0 || len(store.results) != 0 || len(store.pruned) != 1 || store.pruned[0] != time.Hour {
		t.Errorf("empty run = %+v %v, pruned %v", sum, err, store.pruned)
	}

	// A result that can't be stored counts as an error.
	store = &fakeStore{fail: true}
	sum, _ = (&Runner{Store: store, Checkers: []Checker{targets[:1]}}).Run(context.Background())
	if sum.Errors != 1 || sum.Healthy+sum.Failing != 0 {
		t.Errorf("store failure = %+v", sum)
	}
}

func TestSafeMessage(t *testing.T) {
	for in, want := range map[string]string{
		"Incorrect API key provided: sk-live-abcdef123456.":        "Incorrect API key provided: [redacted]",
		"upstream said Authorization: Bearer abc.def.ghi rejected": "upstream said Authorization: [redacted] rejected",
		"bad request api_key=hunter2hunter2 in query":              "bad request [redacted] in query",
		"  many\n\tspaces   here ":                                 "many spaces here",
	} {
		if got := SafeMessage(in); !strings.HasPrefix(got, want) || strings.Contains(got, "hunter2") || strings.Contains(got, "abcdef123456") {
			t.Errorf("SafeMessage(%q) = %q, want %q", in, got, want)
		}
	}
	long := SafeMessage(strings.Repeat("é", 1000))
	if n := len([]rune(long)); n != maxMessage || !strings.HasSuffix(long, "…") {
		t.Errorf("long message has %d characters", n)
	}
}

func TestConnectionResult(t *testing.T) {
	id := uuid.New()
	ok, err := ConnectionResult(id, catalog.ConnectionTest{OK: true, Latency: time.Second}, nil)
	if err != nil || !ok.OK || ok.Kind != KindConnection || ok.Latency != time.Second {
		t.Errorf("healthy = %+v %v", ok, err)
	}
	failed, _ := ConnectionResult(id, catalog.ConnectionTest{Error: &catalog.ProbeError{Kind: gateway.KindAuth, Status: 401, Message: "bad key"}}, nil)
	if failed.OK || failed.ErrorClass != gateway.KindAuth || failed.HTTPStatus != 401 || failed.Message != "bad key" {
		t.Errorf("failed = %+v", failed)
	}
	undecryptable := apperr.Conflict("api_key_undecryptable", "The stored API key cannot be decrypted.")
	cfg, err := ConnectionResult(id, catalog.ConnectionTest{}, undecryptable)
	if err != nil || cfg.OK || cfg.ErrorClass != ClassConfig || !strings.Contains(cfg.Message, "decrypted") {
		t.Errorf("config failure = %+v %v", cfg, err)
	}
	// Errors that prove nothing about the connection aren't results.
	for _, e := range []error{apperr.NotFound("connection_not_found", "gone"), apperr.Forbidden("no"), context.Canceled} {
		if _, err := ConnectionResult(id, catalog.ConnectionTest{}, e); err == nil {
			t.Errorf("%v became a result", e)
		}
	}
}

func TestDeriveModel(t *testing.T) {
	chat := dbgen.Model{ID: uuid.New(), Kind: catalog.KindChat, UpstreamModel: "chat-large"}
	judge := dbgen.Model{ID: uuid.New(), Kind: catalog.KindSystemOne, UpstreamModel: "judge"}
	listed := catalog.ConnectionTest{OK: true, Probe: catalog.ProbeModels, Models: []string{"chat-large", "embed"}}
	up := Result{Kind: KindConnection, OK: true, Latency: 40 * time.Millisecond}
	down := Result{Kind: KindConnection, ErrorClass: gateway.KindUnavailable, HTTPStatus: 503, Message: "Service Unavailable"}
	cases := []struct {
		name  string
		m     dbgen.Model
		test  catalog.ConnectionTest
		conn  Result
		ok    bool
		class string
	}{
		{"listed", chat, listed, up, true, ""},
		{"not listed", dbgen.Model{ID: uuid.New(), Kind: catalog.KindChat, UpstreamModel: "gone"}, listed, up, false, gateway.KindNotFound},
		{"empty list proves nothing", chat, catalog.ConnectionTest{OK: true, Probe: catalog.ProbeModels, Models: []string{}}, up, true, ""},
		{"SystemOne never listed", judge, listed, up, true, ""},
		{"SystemOne probe", chat, catalog.ConnectionTest{OK: true, Probe: catalog.ProbeSystemOne}, up, true, ""},
		{"connection down", chat, catalog.ConnectionTest{Probe: catalog.ProbeModels}, down, false, gateway.KindUnavailable},
	}
	for _, c := range cases {
		r := DeriveModel(c.m, c.test, c.conn)
		if r.Kind != KindModel || r.SubjectID != c.m.ID || r.OK != c.ok || r.ErrorClass != c.class {
			t.Errorf("%s: %+v", c.name, r)
		}
		if !r.OK && r.Message == "" {
			t.Errorf("%s: failing without a message", c.name)
		}
	}
	if r := DeriveModel(chat, catalog.ConnectionTest{}, down); r.HTTPStatus != 503 || !strings.Contains(r.Message, "Service Unavailable") {
		t.Errorf("connection failure = %+v", r)
	}
}
