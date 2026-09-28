// Maintenance mode (docs/phase5-deploy.md §5 P5, ADR-0013): a platform
// switch that pauses new ingestion (uploads, crawls, syncs, re-fetches,
// retries and the background work that fetches, parses or embeds content)
// while sign-in, chat, retrieval, reads and platform administration keep
// working.
//
// The state lives in Postgres (maintenance_mode). Every process reads it
// through a MaintenanceGate, which caches it for MaintenanceTTL, so a change
// reaches every API and worker process within seconds without depending on
// Valkey.

package platform

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// MaintenanceTTL is how long a process trusts its cached maintenance state:
// the longest a change takes to reach another process.
const MaintenanceTTL = 2 * time.Second

// CodeMaintenance is the error code of operations refused during
// maintenance (HTTP 503).
const CodeMaintenance = "maintenance_mode"

// MaxMaintenanceReason bounds the reason shown to users.
const MaxMaintenanceReason = 500

// Person names who started or last changed maintenance mode (zero ID: nobody,
// or the user no longer exists).
type Person struct {
	ID          uuid.UUID
	DisplayName string
	Email       string
}

// MaintenanceState is the current maintenance mode.
type MaintenanceState struct {
	Enabled bool
	// Reason is shown to users while Enabled (empty while off).
	Reason string
	// PlannedEndAt is when the admin expects to end it (informational).
	PlannedEndAt *time.Time
	StartedAt    *time.Time
	StartedBy    Person
	UpdatedAt    time.Time
	UpdatedBy    Person
	Revision     int64
}

// Maintenance reads the maintenance state directly from the database,
// uncached. It is the entry point for tools such as `grounded doctor`; the
// application's processes use a MaintenanceGate.
func Maintenance(ctx context.Context, db dbgen.DBTX) (MaintenanceState, error) {
	r, err := dbgen.New(db).GetMaintenance(ctx)
	if err != nil {
		return MaintenanceState{}, fmt.Errorf("read maintenance mode: %w", err)
	}
	return MaintenanceState{
		Enabled: r.Enabled, Reason: r.Reason, PlannedEndAt: r.PlannedEndAt, StartedAt: r.StartedAt,
		StartedBy: person(r.StartedBy, r.StartedByName, r.StartedByEmail),
		UpdatedAt: r.UpdatedAt, UpdatedBy: person(r.UpdatedBy, r.UpdatedByName, r.UpdatedByEmail),
		Revision: r.Revision,
	}, nil
}

func person(id uuid.NullUUID, name, email string) Person {
	if !id.Valid || email == "" {
		return Person{}
	}
	return Person{ID: id.UUID, DisplayName: name, Email: email}
}

// Err is the error of an operation refused while maintenance mode is on
// (nil while it is off): 503 maintenance_mode with the reason, the planned
// end in details and a Retry-After.
func (st MaintenanceState) Err() error {
	if !st.Enabled {
		return nil
	}
	msg := "New ingestion is paused for maintenance: " + st.Reason
	retry := 5 * time.Minute
	details := map[string]any{"reason": st.Reason, "plannedEndAt": nil}
	if st.PlannedEndAt != nil {
		details["plannedEndAt"] = st.PlannedEndAt.UTC().Format(time.RFC3339)
		if d := time.Until(*st.PlannedEndAt); d > time.Minute {
			retry = d
		}
	}
	e := apperr.New(http.StatusServiceUnavailable, CodeMaintenance, msg)
	e.Details, e.RetryAfter = details, retry
	return e
}

// IsMaintenance reports whether err refuses an operation because of
// maintenance mode.
func IsMaintenance(err error) bool {
	e, ok := apperr.As(err)
	return ok && e.Code == CodeMaintenance
}

// MaintenanceGate caches the maintenance state for one process. A nil gate
// is never in maintenance (tests and tools that don't wire one).
type MaintenanceGate struct {
	db  dbgen.DBTX
	ttl time.Duration

	mu  sync.Mutex
	st  MaintenanceState
	at  time.Time // when st was read; zero: never
	now func() time.Time
}

// NewMaintenanceGate reads through db, caching for ttl (MaintenanceTTL when 0).
func NewMaintenanceGate(db dbgen.DBTX, ttl time.Duration) *MaintenanceGate {
	if ttl <= 0 {
		ttl = MaintenanceTTL
	}
	return &MaintenanceGate{db: db, ttl: ttl, now: time.Now}
}

// State returns the maintenance state, at most the gate's TTL old. A read
// failure returns the error (callers treat it like any database error).
func (g *MaintenanceGate) State(ctx context.Context) (MaintenanceState, error) {
	if g == nil {
		return MaintenanceState{}, nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	// A clock that went backwards expires the cache too.
	if age := g.now().Sub(g.at); !g.at.IsZero() && age >= 0 && age < g.ttl {
		return g.st, nil
	}
	st, err := Maintenance(ctx, g.db)
	if err != nil {
		return MaintenanceState{}, err
	}
	g.st, g.at = st, g.now()
	return st, nil
}

// Check returns nil when new ingestion may start, the 503 maintenance_mode
// error while maintenance mode is on, or a read error.
func (g *MaintenanceGate) Check(ctx context.Context) error {
	st, err := g.State(ctx)
	if err != nil {
		return err
	}
	return st.Err()
}

// Paused reports whether maintenance mode is on, for background work that
// parks instead of failing.
func (g *MaintenanceGate) Paused(ctx context.Context) (bool, error) {
	st, err := g.State(ctx)
	return st.Enabled, err
}

// Invalidate drops the cached state, so the next read sees a change made by
// this process at once.
func (g *MaintenanceGate) Invalidate() {
	if g == nil {
		return
	}
	g.mu.Lock()
	g.at = time.Time{}
	g.mu.Unlock()
}

// Maintenance returns the current maintenance state (cached; anyone signed in
// may read it: the reason is shown to users).
func (s *Service) Maintenance(ctx context.Context) (MaintenanceState, error) {
	return s.Gate.State(ctx)
}

// MaintenanceAdmin returns the maintenance state uncached, with who started
// and last changed it (platform admins and auditors).
func (s *Service) MaintenanceAdmin(ctx context.Context, a authz.Actor) (MaintenanceState, error) {
	if !a.CanReadPlatform() {
		return MaintenanceState{}, errReadOnly
	}
	return Maintenance(ctx, s.pool)
}

// MaintenanceUpdate turns maintenance mode on or off, or changes its reason
// and planned end while it is on.
type MaintenanceUpdate struct {
	Enabled      bool
	Reason       string
	PlannedEndAt *time.Time
}

func (in *MaintenanceUpdate) validate(now time.Time) error {
	in.Reason = strings.TrimSpace(in.Reason)
	if !in.Enabled {
		in.Reason, in.PlannedEndAt = "", nil
		return nil
	}
	if in.Reason == "" {
		return apperr.Invalid("invalid_reason", "Give a reason: it is shown to users while maintenance mode is on")
	}
	if utf8.RuneCountInString(in.Reason) > MaxMaintenanceReason {
		return apperr.Invalid("invalid_reason", fmt.Sprintf("The reason can be at most %d characters", MaxMaintenanceReason))
	}
	if in.PlannedEndAt != nil && !in.PlannedEndAt.After(now) {
		return apperr.Invalid("invalid_planned_end", "The planned end must be in the future")
	}
	return nil
}

// SetMaintenance turns maintenance mode on or off, or changes its reason
// and planned end (platform admins with a session; audited).
// expectedRevision is the If-Match revision.
func (s *Service) SetMaintenance(ctx context.Context, a authz.Actor, in MaintenanceUpdate, expectedRevision int64) (MaintenanceState, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return MaintenanceState{}, errAdminOnly
	}
	if err := in.validate(time.Now()); err != nil {
		return MaintenanceState{}, err
	}
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockMaintenance(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if cur.Enabled == in.Enabled && cur.Reason == in.Reason && sameTime(cur.PlannedEndAt, in.PlannedEndAt) {
			return nil
		}
		by := uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}
		p := dbgen.SetMaintenanceParams{Enabled: in.Enabled, Reason: in.Reason, PlannedEndAt: in.PlannedEndAt, UpdatedBy: by}
		switch {
		case in.Enabled && !cur.Enabled:
			now := time.Now()
			p.StartedBy, p.StartedAt = by, &now
		case in.Enabled:
			p.StartedBy, p.StartedAt = cur.StartedBy, cur.StartedAt
		}
		if err := q.SetMaintenance(ctx, p); err != nil {
			return err
		}
		e := a.Audit(maintenanceAction(cur.Enabled, in.Enabled), "maintenance_mode", "maintenance_mode")
		e.Before = maintenanceSnapshot(cur.Enabled, cur.Reason, cur.PlannedEndAt)
		e.After = maintenanceSnapshot(in.Enabled, in.Reason, in.PlannedEndAt)
		return audit.Record(ctx, q, e)
	})
	s.Gate.Invalidate()
	if err != nil {
		return MaintenanceState{}, err
	}
	return Maintenance(ctx, s.pool)
}

func maintenanceAction(was, is bool) string {
	switch {
	case is && !was:
		return "platform.maintenance_start"
	case was && !is:
		return "platform.maintenance_end"
	}
	return "platform.maintenance_update"
}

func maintenanceSnapshot(enabled bool, reason string, end *time.Time) map[string]any {
	m := map[string]any{"enabled": enabled, "reason": reason, "plannedEndAt": nil}
	if end != nil {
		m["plannedEndAt"] = end.UTC().Format(time.RFC3339)
	}
	return m
}

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}
