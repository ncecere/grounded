package platform

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
)

func TestMaintenanceErr(t *testing.T) {
	if err := (MaintenanceState{}).Err(); err != nil {
		t.Fatalf("off: %v", err)
	}
	end := time.Now().Add(2 * time.Hour)
	err := MaintenanceState{Enabled: true, Reason: "Moving to a new embedding model", PlannedEndAt: &end}.Err()
	e, ok := apperr.As(err)
	if !ok || e.Status != http.StatusServiceUnavailable || e.Code != CodeMaintenance || !IsMaintenance(err) {
		t.Fatalf("err = %#v", err)
	}
	if !strings.Contains(e.Message, "Moving to a new embedding model") {
		t.Errorf("message = %q", e.Message)
	}
	d := e.Details.(map[string]any)
	if d["reason"] != "Moving to a new embedding model" || d["plannedEndAt"] != end.UTC().Format(time.RFC3339) {
		t.Errorf("details = %v", d)
	}
	if e.RetryAfter < time.Hour || e.RetryAfter > 2*time.Hour {
		t.Errorf("retry after = %v", e.RetryAfter)
	}
	// No planned end (or one already past): try again in five minutes.
	e, _ = apperr.As(MaintenanceState{Enabled: true, Reason: "x"}.Err())
	if e.RetryAfter != 5*time.Minute || e.Details.(map[string]any)["plannedEndAt"] != nil {
		t.Errorf("without end = %v %v", e.RetryAfter, e.Details)
	}
	if IsMaintenance(apperr.Conflict("other", "x")) || IsMaintenance(nil) {
		t.Error("IsMaintenance matched another error")
	}
}

func TestMaintenanceUpdateValidate(t *testing.T) {
	now := time.Now()
	past, future := now.Add(-time.Minute), now.Add(time.Hour)
	for _, tc := range []struct {
		name string
		in   MaintenanceUpdate
		code string
	}{
		{"on without reason", MaintenanceUpdate{Enabled: true, Reason: "   "}, "invalid_reason"},
		{"reason too long", MaintenanceUpdate{Enabled: true, Reason: strings.Repeat("é", MaxMaintenanceReason+1)}, "invalid_reason"},
		{"end in the past", MaintenanceUpdate{Enabled: true, Reason: "Upgrade", PlannedEndAt: &past}, "invalid_planned_end"},
		{"on", MaintenanceUpdate{Enabled: true, Reason: strings.Repeat("é", MaxMaintenanceReason), PlannedEndAt: &future}, ""},
		{"off ignores the rest", MaintenanceUpdate{Reason: "", PlannedEndAt: &past}, ""},
	} {
		in := tc.in
		err := in.validate(now)
		e, _ := apperr.As(err)
		if (tc.code == "" && err != nil) || (tc.code != "" && (e == nil || e.Code != tc.code)) {
			t.Errorf("%s: err = %v, want %q", tc.name, err, tc.code)
		}
	}
	off := MaintenanceUpdate{Reason: "left over", PlannedEndAt: &future}
	if err := off.validate(now); err != nil || off.Reason != "" || off.PlannedEndAt != nil {
		t.Errorf("off keeps %q %v", off.Reason, off.PlannedEndAt)
	}
	on := MaintenanceUpdate{Enabled: true, Reason: "  Upgrade  "}
	if err := on.validate(now); err != nil || on.Reason != "Upgrade" {
		t.Errorf("reason not trimmed: %q", on.Reason)
	}
}

func TestMaintenanceAction(t *testing.T) {
	for _, tc := range []struct {
		was, is bool
		want    string
	}{{false, true, "platform.maintenance_start"}, {true, false, "platform.maintenance_end"}, {true, true, "platform.maintenance_update"}} {
		if got := maintenanceAction(tc.was, tc.is); got != tc.want {
			t.Errorf("%v→%v = %s", tc.was, tc.is, got)
		}
	}
}

// A nil gate (services built without one) is never in maintenance.
func TestNilMaintenanceGate(t *testing.T) {
	var g *MaintenanceGate
	ctx := context.Background()
	if err := g.Check(ctx); err != nil {
		t.Fatal(err)
	}
	if paused, err := g.Paused(ctx); paused || err != nil {
		t.Fatal(paused, err)
	}
	g.Invalidate()
	var s Service
	if st, err := s.Maintenance(ctx); st.Enabled || err != nil {
		t.Fatal(st, err)
	}
}
