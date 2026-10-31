package retention

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAuditExportProtectsUnfrozenFacts(t *testing.T) {
	f := newFixture(t)
	f.setPeriods(`{"audit_log":1}`)
	start := time.Now().UTC().AddDate(0, 0, -30).Truncate(24 * time.Hour)
	f.exec("UPDATE audit_export_settings SET enabled=true,coverage_start=$1", start)
	f.exec("INSERT INTO audit_log(occurred_at,actor_kind,action,target_type) VALUES ($1,'system','export.unfrozen','team'),($2,'system','export.outside','team')", start.Add(time.Hour), start.Add(-time.Hour))
	res := f.apply(f.runner(), AuditLog)
	if res[AuditLog].Held != 1 || res[AuditLog].Deleted != 1 {
		t.Fatalf("unfrozen protection: %+v", res[AuditLog])
	}
	// Freeze a projection, then raw retention may purge the original without
	// removing the immutable export fact. Pause after coverage has started.
	id := uuid.New()
	f.exec("INSERT INTO audit_exports(id,day,coverage_start,snapshot_at,watermark,previous_hash) VALUES ($1,$2,$2,now(),999999,'')", id, start)
	f.exec("INSERT INTO audit_export_requests(id,day,export_id) VALUES ($1,$2,$3)", uuid.New(), start, id)
	f.exec("INSERT INTO audit_export_facts(export_id,source_id,occurred_at,actor_kind,action,target_type,target_id) SELECT $1,id,occurred_at,actor_kind,action,target_type,'' FROM audit_log WHERE action='export.unfrozen'", id)
	f.exec("UPDATE audit_export_settings SET enabled=false")
	f.exec("INSERT INTO audit_log(occurred_at,actor_kind,action,target_type) VALUES ($1,'system','export.paused','team')", start.Add(time.Hour))
	res = f.apply(f.runner(), AuditLog)
	if res[AuditLog].Held != 1 || res[AuditLog].Deleted != 1 {
		t.Fatalf("paused/frozen retention: %+v", res[AuditLog])
	}
	if f.count("SELECT count(*) FROM audit_export_facts") != 1 || f.count("SELECT count(*) FROM audit_log WHERE action='export.paused'") != 1 {
		t.Fatal("frozen projection or paused source lost")
	}
}
