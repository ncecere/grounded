// Package healthcheck stores the health of connections, models and MCP
// servers (stored
// health, docs/v0.3.0.md §5, roadmap E11): the result of every admin Test
// and of the health job, which re-tests enabled subjects on a schedule
// (docs/operations/health.md).
//
// A subject is a kind and an ID. Adding a kind takes a value in the
// health_checks_subject_kind constraint, a branch in the health_subjects
// view, a Kind constant and a Checker for the job (MCP servers:
// internal/mcpclient, migration 00037).
package healthcheck

import (
	"context"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Subject kinds.
const (
	KindConnection = "connection"
	KindModel      = "model"
	KindMCPServer  = "mcp_server"
)

// Kinds lists the subject kinds, in the order the API documents them.
var Kinds = []string{KindConnection, KindModel, KindMCPServer}

// Statuses.
const (
	StatusHealthy = "healthy"
	StatusFailing = "failing"
)

// What started a check.
const (
	TriggerManual    = "manual"    // an admin pressed Test
	TriggerScheduled = "scheduled" // the health job
)

// ClassConfig is the error class of a subject whose own settings keep it
// from being tested (for example an API key the current ENCRYPTION_KEY
// can't decrypt). The other classes are the gateway's (internal/gateway).
const ClassConfig = "config"

// Keep is how long the history is kept: the health job prunes checks older
// than this, except each subject's latest.
const Keep = 7 * 24 * time.Hour

// maxMessage bounds a stored message (in characters).
const maxMessage = 300

// Result is the outcome of one test of one subject.
type Result struct {
	Kind      string
	SubjectID uuid.UUID
	OK        bool
	Latency   time.Duration
	// ErrorClass is the probe's error class (internal/gateway kinds, or
	// ClassConfig) and Message a short admin-safe message; both empty when
	// OK.
	ErrorClass string
	HTTPStatus int
	Message    string
	Trigger    string
	// By is who pressed Test (manual checks).
	By uuid.NullUUID
}

// Check is one stored check.
type Check = dbgen.HealthCheck

// Latest is a subject's latest check with its name, whether it is enabled
// (a model only while its connection is enabled too) and who pressed Test.
type Latest = dbgen.LatestHealthChecksRow

var (
	errReadOnly = apperr.Forbidden("Health checks are visible to platform admins and auditors")
	errNoKind   = apperr.Invalid("invalid_subject_kind", "The subject kind must be connection, model or mcp_server")
)

// Service stores and reads health checks.
type Service struct {
	q   *dbgen.Queries
	now func() time.Time
}

// New returns a Service over db.
func New(db dbgen.DBTX) *Service {
	return &Service{q: dbgen.New(db), now: time.Now}
}

// Record stores a result (no permission check: callers are the admin Test
// endpoints, which have checked, and the health job).
func (s *Service) Record(ctx context.Context, r Result) (Check, error) {
	p := dbgen.InsertHealthCheckParams{
		SubjectKind: r.Kind, SubjectID: r.SubjectID, Status: StatusHealthy,
		LatencyMs: int32(min(max(r.Latency.Milliseconds(), 0), 1<<31-1)), Trigger: r.Trigger, CheckedAt: s.now(),
	}
	if r.Trigger == TriggerManual {
		p.TriggeredBy = r.By
	}
	if !r.OK {
		class := r.ErrorClass
		if class == "" {
			class = "unavailable"
		}
		p.Status, p.ErrorClass, p.Message = StatusFailing, &class, SafeMessage(r.Message)
		if r.HTTPStatus >= 100 && r.HTTPStatus <= 599 {
			st := int32(r.HTTPStatus)
			p.HttpStatus = &st
		}
	}
	c, err := s.q.InsertHealthCheck(ctx, p)
	if err == nil {
		observability.ObserveHealthCheck(r.Kind, r.Trigger, p.Status, r.Latency)
	}
	return c, err
}

// RecordConnectionTest stores a connection test (test and testErr as
// catalog.ProbeConnection returned them) and the health it implies for the
// connection's enabled models (DeriveModel). It returns the error when the
// test proves nothing about the connection (ConnectionResult).
func (s *Service) RecordConnectionTest(ctx context.Context, id uuid.UUID, test catalog.ConnectionTest, testErr error, trigger string, by uuid.NullUUID) error {
	models, err := s.q.ListModels(ctx, dbgen.ListModelsParams{ConnectionID: uuid.NullUUID{UUID: id, Valid: true}})
	if err != nil {
		return err
	}
	results, err := ConnectionResults(id, test, testErr, enabled(models))
	if err != nil {
		return err
	}
	for _, r := range results {
		r.Trigger, r.By = trigger, by
		if _, err := s.Record(ctx, r); err != nil {
			return err
		}
	}
	return nil
}

func enabled(models []dbgen.Model) []dbgen.Model {
	return slices.DeleteFunc(models, func(m dbgen.Model) bool { return !m.Enabled })
}

// ValidKind reports whether kind is a subject kind.
func ValidKind(kind string) bool { return slices.Contains(Kinds, kind) }

// Latest returns the latest check of every subject that has one, optionally
// of one kind ("" for all).
func (s *Service) Latest(ctx context.Context, a authz.Actor, kind string) ([]Latest, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	var k *string
	if kind != "" {
		if !ValidKind(kind) {
			return nil, errNoKind
		}
		k = &kind
	}
	return s.q.LatestHealthChecks(ctx, k)
}

// Prune removes checks older than keep (except each subject's latest) and
// the checks of subjects that no longer exist.
func (s *Service) Prune(ctx context.Context, keep time.Duration) (int64, error) {
	return s.q.PruneHealthChecks(ctx, s.now().Add(-keep))
}

// Secrets that must never be stored, even if a gateway echoes them in an
// error message: bearer tokens, OpenAI-style keys and key=value secrets.
var secretPattern = regexp.MustCompile(`(?i)\bbearer\s+\S+|\bsk-[A-Za-z0-9_\-*.]{6,}|\b(api[_-]?key|token|secret|password)\s*[=:]\s*\S+`)

// SafeMessage makes a message fit to store and show admins: secrets
// redacted, whitespace collapsed, at most maxMessage characters.
func SafeMessage(msg string) string {
	msg = secretPattern.ReplaceAllString(msg, "[redacted]")
	msg = strings.Join(strings.Fields(msg), " ")
	if utf8.RuneCountInString(msg) > maxMessage {
		msg = string([]rune(msg)[:maxMessage-1]) + "…"
	}
	return msg
}
