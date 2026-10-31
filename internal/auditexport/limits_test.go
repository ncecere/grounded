package auditexport

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestPGHardRecordLimitRollsBack(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	_, err := pool.Exec(ctx, "INSERT INTO audit_log(occurred_at,actor_kind,action,target_type) SELECT $1,'system','team.update','team' FROM generate_series(1,$2::int)", day, MaxRecords+1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Freeze(ctx, pool, day, audit.Entry{ActorKind: audit.ActorSystem}); err != ErrLimit {
		t.Fatalf("must fail closed, not truncate: %v", err)
	}
	var n int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM audit_export_facts").Scan(&n); err != nil || n != 0 {
		t.Fatalf("partial frozen facts %d %v", n, err)
	}
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM audit_exports").Scan(&n); err != nil || n != 0 {
		t.Fatalf("partial export %d %v", n, err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = Freeze(canceled, pool, day, audit.Entry{ActorKind: audit.ActorSystem}); err == nil {
		t.Fatal("canceled freeze succeeded")
	}
}
func TestPrivateOperatorKeyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	if New(nil, nil, nil, path).KeyID() != "" {
		t.Fatal("absent key ready")
	}
	for _, b := range [][]byte{nil, []byte("sk-private-canary"), bytes.Repeat([]byte{0}, 64)} {
		if err := os.WriteFile(path, b, 0600); err != nil {
			t.Fatal(err)
		}
		if New(nil, nil, nil, path).KeyID() != "" {
			t.Fatal("malformed key ready")
		}
	}
	if err := os.WriteFile(path, fixtureKey(3), 0600); err != nil {
		t.Fatal(err)
	}
	if New(nil, nil, nil, path).KeyID() == "" {
		t.Fatal("private fixture unavailable")
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if New(nil, nil, nil, path).KeyID() != "" {
		t.Fatal("public file accepted")
	}
}
func TestPGLeaseFencesAndAbortedQueue(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	q := dbgen.New(pool)
	row, err := q.CreateAuditExportRequest(ctx, dbgen.CreateAuditExportRequestParams{ID: uuid.New(), Day: date(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))})
	if err != nil {
		t.Fatal(err)
	}
	lease := uuid.NullUUID{UUID: uuid.New(), Valid: true}
	if _, err = q.ClaimAuditExportRequest(ctx, dbgen.ClaimAuditExportRequestParams{ID: row.ID, Lease: lease}); err != nil {
		t.Fatal(err)
	}
	if _, err = q.ClaimAuditExportRequest(ctx, dbgen.ClaimAuditExportRequestParams{ID: row.ID, Lease: uuid.NullUUID{UUID: uuid.New(), Valid: true}}); err == nil {
		t.Fatal("double claim")
	}
	n, err := q.FinishAuditExportRequest(ctx, dbgen.FinishAuditExportRequestParams{ID: row.ID, Lease: uuid.NullUUID{UUID: uuid.New(), Valid: true}, State: "failed", FailureCode: "export_failed"})
	if err != nil || n != 0 {
		t.Fatal("foreign owner completed", n, err)
	}
	if _, err = pool.Exec(ctx, "UPDATE audit_export_requests SET lease_until=now()-interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	if err = q.ExpireAuditExportRequests(ctx); err != nil {
		t.Fatal(err)
	}
	latest, err := q.GetAuditExportRequest(ctx, row.ID)
	if err != nil || latest.State != "failed" || latest.FailureCode != "job_aborted" {
		t.Fatal(latest, err)
	}
	n, err = q.FinishAuditExportRequest(ctx, dbgen.FinishAuditExportRequestParams{ID: row.ID, Lease: lease, State: "completed"})
	if err != nil || n != 0 {
		t.Fatal("expired owner completed", n, err)
	}
}

// Deliberately corrupt the frozen fixture projection to exceed the byte limit
// with fewer than MaxRecords. This must fail before journaling/upload/signing;
// normal source projection cannot contain this unbounded action.
func TestPGSpoolByteLimitFailsClosed(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	id, err := Freeze(ctx, pool, day, audit.Entry{ActorKind: audit.ActorSystem})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, "INSERT INTO audit_export_facts(export_id,source_id,occurred_at,actor_kind,action,target_type,target_id) SELECT $1,i,$2,'system',$3,'team','' FROM generate_series(1,64) i", id, day, string(bytes.Repeat([]byte{'x'}, 1<<20)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Publish(ctx, pool, nil, id, fixtureKey(1)); err != ErrLimit {
		t.Fatalf("byte limit did not fail before storage: %v", err)
	}
	row, err := dbgen.New(pool).GetAuditExport(ctx, id)
	if err != nil || row.State != "pending" || len(row.Envelope) != 0 {
		t.Fatal("partial or unsigned publication", row.State, err)
	}
	var uploads int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM audit_export_uploads").Scan(&uploads); err != nil || uploads != 0 {
		t.Fatal("limit initiated upload", uploads, err)
	}
}
