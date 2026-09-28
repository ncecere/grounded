package platform

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/testutil"
)

func newAdmin(t *testing.T, pool *pgxpool.Pool, email string) authz.Actor {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (oidc_issuer, oidc_subject, email, display_name, platform_role) VALUES ('test', $1, $2, 'Pat Admin', 'platform_admin') RETURNING id`,
		email, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return authz.Actor{UserID: id, PlatformRole: authz.PlatformAdmin}
}

func auditActions(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT action FROM audit_log WHERE target_type = 'maintenance_mode' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			t.Fatal(err)
		}
		out = append(out, a)
	}
	return out
}

func wantCode(t *testing.T, what string, err error, code string) {
	t.Helper()
	if e, ok := apperr.As(err); !ok || e.Code != code {
		t.Fatalf("%s: err = %v, want %s", what, err, code)
	}
}

// TestSetMaintenance: only platform admins with a session switch it; each
// change is audited with before and after; the revision guards edits; who
// started it is kept while it is on; turning it off clears the reason.
func TestSetMaintenance(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	s := NewService(pool)
	admin := newAdmin(t, pool, "pat@example.edu")
	other := newAdmin(t, pool, "sam@example.edu")

	st, err := Maintenance(ctx, pool)
	if err != nil || st.Enabled || st.Revision != 1 || st.StartedBy.ID != uuid.Nil {
		t.Fatalf("initial = %+v %v", st, err)
	}
	on := MaintenanceUpdate{Enabled: true, Reason: "Moving to a new embedding model"}
	_, err = s.SetMaintenance(ctx, authz.Actor{UserID: uuid.New(), PlatformRole: authz.PlatformAuditor}, on, 1)
	wantCode(t, "auditor", err, "forbidden")
	_, err = s.SetMaintenance(ctx, authz.Actor{UserID: admin.UserID, PlatformRole: authz.PlatformAdmin, Key: &authz.KeyGrant{}}, on, 1)
	wantCode(t, "API key", err, "forbidden")
	_, err = s.SetMaintenance(ctx, admin, on, 7)
	wantCode(t, "stale", err, "revision_conflict")
	_, err = s.MaintenanceAdmin(ctx, authz.Actor{UserID: uuid.New()})
	wantCode(t, "member reads admin view", err, "forbidden")

	st, err = s.SetMaintenance(ctx, admin, on, 1)
	if err != nil || !st.Enabled || st.Reason != on.Reason || st.Revision != 2 || st.StartedAt == nil ||
		st.StartedBy.Email != "pat@example.edu" || st.UpdatedBy.DisplayName != "Pat Admin" {
		t.Fatalf("on = %+v %v", st, err)
	}
	started := *st.StartedAt
	// Saving the same values changes nothing and audits nothing.
	if st, err = s.SetMaintenance(ctx, admin, on, 2); err != nil || st.Revision != 2 {
		t.Fatalf("unchanged = %+v %v", st, err)
	}
	// Another admin sets a planned end: who started it stays.
	end := time.Now().Add(time.Hour).Truncate(time.Second)
	st, err = s.SetMaintenance(ctx, other, MaintenanceUpdate{Enabled: true, Reason: on.Reason, PlannedEndAt: &end}, 2)
	if err != nil || st.PlannedEndAt == nil || !st.PlannedEndAt.Equal(end) || st.StartedBy.Email != "pat@example.edu" ||
		!st.StartedAt.Equal(started) || st.UpdatedBy.Email != "sam@example.edu" {
		t.Fatalf("update = %+v %v", st, err)
	}
	st, err = s.SetMaintenance(ctx, other, MaintenanceUpdate{Enabled: false, Reason: "ignored"}, 3)
	if err != nil || st.Enabled || st.Reason != "" || st.PlannedEndAt != nil || st.StartedAt != nil || st.StartedBy.ID != uuid.Nil {
		t.Fatalf("off = %+v %v", st, err)
	}
	if got := auditActions(t, pool); len(got) != 3 || got[0] != "platform.maintenance_start" || got[1] != "platform.maintenance_update" || got[2] != "platform.maintenance_end" {
		t.Fatalf("audit = %v", got)
	}
	var before, after json.RawMessage
	if err := pool.QueryRow(ctx, `SELECT before_state, after_state FROM audit_log WHERE action = 'platform.maintenance_start'`).Scan(&before, &after); err != nil {
		t.Fatal(err)
	}
	if string(before) != `{"reason": "", "enabled": false, "plannedEndAt": null}` ||
		string(after) != `{"reason": "Moving to a new embedding model", "enabled": true, "plannedEndAt": null}` {
		t.Fatalf("audit before %s after %s", before, after)
	}
}

// TestMaintenanceGatePropagation: a change made by one process reaches a
// gate in another process within its TTL; the process that made it sees it
// at once.
func TestMaintenanceGatePropagation(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	api, worker := NewService(pool), NewService(pool) // two processes
	admin := newAdmin(t, pool, "pat@example.edu")
	clock := time.Now()
	worker.Gate.now = func() time.Time { return clock }

	if paused, err := worker.Gate.Paused(ctx); paused || err != nil {
		t.Fatalf("worker before = %v %v", paused, err)
	}
	if _, err := api.SetMaintenance(ctx, admin, MaintenanceUpdate{Enabled: true, Reason: "Upgrade"}, 1); err != nil {
		t.Fatal(err)
	}
	if err := api.Gate.Check(ctx); !IsMaintenance(err) {
		t.Fatalf("API process: %v", err)
	}
	clock = clock.Add(MaintenanceTTL / 2)
	if paused, _ := worker.Gate.Paused(ctx); paused {
		t.Fatal("the worker read the database before its cache expired")
	}
	clock = clock.Add(MaintenanceTTL)
	if st, err := worker.Gate.State(ctx); err != nil || !st.Enabled || st.Reason != "Upgrade" {
		t.Fatalf("worker after the TTL = %+v %v", st, err)
	}

	// And back off, with real time.
	worker.Gate.now = time.Now
	if _, err := api.SetMaintenance(ctx, admin, MaintenanceUpdate{}, 2); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(MaintenanceTTL + time.Second)
	for {
		if paused, err := worker.Gate.Paused(ctx); err != nil {
			t.Fatal(err)
		} else if !paused {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the worker still sees maintenance mode after its TTL")
		}
		time.Sleep(50 * time.Millisecond)
	}
}
