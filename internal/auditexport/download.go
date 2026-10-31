package auditexport

import (
	"context"
	"crypto/ed25519"
	"io"
	"os"

	"github.com/google/uuid"
)

// Download validates the entire bounded artifact before HTTP starts streaming.
// The embedded public key checks artifact consistency, NOT independent trust;
// operators must separately pin keys and external first/latest checkpoints.
func (s *Service) Download(ctx context.Context, id uuid.UUID) (file io.ReadCloser, err error) {
	if err := takeSpool(ctx); err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			releaseSpool()
		}
	}()
	e, r, err := Open(ctx, s.Pool, s.Store, id)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	f, err := os.CreateTemp("", "grounded-audit-download-*")
	if err != nil {
		return nil, ErrStorage
	}
	// Unlink immediately so cancellation/crash cannot leave a spool behind.
	_ = os.Remove(f.Name())
	defer func() {
		if err != nil {
			_ = f.Close()
		}
	}()
	n, err := io.Copy(f, io.LimitReader(r, MaxPayloadBytes+1))
	if err != nil || n > MaxPayloadBytes || ctx.Err() != nil {
		return nil, ErrStorage
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return nil, ErrStorage
	}
	if err = Verify(e, f, map[string]ed25519.PublicKey{e.Manifest.KeyID: e.PublicKey}); err != nil {
		return nil, ErrInvalid
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return nil, ErrStorage
	}
	return &downloadFile{File: f}, nil
}

type downloadFile struct{ *os.File }

func (f *downloadFile) Close() error { defer releaseSpool(); return f.File.Close() }
