package contextual

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// Walk using directory descriptors: no component may be a symlink. The
// immediate containing directory and files must be owner-private.
func acceptanceParent(path string) (*os.File, string, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.Contains(path, "\x00") {
		return nil, "", errors.New("private_path")
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	fd, err := syscall.Open("/", syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, "", errors.New("private_path")
	}
	for _, part := range parts[:len(parts)-1] {
		next, e := syscall.Openat(fd, part, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
		syscall.Close(fd)
		if e != nil {
			return nil, "", errors.New("private_path")
		}
		fd = next
	}
	f := os.NewFile(uintptr(fd), "private-directory")
	info, err := f.Stat()
	if err != nil || info.Mode().Perm() != 0700 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) {
		f.Close()
		return nil, "", errors.New("private_directory")
	}
	return f, parts[len(parts)-1], nil
}

func acceptancePrivateParent(path string) error {
	f, _, err := acceptanceParent(path)
	if err == nil {
		err = f.Close()
	}
	return err
}

func acceptanceOpenPrivate(path string, create bool) (*os.File, error) {
	parent, name, err := acceptanceParent(path)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	flags := syscall.O_RDONLY | syscall.O_NOFOLLOW | syscall.O_CLOEXEC | syscall.O_NONBLOCK
	if create {
		flags = syscall.O_WRONLY | syscall.O_CREAT | syscall.O_EXCL | syscall.O_NOFOLLOW | syscall.O_CLOEXEC
	}
	fd, err := syscall.Openat(int(parent.Fd()), name, flags, 0600)
	if err != nil {
		return nil, errors.New("private_file")
	}
	f := os.NewFile(uintptr(fd), "private-file")
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 {
		f.Close()
		return nil, errors.New("private_file")
	}
	return f, nil
}

func acceptanceReadPrivate(path string, limit int64) ([]byte, error) {
	f, err := acceptanceOpenPrivate(path, false)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errors.New("private_read")
	}
	return b, nil
}

func acceptanceWritePrivate(path string, data []byte) error {
	if len(data) > 1<<20 {
		return errors.New("artifact_size")
	}
	f, err := acceptanceOpenPrivate(path, true)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err = f.Write(data); err != nil {
		return errors.New("artifact_write")
	}
	if err = f.Sync(); err != nil {
		return errors.New("artifact_sync")
	}
	p, _, err := acceptanceParent(path)
	if err != nil {
		return err
	}
	defer p.Close()
	return p.Sync()
}
