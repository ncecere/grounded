package auditexport

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

// Once cleanup fences an attempt, even a later valid publisher cannot expose
// its object. Interrupted deletion remains durably retryable.
func TestPGOrphanCleanupFencesPublication(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	q := dbgen.New(pool)
	id, err := Freeze(ctx, pool, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), audit.Entry{ActorKind: audit.ActorSystem})
	if err != nil {
		t.Fatal(err)
	}
	fs, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer fs.Close()
	key := "audit-exports/" + uuid.NewString() + "/orphan"
	if err = q.JournalAuditExportUpload(ctx, key); err != nil {
		t.Fatal(err)
	}
	if err = fs.Put(ctx, key, strings.NewReader("orphan"), 6, "application/x-ndjson"); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, "UPDATE audit_export_uploads SET expires_at=now()-interval '1 minute'"); err != nil {
		t.Fatal(err)
	}
	keys, err := q.ExpiredAuditExportUploads(ctx)
	if err != nil || len(keys) != 1 {
		t.Fatal(keys, err)
	}
	// Simulate a cleanup crash after claiming but before object deletion. A
	// clock/expiry extension must not revoke the durable deleting fence.
	if _, err = pool.Exec(ctx, "UPDATE audit_export_uploads SET expires_at=now()+interval '1 minute'"); err != nil {
		t.Fatal(err)
	}
	envelope := []byte("{}")
	hash := "not-a-signature"
	n, err := q.PublishAuditExport(ctx, dbgen.PublishAuditExportParams{ID: id, ObjectKey: &key, Envelope: envelope, EnvelopeHash: &hash})
	if err != nil || n != 0 {
		t.Fatalf("fenced upload published: %d %v", n, err)
	}
	if _, err = pool.Exec(ctx, "UPDATE audit_export_uploads SET expires_at=now()-interval '1 minute'"); err != nil {
		t.Fatal(err)
	}
	worker := TickWorker{S: New(pool, fs, nil, "")}
	if err = worker.Work(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = fs.Get(ctx, key); err == nil {
		t.Fatal("orphan retained")
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM audit_export_uploads").Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
}
func TestSpoolConcurrencyCancellation(t *testing.T) {
	ctx := context.Background()
	if err := takeSpool(ctx); err != nil {
		t.Fatal(err)
	}
	defer releaseSpool()
	if err := takeSpool(ctx); err != nil {
		t.Fatal(err)
	}
	defer releaseSpool()
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err := takeSpool(canceled); err == nil {
		t.Fatal("unbounded spool admitted")
	}
}
