package httpapi_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/testutil"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/auditexport"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/riverqueue/river"
)

func TestSignedAuditExportProduct(t *testing.T) {
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{39}, 32))
	file := filepath.Join(t.TempDir(), "fixture-key")
	if err := os.WriteFile(file, key, 0600); err != nil {
		t.Fatal(err)
	}
	app := newTestApp(t, func(c *config.Config) { c.AuditExportSigningKeyFile = file })
	admin, auditor, user := app.signIn("admin"), app.signIn("auditor"), app.signIn("user")
	ctx := context.Background()
	settings := "/v1/admin/audit-export-settings"
	var cfg apitypes.AuditExportSettings
	if code := auditor.get(settings, &cfg); code != 200 || cfg.Enabled || !cfg.KeyReady {
		t.Fatalf("defaults %d %+v", code, cfg)
	}
	var n int
	if err := app.Pool.QueryRow(ctx, "SELECT count(*) FROM audit_export_requests").Scan(&n); err != nil || n != 0 {
		t.Fatalf("GET did work: %v %d", err, n)
	}
	body := map[string]any{"enabled": true, "destination": "builtin", "coverageStart": "2026-01-01"}
	code, e := auditor.call("PUT", settings, body, nil, ifMatch(cfg.Revision))
	mustCode(t, "auditor approval", code, e, 403, "")
	code, e = admin.call("PUT", settings, body, nil, nil)
	mustCode(t, "precondition", code, e, 428, "")
	code, e = admin.call("PUT", settings, body, &cfg, ifMatch(cfg.Revision))
	mustCode(t, "approve", code, e, 200, "")
	code, e = admin.call("PUT", settings, body, nil, ifMatch(1))
	mustCode(t, "stale", code, e, 412, "")
	body["destination"] = "external"
	code, e = admin.call("PUT", settings, body, nil, ifMatch(cfg.Revision))
	mustCode(t, "unsupported", code, e, 400, "")
	if _, err := app.Pool.Exec(ctx, "INSERT INTO audit_log(occurred_at,actor_kind,action,target_type,metadata) VALUES ('2026-01-01','system','team.update','team','{\"secret\":\"EXPORT_CANARY\"}')"); err != nil {
		t.Fatal(err)
	}
	var row apitypes.AuditExportStatus
	code, e = admin.call("POST", "/v1/admin/audit-exports", map[string]any{"day": "2026-01-01"}, &row, ifMatch(cfg.Revision))
	mustCode(t, "enqueue", code, e, 200, "")
	if row.State != "pending" {
		t.Fatal(row)
	}
	var queued int
	if err := app.Pool.QueryRow(ctx, "SELECT count(*) FROM river_job WHERE kind='audit_exports.run'").Scan(&queued); err != nil || queued != 1 {
		t.Fatalf("InsertTx %d %v", queued, err)
	}
	var duplicate apitypes.AuditExportStatus
	code, e = admin.call("POST", "/v1/admin/audit-exports", map[string]any{"day": "2026-01-01"}, &duplicate, ifMatch(cfg.Revision))
	mustCode(t, "duplicate", code, e, 200, "")
	if duplicate.Id != row.Id {
		t.Fatal("not idempotent")
	}
	w := auditexport.Worker{S: app.Svc.AuditExports}
	if err := w.Work(ctx, &river.Job[auditexport.RunArgs]{Args: auditexport.RunArgs{ID: row.Id}}); err != nil {
		t.Fatal(err)
	}
	path := "/v1/admin/audit-exports/" + row.Id.String()
	if code := auditor.get(path, &row); code != 200 || row.State != "completed" || row.Envelope == nil {
		t.Fatalf("completed %d %+v", code, row)
	}
	encoded, _ := json.Marshal(row)
	if bytes.Contains(encoded, []byte("object_key")) || bytes.Contains(encoded, []byte("EXPORT_CANARY")) || bytes.Contains(encoded, key) {
		t.Fatal("secret projection")
	}
	if code := user.get(path, nil); code != 403 {
		t.Fatalf("nonplatform read %d", code)
	}
	req, _ := http.NewRequest("GET", app.URL+path+"/download", nil)
	resp, err := auditor.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 || resp.Header.Get("Cache-Control") != "private, no-store" || resp.Header.Get("X-Content-Type-Options") != "nosniff" || bytes.Contains(payload, []byte("EXPORT_CANARY")) {
		t.Fatalf("download %d %s", resp.StatusCode, payload)
	}

	// Durable failure and explicit admin retry use the original frozen facts.
	var failedRow apitypes.AuditExportStatus
	code, e = admin.call("POST", "/v1/admin/audit-exports", map[string]any{"day": "2026-01-02"}, &failedRow, ifMatch(cfg.Revision))
	mustCode(t, "second day", code, e, 200, "")
	original := app.Svc.AuditExports.Store
	app.Svc.AuditExports.Store = rejectExportPut{Store: original}
	if err := w.Work(ctx, &river.Job[auditexport.RunArgs]{Args: auditexport.RunArgs{ID: failedRow.Id}}); err != nil {
		t.Fatal(err)
	}
	app.Svc.AuditExports.Store = original
	failurePath := "/v1/admin/audit-exports/" + failedRow.Id.String()
	if code := admin.get(failurePath, &failedRow); code != 200 || failedRow.State != "failed" || failedRow.FailureCode != "export_failed" {
		t.Fatalf("failure status %d %+v", code, failedRow)
	}
	code, e = auditor.call("POST", failurePath+"/retry", nil, nil, ifMatch(failedRow.Revision))
	mustCode(t, "auditor retry", code, e, 403, "")
	code, e = admin.call("POST", failurePath+"/retry", nil, nil, ifMatch(1))
	mustCode(t, "stale retry", code, e, 412, "")
	code, e = admin.call("POST", failurePath+"/retry", nil, &failedRow, ifMatch(failedRow.Revision))
	mustCode(t, "retry", code, e, 200, "")
	if err := w.Work(ctx, &river.Job[auditexport.RunArgs]{Args: auditexport.RunArgs{ID: failedRow.Id}}); err != nil {
		t.Fatal(err)
	}
	if code := admin.get(failurePath, &failedRow); code != 200 || failedRow.State != "completed" {
		t.Fatalf("retry result %d %+v", code, failedRow)
	}

	// Artifact corruption is rejected before attachment headers or any payload.
	var objectKey string
	if err := app.Pool.QueryRow(ctx, "SELECT e.object_key FROM audit_exports e JOIN audit_export_requests r ON r.export_id=e.id WHERE r.id=$1", row.Id).Scan(&objectKey); err != nil {
		t.Fatal(err)
	}
	if err := original.Put(ctx, objectKey, strings.NewReader("tampered"), 8, "application/x-ndjson"); err != nil {
		t.Fatal(err)
	}
	corruptReq, _ := http.NewRequest("GET", app.URL+path+"/download", nil)
	corrupt, err := auditor.client.Do(corruptReq)
	if err != nil {
		t.Fatal(err)
	}
	defer corrupt.Body.Close()
	if corrupt.StatusCode != 503 || corrupt.Header.Get("Content-Disposition") != "" {
		t.Fatalf("tampered attachment served: %d", corrupt.StatusCode)
	}

}

func TestSignedAuditExportRiver(t *testing.T) {
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{40}, 32))
	file := filepath.Join(t.TempDir(), "fixture-key")
	if err := os.WriteFile(file, key, 0600); err != nil {
		t.Fatal(err)
	}
	app := newTestAppWith(t, func(c *config.Config) { c.AuditExportSigningKeyFile = file }, true)
	admin := app.signIn("admin")
	var cfg apitypes.AuditExportSettings
	code, e := admin.call("PUT", "/v1/admin/audit-export-settings", map[string]any{"enabled": true, "coverageStart": "2026-01-01", "destination": "builtin"}, &cfg, ifMatch(1))
	mustCode(t, "approve", code, e, 200, "")
	var row apitypes.AuditExportStatus
	code, e = admin.call("POST", "/v1/admin/audit-exports", map[string]any{"day": "2026-01-01"}, &row, ifMatch(cfg.Revision))
	mustCode(t, "queue", code, e, 200, "")
	deadline := time.Now().Add(testutil.Scale(10 * time.Second))
	for {
		if code := admin.get("/v1/admin/audit-exports/"+row.Id.String(), &row); code != 200 {
			t.Fatal(code)
		}
		if row.State == "completed" {
			break
		}
		if row.State == "failed" || time.Now().After(deadline) {
			t.Fatalf("River did not complete: %+v", row)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

type rejectExportPut struct{ blob.Store }

func (s rejectExportPut) Put(context.Context, string, io.Reader, int64, string) error {
	return errors.New("provider-secret-canary")
}
