package blob

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

// newStoreFunc returns a fresh, empty store for one subtest. Cleanup is
// registered on t by the factory.
type newStoreFunc func(t *testing.T) Store

// runConformance runs the behaviour every Store implementation must satisfy.
func runConformance(t *testing.T, newStore newStoreFunc) {
	tests := []struct {
		name string
		fn   func(t *testing.T, ctx context.Context, s Store)
	}{
		{"PutGetRoundTrip", testPutGetRoundTrip},
		{"EmptyObject", testEmptyObject},
		{"Overwrite", testOverwrite},
		{"MissingKeyNotFound", testMissingKeyNotFound},
		{"PrefixIsNotAnObject", testPrefixIsNotAnObject},
		{"DeleteIdempotent", testDeleteIdempotent},
		{"DeletePrefixScoped", testDeletePrefixScoped},
		{"InvalidKeysRejected", testInvalidKeysRejected},
		{"SizeMismatchKeepsOld", testSizeMismatchKeepsOld},
		{"LargeStreamingUnknownSize", func(t *testing.T, ctx context.Context, s Store) {
			testLargeStreaming(t, ctx, s, 20<<20, -1)
		}},
		{"LargeStreamingKnownSize", func(t *testing.T, ctx context.Context, s Store) {
			testLargeStreaming(t, ctx, s, 20<<20+123, 20<<20+123)
		}},
		{"LargeSizeMismatchKeepsOld", testLargeSizeMismatchKeepsOld},
		{"ConcurrentPuts", testConcurrentPuts},
		{"CancelledContext", testCancelledContext},
		{"Ping", testPing},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			tc.fn(t, ctx, newStore(t))
		})
	}
}

const docKey = "teams/0b6f1c1e-6a3b-4a39-9a0e-2f4c1d7e8a90/sources/5d2c/docs/9f1e/v3/original"

func mustPut(t *testing.T, ctx context.Context, s Store, key, content string) {
	t.Helper()
	if err := s.Put(ctx, key, strings.NewReader(content), int64(len(content)), "text/plain"); err != nil {
		t.Fatalf("Put(%q): %v", key, err)
	}
}

func mustGet(t *testing.T, ctx context.Context, s Store, key string) string {
	t.Helper()
	rc, err := s.Get(ctx, key)
	if err != nil {
		t.Fatalf("Get(%q): %v", key, err)
	}
	defer rc.Close()
	b, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("Get(%q) read: %v", key, err)
	}
	return string(b)
}

func wantNotFound(t *testing.T, ctx context.Context, s Store, key string) {
	t.Helper()
	rc, err := s.Get(ctx, key)
	if err == nil {
		rc.Close()
		t.Fatalf("Get(%q): got object, want ErrNotFound", key)
	}
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get(%q): err = %v, want ErrNotFound", key, err)
	}
}

func testPutGetRoundTrip(t *testing.T, ctx context.Context, s Store) {
	body := "# Parsed\n\nhello, world\n"
	mustPut(t, ctx, s, docKey, body)
	mustPut(t, ctx, s, strings.TrimSuffix(docKey, "original")+"parsed.md", "md")
	if got := mustGet(t, ctx, s, docKey); got != body {
		t.Fatalf("Get = %q, want %q", got, body)
	}
	if got := mustGet(t, ctx, s, strings.TrimSuffix(docKey, "original")+"parsed.md"); got != "md" {
		t.Fatalf("Get parsed.md = %q", got)
	}
	// Top-level key without any '/'.
	mustPut(t, ctx, s, "top.bin", "x")
	if got := mustGet(t, ctx, s, "top.bin"); got != "x" {
		t.Fatalf("Get top.bin = %q", got)
	}
	// Unknown size, small body.
	if err := s.Put(ctx, "a/unknown", strings.NewReader("abc"), -1, ""); err != nil {
		t.Fatal(err)
	}
	if got := mustGet(t, ctx, s, "a/unknown"); got != "abc" {
		t.Fatalf("Get a/unknown = %q", got)
	}
}

func testEmptyObject(t *testing.T, ctx context.Context, s Store) {
	mustPut(t, ctx, s, "empty/known", "")
	if err := s.Put(ctx, "empty/unknown", strings.NewReader(""), -1, ""); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"empty/known", "empty/unknown"} {
		if got := mustGet(t, ctx, s, k); got != "" {
			t.Fatalf("Get(%q) = %q, want empty", k, got)
		}
	}
}

func testOverwrite(t *testing.T, ctx context.Context, s Store) {
	mustPut(t, ctx, s, "o/k", "first version, longer")
	mustPut(t, ctx, s, "o/k", "second")
	if got := mustGet(t, ctx, s, "o/k"); got != "second" {
		t.Fatalf("Get = %q, want %q", got, "second")
	}
}

func testMissingKeyNotFound(t *testing.T, ctx context.Context, s Store) {
	wantNotFound(t, ctx, s, "nope/missing")
	mustPut(t, ctx, s, "file", "x")
	// A key below an existing object cannot exist either.
	wantNotFound(t, ctx, s, "file/child")
}

func testPrefixIsNotAnObject(t *testing.T, ctx context.Context, s Store) {
	mustPut(t, ctx, s, "dir/sub/obj", "x")
	wantNotFound(t, ctx, s, "dir/sub")
	wantNotFound(t, ctx, s, "dir")
	// Deleting a prefix-as-key is a no-op and does not remove children.
	if err := s.Delete(ctx, "dir/sub"); err != nil {
		t.Fatal(err)
	}
	if got := mustGet(t, ctx, s, "dir/sub/obj"); got != "x" {
		t.Fatalf("child removed by Delete of its prefix")
	}
}

func testDeleteIdempotent(t *testing.T, ctx context.Context, s Store) {
	mustPut(t, ctx, s, "d/k", "x")
	for i := range 2 {
		if err := s.Delete(ctx, "d/k"); err != nil {
			t.Fatalf("Delete #%d: %v", i+1, err)
		}
		wantNotFound(t, ctx, s, "d/k")
	}
	if err := s.Delete(ctx, "never/existed"); err != nil {
		t.Fatalf("Delete missing: %v", err)
	}
}

func testDeletePrefixScoped(t *testing.T, ctx context.Context, s Store) {
	gone := []string{"t/a/1", "t/a/2", "t/a/x/y/z", "t/a/x/w"}
	// Note: a key that is both an object and a prefix ("t/a" and "t/a/1")
	// is unsupported by FS and by MinIO, so it is not exercised here.
	kept := []string{"t/ab/1", "t/b/1", "t/a.txt", "t/a-b/1", "u/a/1"}
	for _, k := range append(append([]string{}, gone...), kept...) {
		mustPut(t, ctx, s, k, k)
	}
	if err := s.DeletePrefix(ctx, "t/a"); err != nil {
		t.Fatalf("DeletePrefix: %v", err)
	}
	for _, k := range gone {
		wantNotFound(t, ctx, s, k)
	}
	for _, k := range kept {
		if got := mustGet(t, ctx, s, k); got != k {
			t.Fatalf("Get(%q) = %q after DeletePrefix", k, got)
		}
	}
	// Trailing slash form and missing prefixes are fine.
	if err := s.DeletePrefix(ctx, "t/b/"); err != nil {
		t.Fatal(err)
	}
	wantNotFound(t, ctx, s, "t/b/1")
	if err := s.DeletePrefix(ctx, "no/such/prefix"); err != nil {
		t.Fatalf("DeletePrefix missing: %v", err)
	}
	// Empty prefix ("everything") is refused.
	for _, p := range []string{"", "/"} {
		if err := s.DeletePrefix(ctx, p); !errors.Is(err, ErrInvalidKey) {
			t.Fatalf("DeletePrefix(%q) = %v, want ErrInvalidKey", p, err)
		}
	}
	if got := mustGet(t, ctx, s, "u/a/1"); got != "u/a/1" {
		t.Fatal("unrelated object removed")
	}
}

var invalidKeys = []string{
	"",
	"../x",
	"a/../../x",
	"/abs",
	"a//b",
	"a/./b",
	".",
	"..",
	"a/",
	"has space",
	"a/b c",
	`a\b`,
	"a/b?c",
	"ümlaut",
	"a\x00b",
	strings.Repeat("a", MaxKeyLen+1),
}

func testInvalidKeysRejected(t *testing.T, ctx context.Context, s Store) {
	for _, k := range invalidKeys {
		if err := s.Put(ctx, k, strings.NewReader("x"), 1, ""); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("Put(%q) = %v, want ErrInvalidKey", truncate(k), err)
		}
		if rc, err := s.Get(ctx, k); !errors.Is(err, ErrInvalidKey) {
			if rc != nil {
				rc.Close()
			}
			t.Errorf("Get(%q) = %v, want ErrInvalidKey", truncate(k), err)
		}
		if err := s.Delete(ctx, k); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("Delete(%q) = %v, want ErrInvalidKey", truncate(k), err)
		}
		if k == "a/" {
			continue // valid as a prefix (trailing slash is optional)
		}
		if err := s.DeletePrefix(ctx, k); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("DeletePrefix(%q) = %v, want ErrInvalidKey", truncate(k), err)
		}
	}
	if err := s.Put(ctx, "ok/key", strings.NewReader("x"), -2, ""); err == nil {
		t.Error("Put with size -2 succeeded")
	}
	// The longest valid key is accepted by the key check.
	if !ValidKey(strings.Repeat("a", MaxKeyLen)) {
		t.Error("1024-byte key rejected")
	}
}

func testSizeMismatchKeepsOld(t *testing.T, ctx context.Context, s Store) {
	mustPut(t, ctx, s, "m/k", "old")
	// Body shorter than declared.
	err := s.Put(ctx, "m/k", strings.NewReader("new"), 10, "")
	if !errors.Is(err, ErrSizeMismatch) {
		t.Fatalf("short body: err = %v, want ErrSizeMismatch", err)
	}
	// Body longer than declared.
	err = s.Put(ctx, "m/k", strings.NewReader("newer"), 3, "")
	if !errors.Is(err, ErrSizeMismatch) {
		t.Fatalf("long body: err = %v, want ErrSizeMismatch", err)
	}
	if got := mustGet(t, ctx, s, "m/k"); got != "old" {
		t.Fatalf("Get after failed puts = %q, want %q", got, "old")
	}
	// A failed first write leaves nothing behind.
	if err := s.Put(ctx, "m/new", strings.NewReader("ab"), 5, ""); err == nil {
		t.Fatal("short body accepted")
	}
	wantNotFound(t, ctx, s, "m/new")
}

// genReader deterministically generates n pseudo-random bytes without
// holding them in memory.
type genReader struct {
	state uint64
	left  int64
}

func newGenReader(seed uint64, n int64) *genReader { return &genReader{state: seed | 1, left: n} }

func (g *genReader) Read(p []byte) (int, error) {
	if g.left <= 0 {
		return 0, io.EOF
	}
	if int64(len(p)) > g.left {
		p = p[:g.left]
	}
	for i := range p {
		g.state ^= g.state << 13
		g.state ^= g.state >> 7
		g.state ^= g.state << 17
		p[i] = byte(g.state)
	}
	g.left -= int64(len(p))
	return len(p), nil
}

func hashOf(t *testing.T, r io.Reader) ([]byte, int64) {
	t.Helper()
	h := sha256.New()
	n, err := io.Copy(h, r)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	return h.Sum(nil), n
}

func testLargeStreaming(t *testing.T, ctx context.Context, s Store, n, declared int64) {
	const key = "large/v3/original"
	want, _ := hashOf(t, newGenReader(42, n))
	if err := s.Put(ctx, key, newGenReader(42, n), declared, "application/pdf"); err != nil {
		t.Fatalf("Put: %v", err)
	}
	rc, err := s.Get(ctx, key)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	defer rc.Close()
	got, gotN := hashOf(t, rc)
	if gotN != n || !bytes.Equal(got, want) {
		t.Fatalf("round trip mismatch: got %d bytes, want %d (hash equal: %v)", gotN, n, bytes.Equal(got, want))
	}
}

func testLargeSizeMismatchKeepsOld(t *testing.T, ctx context.Context, s Store) {
	mustPut(t, ctx, s, "big/k", "old")
	// Declared above the multipart threshold, body 1 MiB short.
	const declared = 18 << 20
	err := s.Put(ctx, "big/k", newGenReader(7, declared-(1<<20)), declared, "")
	if !errors.Is(err, ErrSizeMismatch) {
		t.Fatalf("err = %v, want ErrSizeMismatch", err)
	}
	if got := mustGet(t, ctx, s, "big/k"); got != "old" {
		t.Fatalf("Get after failed large put = %q, want %q", got, "old")
	}
}

func testConcurrentPuts(t *testing.T, ctx context.Context, s Store) {
	const n = 24
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := range n {
		wg.Go(func() {
			key := fmt.Sprintf("c/docs/%02d/v1/original", i)
			body := strings.Repeat(fmt.Sprintf("doc-%02d;", i), 1000+i)
			if err := s.Put(ctx, key, strings.NewReader(body), int64(len(body)), "text/plain"); err != nil {
				errs <- fmt.Errorf("Put(%q): %w", key, err)
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	for i := range n {
		key := fmt.Sprintf("c/docs/%02d/v1/original", i)
		want := strings.Repeat(fmt.Sprintf("doc-%02d;", i), 1000+i)
		if got := mustGet(t, ctx, s, key); got != want {
			t.Errorf("Get(%q): content mismatch (len %d, want %d)", key, len(got), len(want))
		}
	}
}

func testCancelledContext(t *testing.T, _ context.Context, s Store) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.Put(ctx, "cx/k", strings.NewReader("x"), 1, ""); err == nil {
		t.Error("Put with cancelled context succeeded")
	}
	if err := s.Put(ctx, "cx/big", newGenReader(1, 20<<20), -1, ""); err == nil {
		t.Error("large Put with cancelled context succeeded")
	}
	wantNotFound(t, context.Background(), s, "cx/k")
	wantNotFound(t, context.Background(), s, "cx/big")
}

func testPing(t *testing.T, ctx context.Context, s Store) {
	if err := s.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}
