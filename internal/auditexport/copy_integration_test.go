package auditexport

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

// failingStore refuses writes, or returns other bytes than were written.
type failingStore struct {
	blob.Store
	refuse, tamper bool
}

func (s *failingStore) Put(ctx context.Context, key string, r io.Reader, n int64, ct string) error {
	if s.refuse {
		return errors.New("bucket unavailable")
	}
	return s.Store.Put(ctx, key, r, n, ct)
}

func (s *failingStore) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	if s.tamper {
		return io.NopCloser(bytes.NewReader([]byte("not what was written"))), nil
	}
	return s.Store.Get(ctx, key)
}

// A completed day is copied to the external bucket with its payload and envelope, verified by reading them back; a failure is
// classified and retried later; a copy is idempotent; a local payload that doesn't match its signed manifest is never copied.
func TestExternalCopy(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if _, err := pool.Exec(ctx, `INSERT INTO audit_log (occurred_at,actor_kind,action,target_type,target_id) SELECT $1::timestamptz + i*interval '1 minute','system','team.update','team','00000000-0000-0000-0000-000000000001' FROM generate_series(1,40) i`, day); err != nil {
		t.Fatal(err)
	}
	id, err := Freeze(ctx, pool, day, audit.Entry{ActorKind: audit.ActorSystem})
	if err != nil {
		t.Fatal(err)
	}
	local, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer local.Close()
	env, err := Publish(ctx, pool, local, id, fixtureKey(1))
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer bucket.Close()
	dest := &failingStore{Store: bucket, refuse: true}
	clock := time.Now()
	c := &Copier{Pool: pool, Store: local, Dest: dest, Log: testutil.Logger(), Now: func() time.Time { return clock }}
	q := dbgen.New(pool)

	// The bucket refuses: classified, backed off, not due until later.
	if n, err := c.Run(ctx); err != nil || n != 0 {
		t.Fatalf("refused run = %d %v", n, err)
	}
	row, _ := q.GetAuditExport(ctx, id)
	if row.CopiedAt != nil || row.CopyErrorClass != CopyErrorWrite || row.CopyFailures != 1 || row.CopyNextAt == nil {
		t.Fatalf("after a refusal: %+v", row)
	}
	if due, _ := q.DueAuditExportCopies(ctx, 5); len(due) != 0 {
		t.Fatal("a backing-off day is due")
	}
	// What comes back differs: not counted as copied.
	dest.refuse, dest.tamper = false, true
	if _, err := pool.Exec(ctx, `UPDATE audit_exports SET copy_next_at = NULL`); err != nil {
		t.Fatal(err)
	}
	if n, _ := c.Run(ctx); n != 0 {
		t.Fatal("a copy that reads back differently counted")
	}
	if row, _ = q.GetAuditExport(ctx, id); row.CopyErrorClass != CopyErrorVerify {
		t.Fatalf("after tampering: %+v", row)
	}
	// It works: both objects, the exact bytes.
	dest.tamper = false
	if _, err := pool.Exec(ctx, `UPDATE audit_exports SET copy_next_at = NULL`); err != nil {
		t.Fatal(err)
	}
	if n, err := c.Run(ctx); err != nil || n != 1 {
		t.Fatalf("copy = %d %v", n, err)
	}
	payloadKey, envelopeKey := copyKeys("2026-01-01")
	r, err := bucket.Get(ctx, payloadKey)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.New()
	_, _ = io.Copy(h, r)
	r.Close()
	if hex.EncodeToString(h.Sum(nil)) != env.Manifest.PayloadHash {
		t.Fatal("the copied payload isn't the signed one")
	}
	row, _ = q.GetAuditExport(ctx, id)
	er, err := bucket.Get(ctx, envelopeKey)
	if err != nil {
		t.Fatal(err)
	}
	gotEnv, _ := io.ReadAll(er)
	er.Close()
	if !bytes.Equal(gotEnv, row.Envelope) || row.CopiedAt == nil || row.CopyErrorClass != "" || row.CopyFailures != 0 {
		t.Fatalf("after the copy: %+v", row)
	}
	if n, _ := c.Run(ctx); n != 0 {
		t.Fatal("a copied day was copied again")
	}

	// A local payload that no longer matches its signed manifest is never copied.
	if _, err := pool.Exec(ctx, `UPDATE audit_exports SET copied_at = NULL`); err != nil {
		t.Fatal(err)
	}
	if err := local.Put(ctx, *row.ObjectKey, bytes.NewReader([]byte("tampered\n")), 9, "application/x-ndjson"); err != nil {
		t.Fatal(err)
	}
	if n, _ := c.Run(ctx); n != 0 {
		t.Fatal("a tampered payload was copied")
	}
	if row, _ = q.GetAuditExport(ctx, id); row.CopyErrorClass != CopyErrorHash {
		t.Fatalf("after local tampering: %+v", row)
	}
}

// The same copy against a real S3 server (CI's MinIO; skipped without GROUNDED_TEST_S3_ENDPOINT), under a prefix of its own.
func TestExternalCopyToS3(t *testing.T) {
	endpoint := os.Getenv("GROUNDED_TEST_S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("GROUNDED_TEST_S3_ENDPOINT not set")
	}
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	day := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	if _, err := pool.Exec(ctx, `INSERT INTO audit_log (occurred_at,actor_kind,action,target_type) SELECT $1::timestamptz + i*interval '1 minute','system','team.update','team' FROM generate_series(1,10) i`, day); err != nil {
		t.Fatal(err)
	}
	id, err := Freeze(ctx, pool, day, audit.Entry{ActorKind: audit.ActorSystem})
	if err != nil {
		t.Fatal(err)
	}
	local, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer local.Close()
	env, err := Publish(ctx, pool, local, id, fixtureKey(1))
	if err != nil {
		t.Fatal(err)
	}
	dest, err := blob.NewS3(ctx, blob.S3Config{Endpoint: endpoint, Region: os.Getenv("GROUNDED_TEST_S3_REGION"), Bucket: os.Getenv("GROUNDED_TEST_S3_BUCKET"),
		AccessKey: os.Getenv("GROUNDED_TEST_S3_ACCESS_KEY"), SecretKey: os.Getenv("GROUNDED_TEST_S3_SECRET_KEY"), ForcePathStyle: true,
		CAFile: os.Getenv("GROUNDED_TEST_S3_CA_FILE"), Prefix: "copy-test-" + uuid.NewString() + "/"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dest.DeletePrefix(context.Background(), "audit-exports/") })
	c := &Copier{Pool: pool, Store: local, Dest: dest, Log: testutil.Logger()}
	if n, err := c.Run(ctx); err != nil || n != 1 {
		t.Fatalf("copy to S3 = %d %v", n, err)
	}
	payloadKey, _ := copyKeys("2026-02-01")
	got, err := c.hashOf(ctx, payloadKey)
	if err != nil || got != env.Manifest.PayloadHash {
		t.Fatalf("payload in S3 = %s %v, want %s", got, err, env.Manifest.PayloadHash)
	}
}

func TestCopyBackoff(t *testing.T) {
	if copyBackoff(0) != time.Minute || copyBackoff(2) != 4*time.Minute || copyBackoff(30) != 6*time.Hour {
		t.Fatal(copyBackoff(0), copyBackoff(2), copyBackoff(30))
	}
}
