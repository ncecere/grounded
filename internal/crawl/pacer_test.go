package crawl

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// assertSpaced checks that sorted timestamps are at least interval-slack apart.
func assertSpaced(t *testing.T, times []time.Time, interval, slack time.Duration) {
	t.Helper()
	slices.SortFunc(times, func(a, b time.Time) int { return a.Compare(b) })
	for i := 1; i < len(times); i++ {
		if gap := times[i].Sub(times[i-1]); gap < interval-slack {
			t.Fatalf("slot %d only %v after previous (interval %v)", i, gap, interval)
		}
	}
}

// hammer runs workers x perWorker Wait calls on one origin and returns the
// grant times.
func hammer(t *testing.T, pacers []Pacer, perWorker int, origin string) []time.Time {
	t.Helper()
	var mu sync.Mutex
	var times []time.Time
	var wg sync.WaitGroup
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, p := range pacers {
		for w := 0; w < 2; w++ {
			wg.Add(1)
			go func(p Pacer) {
				defer wg.Done()
				for i := 0; i < perWorker; i++ {
					if err := p.Wait(ctx, origin); err != nil {
						t.Error(err)
						return
					}
					mu.Lock()
					times = append(times, time.Now())
					mu.Unlock()
				}
			}(p)
		}
	}
	wg.Wait()
	return times
}

func TestLocalPacer(t *testing.T) {
	const interval = 30 * time.Millisecond
	p := NewLocalPacer(interval)
	times := hammer(t, []Pacer{p, p}, 3, "https://www.example.edu:443")
	if len(times) != 12 {
		t.Fatalf("got %d grants", len(times))
	}
	// Timestamps are taken after Wait returns, so scheduler delay on a loaded
	// -race run can make one gap short by several milliseconds. Half an
	// interval of slack absorbs that; a pacing bug shows gaps near 0.
	assertSpaced(t, times, interval, interval/2)
	// Different origins do not wait on each other. A longer interval here
	// keeps a wide margin: paced together, 5 origins would take at least
	// 4 × 200 ms; independently they take microseconds, even on a loaded run.
	slow := NewLocalPacer(200 * time.Millisecond)
	start := time.Now()
	for i := 0; i < 5; i++ {
		if err := slow.Wait(context.Background(), "https://o"+string(rune('a'+i))+".example:443"); err != nil {
			t.Fatal(err)
		}
	}
	if elapsed := time.Since(start); elapsed >= 2*200*time.Millisecond {
		t.Fatalf("independent origins paced together (%v)", elapsed)
	}
	// Context cancellation is returned.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	_ = p.Wait(context.Background(), "https://slow.example:443")
	if err := p.Wait(ctx, "https://slow.example:443"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("ctx: %v", err)
	}
	if err := NewLocalPacer(0).Wait(context.Background(), "x"); err != nil {
		t.Fatal(err)
	}
}

func valkeyClient(t *testing.T) *redis.Client {
	t.Helper()
	raw := os.Getenv("GROUNDED_TEST_VALKEY_URL")
	if raw == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("GROUNDED_TEST_VALKEY_URL must be set in CI")
		}
		t.Skip("GROUNDED_TEST_VALKEY_URL not set; skipping Valkey pacer test")
	}
	opts, err := redis.ParseURL(raw)
	if err != nil {
		t.Fatal(err)
	}
	c := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Ping(ctx).Err(); err != nil {
		t.Fatalf("valkey: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func uniquePrefix() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "groundedtest:crawl:" + hex.EncodeToString(b) + ":"
}

func TestValkeyPacerSharedAcrossWorkers(t *testing.T) {
	prefix := uniquePrefix()
	const interval = 150 * time.Millisecond
	// Two independent clients model two worker processes.
	a := NewValkeyPacer(valkeyClient(t), prefix, interval)
	b := NewValkeyPacer(valkeyClient(t), prefix, interval)
	times := hammer(t, []Pacer{a, b}, 2, "https://www.example.edu:443")
	if len(times) != 8 {
		t.Fatalf("got %d grants", len(times))
	}
	// Grants are observed after a network round trip; allow a little skew.
	assertSpaced(t, times, interval, 25*time.Millisecond)
	if total := times[len(times)-1].Sub(times[0]); total < 7*(interval-25*time.Millisecond) {
		t.Fatalf("8 grants within %v", total)
	}

	// Keys use prefix + sha256(origin) and expire.
	c := valkeyClient(t)
	keys, err := c.Keys(context.Background(), prefix+"*").Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range keys {
		if len(k) != len(prefix)+64 {
			t.Fatalf("unexpected key %q", k)
		}
		if ttl := c.PTTL(context.Background(), k).Val(); ttl > interval {
			t.Fatalf("key ttl %v", ttl)
		}
	}
	// Another origin is independent; a different prefix is independent.
	start := time.Now()
	if err := a.Wait(context.Background(), "https://other.example:443"); err != nil {
		t.Fatal(err)
	}
	if err := NewValkeyPacer(c, uniquePrefix(), interval).Wait(context.Background(), "https://www.example.edu:443"); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) > interval/2 {
		t.Fatalf("independent keys waited %v", time.Since(start))
	}
}

func TestValkeyPacerContextAndErrors(t *testing.T) {
	c := valkeyClient(t)
	p := NewValkeyPacer(c, uniquePrefix(), 5*time.Second)
	if err := p.Wait(context.Background(), "https://x.example:443"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := p.Wait(ctx, "https://x.example:443"); !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > time.Second {
		t.Fatalf("ctx: %v after %v", err, time.Since(start))
	}
	// A dead server fails closed (error, not a free pass).
	dead := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, DialTimeout: 200 * time.Millisecond})
	defer dead.Close()
	err := NewValkeyPacer(dead, "x:", time.Second).Wait(context.Background(), "https://x.example:443")
	if err == nil {
		t.Fatal("unreachable Valkey allowed the request")
	}
}
