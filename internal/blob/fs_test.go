package blob

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestFS(t *testing.T) Store {
	t.Helper()
	s, err := NewFS(filepath.Join(t.TempDir(), "blobs"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestFSConformance(t *testing.T) {
	runConformance(t, newTestFS)
}

func TestValidKey(t *testing.T) {
	valid := []string{
		"a",
		"original",
		"teams/0b6f1c1e-6a3b-4a39-9a0e-2f4c1d7e8a90/sources/5d2c/docs/9f1e/v3/original",
		"teams/x/sources/y/docs/z/v3/parsed.md",
		"...",
		".hidden",
		"a_b-c.D9",
		strings.Repeat("a", MaxKeyLen),
	}
	for _, k := range valid {
		if !ValidKey(k) {
			t.Errorf("ValidKey(%q) = false, want true", truncate(k))
		}
	}
	for _, k := range invalidKeys {
		if ValidKey(k) {
			t.Errorf("ValidKey(%q) = true, want false", truncate(k))
		}
	}
	for _, k := range []string{"a/b/", "a/..", "./a", "a~b", "a:b", "a\nb", "a/b/../c"} {
		if ValidKey(k) {
			t.Errorf("ValidKey(%q) = true, want false", k)
		}
	}
}

func TestFSLayoutAndNoTempFilesLeft(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s, err := NewFS(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Put(ctx, "a/b/c.md", strings.NewReader("hi"), 2, "text/markdown"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "a", "b", "c.md"))
	if err != nil || string(b) != "hi" {
		t.Fatalf("file on disk = %q, %v", b, err)
	}
	_ = s.Put(ctx, "a/b/c.md", strings.NewReader("x"), 5, "") // fails: short
	_ = s.Put(ctx, "a/b/d", strings.NewReader("xyz"), 1, "")  // fails: long
	if err := s.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	err = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if strings.Contains(d.Name(), "~") {
			t.Errorf("leftover temp file %s", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if fi, err := os.Stat(filepath.Join(dir, "a", "b", "c.md")); err != nil || fi.Mode().Perm() != fsFilePerm {
		t.Fatalf("stat = %v, %v; want perm %o", fi, err, fsFilePerm)
	}
}

func TestFSSymlinkEscapeBlocked(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("top secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "link")); err != nil {
		t.Skipf("symlinks unsupported: %v", err)
	}
	s, err := NewFS(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	if rc, err := s.Get(ctx, "link/secret"); err == nil {
		rc.Close()
		t.Fatal("Get followed a symlink out of the store")
	}
	if err := s.Put(ctx, "link/planted", strings.NewReader("x"), 1, ""); err == nil {
		t.Fatal("Put wrote through a symlink out of the store")
	}
	if _, err := os.Stat(filepath.Join(outside, "planted")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("file planted outside the store: %v", err)
	}
	_ = s.DeletePrefix(ctx, "link")
	if _, err := os.Stat(filepath.Join(outside, "secret")); err != nil {
		t.Fatalf("DeletePrefix removed a file outside the store: %v", err)
	}
}

func TestFSKeyConflictWithFile(t *testing.T) {
	ctx := context.Background()
	s := newTestFS(t)
	if err := s.Put(ctx, "a", strings.NewReader("x"), 1, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.Put(ctx, "a/b", strings.NewReader("y"), 1, ""); err == nil {
		t.Fatal("Put below an existing object succeeded on FS")
	}
	// DeletePrefix does not treat the object "a" as being under "a".
	if err := s.DeletePrefix(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	if got := mustGet(t, ctx, s, "a"); got != "x" {
		t.Fatalf("Get(a) = %q", got)
	}
}

func TestNewFSErrors(t *testing.T) {
	if _, err := NewFS(""); err == nil {
		t.Fatal("NewFS(\"\") succeeded")
	}
	f := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(f, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewFS(f); err == nil {
		t.Fatal("NewFS(file) succeeded")
	}
}

func TestFSPingFailsWhenDirRemoved(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "blobs")
	s, err := NewFS(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	if err := s.Ping(context.Background()); err == nil {
		t.Fatal("Ping succeeded after the directory was removed")
	}
}
