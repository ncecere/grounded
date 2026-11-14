package auditexport

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// External copies (docs/signed-daily-audit-export.md, "External copy"): after a day is published in Grounded's own storage,
// its payload and signed envelope are copied to an operator-configured bucket (ideally write-once: S3 Object Lock), where
// someone other than Grounded's admins keeps the checkpoints a signature alone can't prove. Copies are idempotent
// (deterministic keys, the same bytes), verified by reading them back, and retried with backoff.

// Copy error classes, shown per day (never a storage error's text).
const (
	CopyErrorRead   = "read"   // Grounded's own copy couldn't be read
	CopyErrorHash   = "hash"   // Grounded's own payload doesn't match its signed manifest
	CopyErrorWrite  = "write"  // the external bucket refused or failed the upload
	CopyErrorVerify = "verify" // what the bucket returned differs from what was written
)

const (
	copyBatch      = 5
	copyMinBackoff = time.Minute
	copyMaxBackoff = 6 * time.Hour
	// CopyAttentionFailures is how many failures in a row put a day under Needs attention.
	CopyAttentionFailures = 3
)

// copyKeys are the object keys of a day's copy, under the bucket's prefix.
func copyKeys(day string) (payload, envelope string) {
	return "audit-exports/" + day + "/payload.jsonl", "audit-exports/" + day + "/envelope.json"
}

// Copier copies completed exports from Grounded's storage to the external bucket.
type Copier struct {
	Pool  *pgxpool.Pool
	Store blob.Store // Grounded's own storage
	Dest  blob.Store // the operator's bucket
	Log   *slog.Logger
	Now   func() time.Time
}

func (c *Copier) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

type copyError struct{ class string }

func (e *copyError) Error() string { return "audit export copy: " + e.class }

// Run copies the due exports, oldest day first, and reports how many it copied.
func (c *Copier) Run(ctx context.Context) (int, error) {
	q := dbgen.New(c.Pool)
	due, err := q.DueAuditExportCopies(ctx, copyBatch)
	if err != nil {
		return 0, err
	}
	copied := 0
	for _, d := range due {
		err := c.copyOne(ctx, d.ID, d.Day.Time.Format(time.DateOnly))
		var ce *copyError
		switch {
		case err == nil:
			if err := q.MarkAuditExportCopied(ctx, d.ID); err != nil {
				return copied, err
			}
			copied++
		case errors.As(err, &ce):
			e, gerr := q.GetAuditExport(ctx, d.ID)
			if gerr != nil {
				return copied, gerr
			}
			next := c.now().Add(copyBackoff(e.CopyFailures))
			if ferr := q.FailAuditExportCopy(ctx, dbgen.FailAuditExportCopyParams{ID: d.ID, ErrorClass: ce.class, NextAt: &next}); ferr != nil {
				return copied, ferr
			}
			c.Log.WarnContext(ctx, "audit export copy failed", "day", d.Day.Time.Format(time.DateOnly), "class", ce.class, "retry_at", next)
		default:
			return copied, err
		}
	}
	return copied, nil
}

func copyBackoff(failures int32) time.Duration {
	d := copyMinBackoff
	for i := int32(0); i < failures && d < copyMaxBackoff; i++ {
		d *= 2
	}
	return min(d, copyMaxBackoff)
}

// copyOne copies one day: the payload is spooled from Grounded's storage to a private temporary file while its SHA-256 is
// checked against the signed manifest, then both objects are written and read back.
func (c *Copier) copyOne(ctx context.Context, id uuid.UUID, day string) error {
	env, r, err := Open(ctx, c.Pool, c.Store, id)
	if err != nil {
		return &copyError{CopyErrorRead}
	}
	defer r.Close()
	tmp, err := os.CreateTemp("", "grounded-export-copy-*")
	if err != nil {
		return err
	}
	_ = os.Remove(tmp.Name()) // unlinked at once: only this process can reach it
	defer tmp.Close()
	h := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(r, MaxPayloadBytes+1))
	if err != nil || size > MaxPayloadBytes {
		return &copyError{CopyErrorRead}
	}
	payloadHash := hex.EncodeToString(h.Sum(nil))
	if payloadHash != env.Manifest.PayloadHash {
		return &copyError{CopyErrorHash}
	}
	row, err := dbgen.New(c.Pool).GetAuditExport(ctx, id)
	if err != nil {
		return err
	}
	payloadKey, envelopeKey := copyKeys(day)
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if err := c.Dest.Put(ctx, payloadKey, tmp, size, "application/x-ndjson"); err != nil {
		return &copyError{CopyErrorWrite}
	}
	if err := c.Dest.Put(ctx, envelopeKey, bytes.NewReader(row.Envelope), int64(len(row.Envelope)), "application/json"); err != nil {
		return &copyError{CopyErrorWrite}
	}
	// Read both back: a copy counts only once the bucket returns exactly what was written.
	if got, err := c.hashOf(ctx, payloadKey); err != nil || got != payloadHash {
		return &copyError{CopyErrorVerify}
	}
	want := sha256.Sum256(row.Envelope)
	if got, err := c.hashOf(ctx, envelopeKey); err != nil || got != hex.EncodeToString(want[:]) {
		return &copyError{CopyErrorVerify}
	}
	return nil
}

func (c *Copier) hashOf(ctx context.Context, key string) (string, error) {
	r, err := c.Dest.Get(ctx, key)
	if err != nil {
		return "", err
	}
	defer r.Close()
	h := sha256.New()
	if _, err := io.Copy(h, io.LimitReader(r, MaxPayloadBytes+1)); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// CopyArgs runs a copy round.
type CopyArgs struct{}

func (CopyArgs) Kind() string { return "audit_exports.copy" }

func (CopyArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: 1, UniqueOpts: river.UniqueOpts{ByState: []rivertype.JobState{
		rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRunning, rivertype.JobStateRetryable, rivertype.JobStateScheduled,
	}}}
}

// CopyWorker runs copy rounds.
type CopyWorker struct {
	river.WorkerDefaults[CopyArgs]
	C *Copier
}

func (*CopyWorker) Timeout(*river.Job[CopyArgs]) time.Duration { return 10 * time.Minute }

func (w *CopyWorker) Work(ctx context.Context, _ *river.Job[CopyArgs]) error {
	_, err := w.C.Run(ctx)
	return err
}

// CopyPeriodic runs a copy round every 5 minutes (and on start).
func CopyPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(5*time.Minute), func() (river.JobArgs, *river.InsertOpts) { return CopyArgs{}, nil },
		&river.PeriodicJobOpts{RunOnStart: true})
}
