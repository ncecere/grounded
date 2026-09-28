package blob

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"syscall"
)

const (
	fsDirPerm  = 0o700
	fsFilePerm = 0o600
	// tmpMarker contains '~', which ValidKey never allows, so temporary and
	// probe files can never collide with (or be addressed as) object keys.
	tmpMarker = ".blob~tmp~"
)

// FS is a [Store] that keeps each object as a file under a root directory.
//
// All file-system access goes through an [os.Root], so neither key contents
// nor symlinks planted inside the directory can reach files outside it.
// Content types are not persisted. Because objects are files, a key cannot be
// both an object and a prefix of another object (e.g. "a" and "a/b"); Put
// returns an error in that case.
type FS struct {
	dir  string
	root *os.Root
}

var _ Store = (*FS)(nil)

// NewFS stores objects as files under dir (created if missing). Writes are atomic
// (temp file + rename in the same directory, fsync). Keys map to paths under dir
// and can never escape it.
func NewFS(dir string) (*FS, error) {
	if dir == "" {
		return nil, errors.New("blob: fs: empty directory")
	}
	if err := os.MkdirAll(dir, fsDirPerm); err != nil {
		return nil, fmt.Errorf("blob: fs: create %s: %w", dir, err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("blob: fs: open %s: %w", dir, err)
	}
	return &FS{dir: dir, root: root}, nil
}

// Dir returns the directory the store was opened on.
func (s *FS) Dir() string { return s.dir }

// Close releases the directory handle. The store must not be used afterwards.
func (s *FS) Close() error { return s.root.Close() }

// Put implements [Store]. The object becomes visible atomically: readers see
// either the previous content or the complete new content, never a mix.
func (s *FS) Put(ctx context.Context, key string, r io.Reader, size int64, _ string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	if err := checkSize(size); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	dir := path.Dir(key)
	if dir != "." {
		if err := s.root.MkdirAll(dir, fsDirPerm); err != nil {
			return fmt.Errorf("blob: fs: put %q: %w", key, err)
		}
	}
	tmp, f, err := s.createTemp(dir)
	if err != nil {
		return fmt.Errorf("blob: fs: put %q: %w", key, err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = f.Close()
			_ = s.root.Remove(tmp)
		}
	}()
	if _, err = io.Copy(f, newExactReader(ctx, r, size)); err != nil {
		return fmt.Errorf("blob: fs: put %q: %w", key, err)
	}
	if err = f.Sync(); err != nil {
		return fmt.Errorf("blob: fs: put %q: sync: %w", key, err)
	}
	if err = f.Close(); err != nil {
		return fmt.Errorf("blob: fs: put %q: close: %w", key, err)
	}
	if err = s.root.Rename(tmp, key); err != nil {
		return fmt.Errorf("blob: fs: put %q: rename: %w", key, err)
	}
	committed = true
	// Persist the directory entry so the rename survives a crash.
	if err = s.syncDir(dir); err != nil {
		return fmt.Errorf("blob: fs: put %q: sync dir: %w", key, err)
	}
	return nil
}

// Get implements [Store].
func (s *FS) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := checkKey(key); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	f, err := s.root.Open(key)
	if err != nil {
		if isNotExist(err) {
			return nil, fmt.Errorf("blob: fs: get %q: %w", key, ErrNotFound)
		}
		return nil, fmt.Errorf("blob: fs: get %q: %w", key, err)
	}
	fi, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("blob: fs: get %q: %w", key, err)
	}
	if !fi.Mode().IsRegular() {
		// A directory is only a prefix of other keys, not an object.
		_ = f.Close()
		return nil, fmt.Errorf("blob: fs: get %q: %w", key, ErrNotFound)
	}
	return f, nil
}

// Delete implements [Store].
func (s *FS) Delete(ctx context.Context, key string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	fi, err := s.root.Lstat(key)
	if err != nil {
		if isNotExist(err) {
			return nil
		}
		return fmt.Errorf("blob: fs: delete %q: %w", key, err)
	}
	if fi.IsDir() {
		return nil // a prefix, not an object
	}
	if err := s.root.Remove(key); err != nil && !isNotExist(err) {
		return fmt.Errorf("blob: fs: delete %q: %w", key, err)
	}
	return nil
}

// DeletePrefix implements [Store].
func (s *FS) DeletePrefix(ctx context.Context, prefix string) error {
	p, err := normalizePrefix(prefix)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	fi, err := s.root.Lstat(p)
	if err != nil {
		if isNotExist(err) {
			return nil
		}
		return fmt.Errorf("blob: fs: delete prefix %q: %w", p, err)
	}
	if !fi.IsDir() {
		// An object named exactly p is not "under" p; nothing to do.
		return nil
	}
	if err := s.root.RemoveAll(p); err != nil {
		return fmt.Errorf("blob: fs: delete prefix %q: %w", p, err)
	}
	return nil
}

// Ping implements [Store] by creating, syncing and removing a probe file.
func (s *FS) Ping(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	name, f, err := s.createTemp(".")
	if err != nil {
		return fmt.Errorf("blob: fs: ping: %w", err)
	}
	_, werr := f.Write([]byte("ping"))
	cerr := f.Close()
	rerr := s.root.Remove(name)
	if err := errors.Join(werr, cerr, rerr); err != nil {
		return fmt.Errorf("blob: fs: ping: %w", err)
	}
	return nil
}

func (s *FS) createTemp(dir string) (string, *os.File, error) {
	var b [12]byte
	for range 10 {
		if _, err := rand.Read(b[:]); err != nil {
			return "", nil, err
		}
		name := path.Join(dir, tmpMarker+hex.EncodeToString(b[:]))
		f, err := s.root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, fsFilePerm)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		return name, f, err
	}
	return "", nil, errors.New("could not create a unique temporary file")
}

func (s *FS) syncDir(dir string) error {
	d, err := s.root.Open(dir)
	if err != nil {
		return err
	}
	serr := d.Sync()
	cerr := d.Close()
	if serr != nil && !errors.Is(serr, syscall.EINVAL) && !errors.Is(serr, syscall.ENOTSUP) {
		// Some file systems do not support fsync on directories; ignore those.
		return serr
	}
	return cerr
}

func isNotExist(err error) bool {
	// ENOTDIR: a parent segment of the key is a file, so the key cannot exist.
	return errors.Is(err, fs.ErrNotExist) || errors.Is(err, syscall.ENOTDIR)
}
