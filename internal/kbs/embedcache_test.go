package kbs

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Concurrent searches of one request embed the same text once: one claims it, the others wait for its vector (#251).
func TestEmbedCacheEmbedsOnceForConcurrentClaims(t *testing.T) {
	var c EmbedCache
	var embeds atomic.Int32
	get := func() []float32 {
		for {
			v, ok, wait := c.claim("k")
			if ok {
				return v
			}
			if wait == nil {
				embeds.Add(1)
				time.Sleep(10 * time.Millisecond)
				v = []float32{1}
				c.done("k", v)
				return v
			}
			<-wait
		}
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if v := get(); len(v) != 1 {
				t.Error("no vector")
			}
		})
	}
	wg.Wait()
	if n := embeds.Load(); n != 1 {
		t.Fatalf("embedded %d times, want once", n)
	}
	// A failed embedding stores nothing: the next claim embeds again.
	if _, _, wait := c.claim("other"); wait != nil {
		t.Fatal("a new text should be claimed")
	}
	c.done("other", nil)
	if _, ok, wait := c.claim("other"); ok || wait != nil {
		t.Fatalf("after a failure: ok %v, wait %v; want a new claim", ok, wait != nil)
	}
	var nilCache *EmbedCache
	if _, ok, wait := nilCache.claim("k"); ok || wait != nil {
		t.Fatal("a nil cache claims nothing")
	}
	nilCache.done("k", nil)
}
