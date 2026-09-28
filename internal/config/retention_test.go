package config

import (
	"strings"
	"testing"
)

func TestRetentionEnvironment(t *testing.T) {
	env := func(m map[string]string) func(string) (string, bool) {
		return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
	}
	c, err := LoadFrom("", env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Retention.Days) != 0 || c.Retention.BatchSize != 500 || c.Retention.MaxBatches != 100 {
		t.Fatalf("defaults = %+v (nothing may be deleted by default)", c.Retention)
	}
	c, err = LoadFrom("", env(map[string]string{
		"RETENTION_AUDIT_LOG_DAYS": "2555", "RETENTION_ACCESS_LOG_DAYS": "keep", "RETENTION_DELETED_FILES_DAYS": "0",
		"RETENTION_BATCH_SIZE": "200",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Retention.Days["audit_log"] != 2555 || c.Retention.Days["deleted_files"] != 0 || c.Retention.BatchSize != 200 {
		t.Fatalf("parsed = %+v", c.Retention)
	}
	if _, ok := c.Retention.Days["access_log"]; ok {
		t.Error("keep set a period")
	}
	for k, v := range map[string]string{"RETENTION_USAGE_EVENTS_DAYS": "6", "RETENTION_AUDIT_LOG_DAYS": "29", "RETENTION_ACCESS_LOG_DAYS": "forever"} {
		if _, err := LoadFrom("", env(map[string]string{k: v})); err == nil || !strings.Contains(err.Error(), k) {
			t.Errorf("%s=%s: err = %v", k, v, err)
		}
	}
}
