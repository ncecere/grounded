package ttlcache

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestValueCachesWithinTTL(t *testing.T) {
	var c Value[int]
	loads := 0
	load := func(context.Context) (int, error) { loads++; return loads, nil }
	for range 3 {
		if v, err := c.Get(context.Background(), load); v != 1 || err != nil {
			t.Fatalf("Get = %d, %v; want the first load", v, err)
		}
	}
	c.Invalidate()
	if v, _ := c.Get(context.Background(), load); v != 2 {
		t.Fatalf("after Invalidate Get = %d, want a new load", v)
	}
}

func TestValueExpires(t *testing.T) {
	c := Value[int]{TTL: 20 * time.Millisecond}
	loads := 0
	load := func(context.Context) (int, error) { loads++; return loads, nil }
	_, _ = c.Get(context.Background(), load)
	time.Sleep(30 * time.Millisecond)
	if v, _ := c.Get(context.Background(), load); v != 2 {
		t.Fatalf("an expired value was served (%d)", v)
	}
}

// A failed load is the caller's error and is not remembered: the cache never turns an unreadable row into a stale
// success, and the next caller reads again.
func TestValueNeverCachesErrors(t *testing.T) {
	c := Value[int]{TTL: 20 * time.Millisecond}
	_, _ = c.Get(context.Background(), func(context.Context) (int, error) { return 1, nil })
	time.Sleep(30 * time.Millisecond)
	boom := errors.New("boom")
	if _, err := c.Get(context.Background(), func(context.Context) (int, error) { return 0, boom }); !errors.Is(err, boom) {
		t.Fatalf("an expired value hid the failed load: %v", err)
	}
	if v, err := c.Get(context.Background(), func(context.Context) (int, error) { return 3, nil }); v != 3 || err != nil {
		t.Fatalf("Get after a failure = %d, %v", v, err)
	}
}

// A load that started before Invalidate (it read the row before the change) doesn't store what it read.
func TestValueInvalidateWinsOverALoadInFlight(t *testing.T) {
	var c Value[string]
	_, _ = c.Get(context.Background(), func(context.Context) (string, error) {
		c.Invalidate() // the change commits while this load is reading
		return "before the change", nil
	})
	v, _ := c.Get(context.Background(), func(context.Context) (string, error) { return "after", nil })
	if v != "after" {
		t.Fatalf("Get = %q: a load from before the change was stored", v)
	}
}

func TestNegativeTTLNeverCaches(t *testing.T) {
	c := Value[int]{TTL: -1}
	loads := 0
	for range 2 {
		_, _ = c.Get(context.Background(), func(context.Context) (int, error) { loads++; return 0, nil })
	}
	if loads != 2 {
		t.Fatalf("loads = %d, want 2", loads)
	}
}

func TestMap(t *testing.T) {
	c := Map[string, int]{Max: 2}
	loads := map[string]int{}
	get := func(k string) int {
		v, err := c.Get(context.Background(), k, func(context.Context) (int, error) { loads[k]++; return len(k), nil })
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	for _, k := range []string{"a", "a", "bb"} {
		if get(k) != len(k) {
			t.Fatalf("Get(%q) = wrong value", k)
		}
	}
	if loads["a"] != 1 || loads["bb"] != 1 {
		t.Fatalf("loads = %v, want one each", loads)
	}
	get("ccc") // full: makes room
	if len(c.m) > 2 {
		t.Fatalf("the map holds %d entries, max 2", len(c.m))
	}
	c.Invalidate()
	get("bb")
	if loads["bb"] != 2 {
		t.Fatalf("Invalidate kept a value (loads %v)", loads)
	}
	if _, err := c.Get(context.Background(), "x", func(context.Context) (int, error) { return 0, errors.New("no") }); err == nil {
		t.Fatal("an error was lost")
	}
	if _, ok := c.m["x"]; ok {
		t.Fatal("a failed load was stored")
	}
}

func TestInvalidateAll(t *testing.T) {
	var v Value[int]
	var m Map[string, int]
	loads := 0
	load := func(context.Context) (int, error) { loads++; return loads, nil }
	_, _ = v.Get(context.Background(), load)
	_, _ = m.Get(context.Background(), "k", load)
	InvalidateAll()
	_, _ = v.Get(context.Background(), load)
	_, _ = m.Get(context.Background(), "k", load)
	if loads != 4 {
		t.Fatalf("loads = %d, want 4: InvalidateAll kept a value", loads)
	}
}
