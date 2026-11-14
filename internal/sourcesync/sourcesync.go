// Package sourcesync runs connector sources (ADR-0035, #258): their stored credentials, their sync runs (River jobs
// connector.sync and connector.schedule), the sink that takes a connector's findings into ingestion, document
// permissions, and the safe removal of documents the provider no longer has.
//
// A connector (internal/connector) only talks to its provider. Everything that touches the database, the object store
// or another team's limits is here, once, for every connector. Access control is the caller's (internal/sources):
// nothing here checks who is asking.
package sourcesync

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/webhooks"
)

// Queue is the River queue of sync jobs; its size is how many sources sync at once per worker process.
const Queue = "connector"

// Schedules.
const (
	ScheduleManual = "manual"
	ScheduleHourly = "hourly"
	ScheduleDaily  = "daily"
	ScheduleWeekly = "weekly"
)

// Sync statuses and triggers.
const (
	StatusQueued    = "queued"
	StatusRunning   = "running"
	StatusCompleted = "completed"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"

	TriggerCreate   = "create"
	TriggerManual   = "manual"
	TriggerSchedule = "schedule"
)

// What became of a sync's removals.
const (
	RemovalsPending    = "pending"
	RemovalsConfirmed  = "confirmed"
	RemovalsDismissed  = "dismissed"
	RemovalsSuperseded = "superseded"
)

// Service runs connector sources.
type Service struct {
	Pool *pgxpool.Pool
	Jobs *river.Client[pgx.Tx] // may be insert-only
	Blob blob.Store
	// Box seals stored credentials (nil: connector sources can't be made).
	Box *secrets.Box
	// HTTP is the client connectors use (connector.NewHTTPClient).
	HTTP *http.Client
	// MaxBytes is the largest item read; larger ones are skipped.
	MaxBytes int64
	// HoldPercent: a sync that would remove more than this share of a source's documents (and at least HoldMinimum
	// of them), or all of them, removes nothing until an editor confirms. Defaults 30 and 10.
	HoldPercent int
	HoldMinimum int
	// Limits enforces team limits on documents and storage (nil: none).
	Limits *limits.Service
	// Webhooks hears of finished and failed syncs (nil: nobody).
	Webhooks *webhooks.Service
	// Maintenance pauses syncing while maintenance mode is on (nil: never).
	Maintenance *platform.MaintenanceGate
	// RetryDelay replaces the wait before a failed sync's next attempt (nil: one minute, then five, then twenty-five).
	RetryDelay func(attempt int) time.Duration
	Log        *slog.Logger
	q          *dbgen.Queries
	// now and checkEvery are replaced in tests.
	now        func() time.Time
	checkEvery time.Duration
}

// New returns a Service.
func New(pool *pgxpool.Pool, jobs *river.Client[pgx.Tx], b blob.Store, box *secrets.Box, client *http.Client, maxBytes int64, log *slog.Logger) *Service {
	return &Service{Pool: pool, Jobs: jobs, Blob: b, Box: box, HTTP: client, MaxBytes: maxBytes, HoldPercent: 30, HoldMinimum: 10,
		Log: log, q: dbgen.New(pool), now: time.Now, checkEvery: 2 * time.Second}
}

var (
	errNoConnector = apperr.Conflict("connector_unavailable", "This server has no connector for this source's type, so it can't sync. Its documents stay searchable.")
	errTypeOff     = apperr.Conflict("source_type_off", "This source type is turned off. A platform admin turns source types on and off.")
	errPaused      = apperr.Conflict("source_paused", "This source is paused. Resume it to sync.")
	errNoBox       = apperr.Conflict("credentials_unavailable", "This server can't store credentials: ENCRYPTION_KEY is not set")
	errNoSync      = apperr.NotFound("sync_not_found", "Sync not found")
)

// InProgressError reports that a sync could not start because one is active.
type InProgressError struct{ Sync dbgen.SourceSync }

func (e *InProgressError) Error() string { return "sync_in_progress" }

func (e *InProgressError) Unwrap() error {
	return apperr.Conflict("sync_in_progress", "This source is already syncing")
}

// Active reports whether a sync is queued or running.
func Active(s dbgen.SourceSync) bool { return s.Status == StatusQueued || s.Status == StatusRunning }

// ValidSchedule reports whether s is a schedule.
func ValidSchedule(s string) bool {
	switch s {
	case ScheduleManual, ScheduleHourly, ScheduleDaily, ScheduleWeekly:
		return true
	}
	return false
}

// nextSync is when a source on schedule syncs next after from (nil: only on request).
func nextSync(schedule string, from time.Time) *time.Time {
	var d time.Duration
	switch schedule {
	case ScheduleHourly:
		d = time.Hour
	case ScheduleDaily:
		d = 24 * time.Hour
	case ScheduleWeekly:
		d = 7 * 24 * time.Hour
	default:
		return nil
	}
	t := from.Add(d)
	return &t
}

// connectorFor returns the connector of a source's type, when this build has it.
func connectorFor(typ string) (connector.Connector, error) {
	c, ok := connector.Get(typ)
	if !ok {
		return nil, errNoConnector
	}
	return c, nil
}

func nullUUID(id uuid.UUID) uuid.NullUUID { return uuid.NullUUID{UUID: id, Valid: id != uuid.Nil} }

// env is what a connector works with for a source.
func (s *Service) env(ctx context.Context, src dbgen.DataSource, creds map[string]string) connector.Env {
	return connector.Env{SourceID: src.ID, Config: src.Config, Credentials: creds, HTTP: s.HTTP,
		Log: s.Log.With("source", src.ID, "type", src.Type)}
}
