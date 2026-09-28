// Package blob stores document originals and derived artifacts (for example
// parsed Markdown) in object storage.
//
// Two backends implement [Store]: [FS] keeps objects as files under a local
// directory (development and tests) and [S3] talks to any S3-compatible
// service (production). Both accept only keys for which [ValidKey] is true,
// so a key can never address anything outside the store.
//
// Prefixes passed to DeletePrefix are matched on whole path segments: the
// prefix "teams/a" covers "teams/a/x" but not "teams/ab/x". A trailing "/" is
// optional.
//
// Callers must not use a key that is also a prefix of another key (for example
// both "a" and "a/b"): the filesystem backend cannot represent it and some
// S3-compatible servers (MinIO) handle it inconsistently.
package blob

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
)

// ErrNotFound is returned (possibly wrapped) by Get when the key does not exist.
var ErrNotFound = errors.New("blob: not found")

// ErrInvalidKey is returned (wrapped) when a key or prefix fails [ValidKey].
var ErrInvalidKey = errors.New("blob: invalid key")

// ErrSizeMismatch is returned (wrapped) by Put when the reader yields more or
// fewer bytes than the declared size. The previous object, if any, is kept.
var ErrSizeMismatch = errors.New("blob: size mismatch")

// Store is an object store addressed by '/'-separated keys.
type Store interface {
	// Put stores exactly size bytes from r under key (overwriting). size may be -1 if unknown.
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	// Get returns the object's content; ErrNotFound (wrapped is fine) if missing. Caller closes.
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	// Delete removes key; deleting a missing key is not an error.
	Delete(ctx context.Context, key string) error
	// DeletePrefix removes every object under prefix (used when a document/source/team is purged).
	DeletePrefix(ctx context.Context, prefix string) error
	// Ping checks the store is reachable/writable enough for readiness probes.
	Ping(ctx context.Context) error
}

// MaxKeyLen is the maximum key length in bytes (the S3 limit).
const MaxKeyLen = 1024

// ValidKey reports whether key is safe: non-empty, <= 1024 bytes, relative, '/'-separated,
// segments of [A-Za-z0-9._-] only, no empty/./.. segments. Both backends reject invalid keys.
func ValidKey(key string) bool {
	if key == "" || len(key) > MaxKeyLen {
		return false
	}
	segStart := 0
	for i := 0; i <= len(key); i++ {
		if i < len(key) && key[i] != '/' {
			if !validKeyByte(key[i]) {
				return false
			}
			continue
		}
		seg := key[segStart:i]
		if seg == "" || seg == "." || seg == ".." {
			return false
		}
		segStart = i + 1
	}
	return true
}

func validKeyByte(c byte) bool {
	switch {
	case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		return true
	case c == '.', c == '_', c == '-':
		return true
	}
	return false
}

func checkKey(key string) error {
	if !ValidKey(key) {
		return fmt.Errorf("%w: %q", ErrInvalidKey, truncate(key))
	}
	return nil
}

// normalizePrefix validates a DeletePrefix argument and returns it without a
// trailing slash. An empty prefix (which would mean "everything") is rejected.
func normalizePrefix(prefix string) (string, error) {
	p := strings.TrimSuffix(prefix, "/")
	if !ValidKey(p) {
		return "", fmt.Errorf("%w: prefix %q", ErrInvalidKey, truncate(prefix))
	}
	return p, nil
}

func truncate(s string) string {
	const max = 64
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func checkSize(size int64) error {
	if size < -1 {
		return fmt.Errorf("blob: invalid size %d", size)
	}
	return nil
}

// exactReader enforces the declared size of a Put body. It fails with
// ErrSizeMismatch on a short body (instead of a clean EOF) and as soon as more
// than size bytes are seen, so a truncated or oversized upload is never
// committed. It also stops early when ctx is cancelled.
type exactReader struct {
	ctx  context.Context
	r    io.Reader
	size int64 // -1: unknown, only ctx is checked
	n    int64
}

func newExactReader(ctx context.Context, r io.Reader, size int64) *exactReader {
	if r == nil {
		r = strings.NewReader("")
	}
	return &exactReader{ctx: ctx, r: r, size: size}
}

func (e *exactReader) Read(p []byte) (int, error) {
	if err := e.ctx.Err(); err != nil {
		return 0, err
	}
	if e.size >= 0 && int64(len(p)) > e.size-e.n+1 {
		// Never ask for more than one byte past the declared size.
		p = p[:e.size-e.n+1]
	}
	n, err := e.r.Read(p)
	e.n += int64(n)
	if e.size >= 0 {
		if e.n > e.size {
			return n, fmt.Errorf("%w: body longer than declared %d bytes", ErrSizeMismatch, e.size)
		}
		if err == io.EOF && e.n < e.size {
			return n, fmt.Errorf("%w: body is %d bytes, declared %d", ErrSizeMismatch, e.n, e.size)
		}
	}
	return n, err
}
