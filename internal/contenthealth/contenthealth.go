// Package contenthealth is the content health report (roadmap B8, #22; docs/content-health.md, ADR-0027): a bounded,
// opt-in snapshot of where a team's knowledge looks neglected or broken, for its editors to investigate.
//
// The five signals (signals.go) read only the team's own documents and sources, the latest completed crawl's record
// and the content-free answer events. A report is made by a River job on its own queue (worker.go) when an editor asks
// for one; opening a report reads stored rows (read.go). The package makes no network call and imports nothing from
// retrieval, answering, models or the crawler, and nothing on the question path imports it (imports_test.go).
//
// A snapshot holds IDs, enums, counts and times, and the URL a link failure is about. Titles and names are read live,
// so a deleted or renamed document cannot leak through an old report, and findings go with their documents and sources.
//
// Who: editors, admins and owners of the team, in the app only. Members, API keys, platform staff and break-glass
// sessions get 404; shared platform sources are never listed or compared.
package contenthealth

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// The thresholds a report is made with, and the bounds it works within (docs/content-health.md, "Bounds").
const (
	DefaultStaleDays = 365
	MinStaleDays     = 30
	MaxStaleDays     = 3650

	DefaultCitationWindowDays = 90
	MinCitationWindowDays     = 14
	MaxCitationWindowDays     = 365

	// MinAnswers is how many answers the window must hold before "not cited" says anything.
	MinAnswers = 50
	// MaxAnswerScan is the most answer events one report reads; more makes the signal unavailable.
	MaxAnswerScan = 1_000_000
	// MaxAgents is the most agents of a team whose answer events one report reads (the events are found through the agents'
	// index); a team with more makes the signal unavailable, never a silently partial answer.
	MaxAgents = 5000

	// MaxFindingsPerSignal is the most findings stored for a signal; the true count is stored too.
	MaxFindingsPerSignal = 1000
	// MaxDuplicateGroups and MaxGroupMembers bound the duplicates signal inside MaxFindingsPerSignal.
	MaxDuplicateGroups = 100
	MaxGroupMembers    = 10
	// MaxSources is the most sources one report covers (scope it to a source or a knowledge base beyond that).
	MaxSources = 1000

	// KeepReports is how many reports a team keeps; RetentionDays how long each is kept after it ended.
	KeepReports   = 5
	RetentionDays = 30

	// DefaultCooldown is the pause between the start of one report and the next.
	DefaultCooldown = 10 * time.Minute
	// SignalTimeout bounds one signal as a context deadline of the report's own queries (the driver then cancels the running
	// statement on the server); it is not a server-side statement_timeout. ReportTimeout bounds the whole job.
	SignalTimeout = 45 * time.Second
	ReportTimeout = 10 * time.Minute
	// FinalizationTimeout bounds best-effort failure-state persistence after work is cancelled.
	// If the database cannot write within this grace, the existing prune job recovers the stuck report.
	FinalizationTimeout = 10 * time.Second
	// NotFinishedAfter is how long a document may be pending, queued or processing before it counts as not finished.
	NotFinishedAfter = 24 * time.Hour

	// Stuck reports: a queued one nobody took, a running one whose worker died.
	stuckQueuedMinutes  = 60
	stuckRunningMinutes = 15

	// PageSize is the most findings a page returns; DefaultPageSize the usual.
	PageSize        = 100
	DefaultPageSize = 50
)

// Queue is the River queue of reports: its own, so a report never waits behind ingestion or the other way round.
const Queue = "content_health"

// Report statuses.
const (
	StatusQueued    = "queued"
	StatusRunning   = "running"
	StatusCompleted = "completed"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"
)

// Error codes a failed report keeps (never a message).
const (
	ErrInternal       = "internal"
	ErrTimedOut       = "timed_out"
	ErrTooManySources = "too_many_sources"
	ErrDisabled       = "disabled"
)

// Service makes and serves content health reports.
type Service struct {
	Pool  *pgxpool.Pool
	Teams *teams.Service
	// Jobs enqueues reports (may be insert-only; nil: reports stay queued, as in tests that run them by hand).
	Jobs *river.Client[pgx.Tx]
	// Cooldown is the pause between two reports of a team (DefaultCooldown).
	Cooldown time.Duration
	// SignalLimit is the time one signal may take (SignalTimeout; tests shorten it).
	SignalLimit time.Duration
	// AnswerScanLimit is the most answer events one report reads (MaxAnswerScan; tests lower it).
	AnswerScanLimit int64
	Log             *slog.Logger
	// Signals are the signals a report collects, in order (Registry).
	Signals []Signal
	// afterLock is a test seam: it runs inside the store's transaction once the live sources and documents are locked.
	afterLock func()
	// finalizeLimit is a test seam for a shorter failure-state cleanup budget.
	finalizeLimit time.Duration
	q             *dbgen.Queries
}

// New returns a Service with the five built-in signals.
func New(pool *pgxpool.Pool, t *teams.Service, jobs *river.Client[pgx.Tx], log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{Pool: pool, Teams: t, Jobs: jobs, Cooldown: DefaultCooldown, Log: log, Signals: Registry(), q: dbgen.New(pool)}
}

var (
	// errNotFound hides the report from members, keys, platform staff and outsiders, and from everyone while it is off.
	errNotFound   = apperr.NotFound("not_found", "Not found")
	errNoReport   = apperr.NotFound("content_health_report_not_found", "Report not found")
	errNoScope    = apperr.NotFound("content_health_scope_not_found", "That source or knowledge base isn't in this team")
	errOff        = apperr.Conflict("content_health_off", "Content health reports are switched off. A platform admin can turn them on in Admin → Settings → Features.")
	errActive     = apperr.Conflict("content_health_active", "A report is already being made for this team. Cancel it or wait for it to finish.")
	errEnded      = apperr.Conflict("content_health_ended", "This report has already ended")
	errNotEnded   = apperr.Conflict("content_health_active", "This report is still being made. Cancel it first.")
	errArchived   = apperr.Conflict("team_archived", "This team is archived and read-only")
	errBothScopes = apperr.Invalid("invalid_scope", "Choose a source or a knowledge base, not both")
	errStale      = apperr.Invalid("invalid_stale_days", "Not processed for must be between 30 and 3650 days")
	errWindow     = apperr.Invalid("invalid_citation_window", "The citation window must be between 14 and 365 days")
	errSignal     = apperr.Invalid("invalid_signal", "Unknown signal")
	errAdminOnly  = apperr.Forbidden("Only platform admins can turn content health reports on or off")
	errStaffRead  = apperr.Forbidden("Only platform admins and auditors can see this setting")
)

// access resolves the team for an editor, admin or owner of it, in the app; everyone else (members, keys, OAuth clients,
// platform staff with or without break-glass, outsiders) gets 404. A write needs an active team.
func (s *Service) access(ctx context.Context, a authz.Actor, teamRef string, write bool) (teams.Access, error) {
	if a.Delegated() || a.UserID == uuid.Nil {
		return teams.Access{}, errNotFound
	}
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return acc, err
	}
	if !authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
		return acc, errNotFound
	}
	if write && acc.Team.Status != teams.StatusActive {
		return acc, errArchived
	}
	return acc, nil
}

// enabled reports whether the platform switch is on.
func (s *Service) enabled(ctx context.Context) (bool, error) {
	r, err := s.q.GetContentHealthSettings(ctx)
	return r.Enabled, err
}
