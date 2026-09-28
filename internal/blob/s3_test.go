package blob

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// S3 tests run against a real S3-compatible endpoint when configured:
//
//	docker compose --profile s3 up -d minio minio-init
//	GROUNDED_TEST_S3_ENDPOINT=http://127.0.0.1:59000 GROUNDED_TEST_S3_BUCKET=grounded \
//	GROUNDED_TEST_S3_ACCESS_KEY=grounded GROUNDED_TEST_S3_SECRET_KEY=grounded-dev-only-secret \
//	go test ./internal/blob/
//
// Optional: GROUNDED_TEST_S3_REGION, GROUNDED_TEST_S3_CA_FILE. Every store created by
// a test uses a random key prefix that is deleted on cleanup. Without an
// endpoint the tests are skipped, or fail when CI=true.

func s3TestConfig(t *testing.T) S3Config {
	t.Helper()
	endpoint := os.Getenv("GROUNDED_TEST_S3_ENDPOINT")
	if endpoint == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("GROUNDED_TEST_S3_ENDPOINT is not set (required when CI=true)")
		}
		t.Skip("GROUNDED_TEST_S3_ENDPOINT not set; skipping S3 tests")
	}
	cfg := S3Config{
		Endpoint:       endpoint,
		Region:         os.Getenv("GROUNDED_TEST_S3_REGION"),
		Bucket:         os.Getenv("GROUNDED_TEST_S3_BUCKET"),
		AccessKey:      os.Getenv("GROUNDED_TEST_S3_ACCESS_KEY"),
		SecretKey:      os.Getenv("GROUNDED_TEST_S3_SECRET_KEY"),
		ForcePathStyle: true,
		CAFile:         os.Getenv("GROUNDED_TEST_S3_CA_FILE"),
	}
	if cfg.Bucket == "" {
		t.Fatal("GROUNDED_TEST_S3_BUCKET must be set with GROUNDED_TEST_S3_ENDPOINT")
	}
	return cfg
}

func randomHex(t *testing.T, n int) string {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}

// newTestS3 returns a store confined to a fresh random prefix and registers
// cleanup of everything under it (via an unprefixed store).
func newTestS3(t *testing.T) Store {
	t.Helper()
	cfg := s3TestConfig(t)
	root := "grounded-blob-test-" + randomHex(t, 8)
	cfg.Prefix = root + "/"
	ctx := context.Background()
	s, err := NewS3(ctx, cfg)
	if err != nil {
		t.Fatalf("NewS3: %v", err)
	}
	cfg.Prefix = ""
	admin, err := NewS3(ctx, cfg)
	if err != nil {
		t.Fatalf("NewS3: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := admin.DeletePrefix(ctx, root); err != nil {
			t.Errorf("cleanup of %s: %v", root, err)
		}
	})
	return s
}

func TestS3Conformance(t *testing.T) {
	s3TestConfig(t) // skip early if unconfigured
	runConformance(t, newTestS3)
}

func TestS3PrefixIsolation(t *testing.T) {
	ctx := context.Background()
	cfg := s3TestConfig(t)
	root := "grounded-blob-test-" + randomHex(t, 8)
	cfg.Prefix = ""
	admin, err := NewS3(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.DeletePrefix(context.Background(), root) })

	cfg.Prefix = root + "/inner" // no trailing slash: normalised
	inner, err := NewS3(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	mustPut(t, ctx, inner, "k", "v")
	if got := mustGet(t, ctx, admin, root+"/inner/k"); got != "v" {
		t.Fatalf("object not stored under prefix: %q", got)
	}
	mustPut(t, ctx, admin, root+"/other/k", "o")
	if err := inner.DeletePrefix(ctx, "k"); err != nil {
		t.Fatal(err)
	}
	if got := mustGet(t, ctx, admin, root+"/other/k"); got != "o" {
		t.Fatal("prefixed store touched objects outside its prefix")
	}
}

// TestS3DeletePrefixManyObjects exercises pagination and 1000-key batching.
func TestS3DeletePrefixManyObjects(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	s := newTestS3(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	const n = 2100
	sem := make(chan struct{}, 32)
	errs := make(chan error, n)
	for i := range n {
		sem <- struct{}{}
		go func() {
			defer func() { <-sem }()
			key := fmt.Sprintf("many/%04d", i)
			errs <- s.Put(ctx, key, strings.NewReader("x"), 1, "")
		}()
	}
	for range n {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	mustPut(t, ctx, s, "keep/me", "k")
	if err := s.DeletePrefix(ctx, "many"); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"many/0000", "many/0999", "many/1000", "many/2099"} {
		wantNotFound(t, ctx, s, k)
	}
	if got := mustGet(t, ctx, s, "keep/me"); got != "k" {
		t.Fatal("DeletePrefix removed an unrelated object")
	}
}

func TestS3MissingBucket(t *testing.T) {
	ctx := context.Background()
	cfg := s3TestConfig(t)
	cfg.Bucket = "grounded-missing-" + randomHex(t, 6)
	s, err := NewS3(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Ping(ctx); err == nil {
		t.Fatal("Ping succeeded for a missing bucket")
	}
	// A missing bucket is a configuration error, not a missing object.
	if _, err := s.Get(ctx, "k"); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("Get on missing bucket: err = %v, want non-ErrNotFound error", err)
	}
}

func TestS3BadCredentials(t *testing.T) {
	ctx := context.Background()
	cfg := s3TestConfig(t)
	cfg.SecretKey = "definitely-wrong"
	s, err := NewS3(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Ping(ctx); err == nil {
		t.Fatal("Ping succeeded with bad credentials")
	}
}

func TestNewS3Validation(t *testing.T) {
	ctx := context.Background()
	if _, err := NewS3(ctx, S3Config{}); err == nil {
		t.Error("missing bucket accepted")
	}
	if _, err := NewS3(ctx, S3Config{Bucket: "b", AccessKey: "a"}); err == nil {
		t.Error("access key without secret accepted")
	}
	for _, p := range []string{"../x", "/abs/", "a//b", "has space/"} {
		if _, err := NewS3(ctx, S3Config{Bucket: "b", Prefix: p}); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("prefix %q: err = %v, want ErrInvalidKey", p, err)
		}
	}
	bad := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(bad, []byte("not a certificate"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewS3(ctx, S3Config{Bucket: "b", CAFile: bad}); err == nil {
		t.Error("invalid CA file accepted")
	}
	if _, err := NewS3(ctx, S3Config{Bucket: "b", CAFile: filepath.Join(t.TempDir(), "missing.pem")}); err == nil {
		t.Error("missing CA file accepted")
	}
	s, err := NewS3(ctx, S3Config{Bucket: "b", Endpoint: "http://127.0.0.1:1", AccessKey: "a", SecretKey: "s", Prefix: "grounded/"})
	if err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	if s.prefix != "grounded/" || s.objectKey("x/y") != "grounded/x/y" {
		t.Errorf("prefix = %q, objectKey = %q", s.prefix, s.objectKey("x/y"))
	}
}
