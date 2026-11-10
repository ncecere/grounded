package requestcache

import (
	"context"
	"errors"
	"testing"
)

type key struct{ id int }

func TestGetLoadsOncePerRequest(t *testing.T) {
	loads := 0
	load := func() (int, error) { loads++; return 7, nil }
	ctx := With(context.Background())
	for range 3 {
		if v, err := Get(ctx, key{1}, load); v != 7 || err != nil {
			t.Fatalf("Get = %d, %v", v, err)
		}
	}
	if loads != 1 {
		t.Fatalf("loaded %d times in one request, want 1", loads)
	}
	if _, _ = Get(ctx, key{2}, load); loads != 2 {
		t.Fatalf("another key did not load (%d)", loads)
	}
	if With(ctx) != ctx {
		t.Fatal("With replaced an existing cache")
	}
	// Another request, and a context without a cache, read again.
	if _, _ = Get(With(context.Background()), key{1}, load); loads != 3 {
		t.Fatalf("a new request did not load (%d)", loads)
	}
	_, _ = Get(context.Background(), key{1}, load)
	_, _ = Get(context.Background(), key{1}, load)
	if loads != 5 {
		t.Fatalf("without a cache loads = %d, want 5", loads)
	}
}

func TestGetDoesNotRememberFailures(t *testing.T) {
	ctx := With(context.Background())
	fail := errors.New("down")
	if _, err := Get(ctx, key{1}, func() (int, error) { return 0, fail }); !errors.Is(err, fail) {
		t.Fatalf("err = %v", err)
	}
	if v, err := Get(ctx, key{1}, func() (int, error) { return 3, nil }); v != 3 || err != nil {
		t.Fatalf("after a failure Get = %d, %v", v, err)
	}
}
