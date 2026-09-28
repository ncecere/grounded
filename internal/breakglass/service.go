// Package breakglass runs break-glass sessions (ADR-0011, ADR-0024,
// docs/phase5-deploy.md §5 P4): a platform admin's time-boxed, audited read
// access to one team's conversations and documents.
//
// The rules are pure functions in internal/authz; this package stores
// sessions and the platform setting, records every start, approval, denial,
// end, expiry and read in audit_log, and notifies team owners (mandatory)
// and platform admins. Content services (sources, agents) call Authorize on
// every read a non-member makes: it answers with the grant and records the
// read, or with nil when there is no grant.
package breakglass

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Service stores break-glass sessions and decides reads. A nil *Service
// grants nothing (services and tests that don't wire it).
type Service struct {
	Pool   *pgxpool.Pool
	Teams  *teams.Service
	Notify *notify.Service
	Log    *slog.Logger
	// Now is the clock (tests may replace it).
	Now func() time.Time
	q   *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, t *teams.Service, n *notify.Service, log *slog.Logger) *Service {
	return &Service{Pool: pool, Teams: t, Notify: n, Log: log, Now: time.Now, q: dbgen.New(pool)}
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

var (
	errReadOnly  = apperr.Forbidden("Only platform admins and auditors can see break-glass sessions")
	errAdminOnly = apperr.Forbidden("Only platform admins can change break-glass settings")
	errNoSession = apperr.NotFound("break_glass_not_found", "Break-glass session not found")
)

// Person names someone on a session (zero ID: nobody).
type Person struct {
	ID          uuid.UUID
	DisplayName string
	Email       string
}

// Name is the display name, or the email.
func (p Person) Name() string {
	if p.DisplayName != "" {
		return p.DisplayName
	}
	return p.Email
}

func person(id uuid.NullUUID, name, email string) Person {
	if !id.Valid || email == "" {
		return Person{}
	}
	return Person{ID: id.UUID, DisplayName: name, Email: email}
}

// Settings is the platform setting with who changed it last.
type Settings struct {
	authz.BreakGlassPolicy
	UpdatedAt time.Time
	UpdatedBy Person
	Revision  int64
}

func policyOf(approval bool, maxMinutes, timeoutMinutes int32) authz.BreakGlassPolicy {
	return authz.BreakGlassPolicy{
		ApprovalRequired: approval,
		MaxDuration:      time.Duration(maxMinutes) * time.Minute,
		ApprovalTimeout:  time.Duration(timeoutMinutes) * time.Minute,
	}
}

func (s *Service) settings(ctx context.Context, q *dbgen.Queries) (Settings, error) {
	r, err := q.GetBreakGlassSettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	return Settings{
		BreakGlassPolicy: policyOf(r.ApprovalRequired, r.MaxDurationMinutes, r.ApprovalTimeoutMinutes),
		UpdatedAt:        r.UpdatedAt, UpdatedBy: person(r.UpdatedBy, r.UpdatedByName, r.UpdatedByEmail), Revision: r.Revision,
	}, nil
}

// Settings returns the platform setting (platform admins and auditors).
func (s *Service) Settings(ctx context.Context, a authz.Actor) (Settings, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return Settings{}, errReadOnly
	}
	return s.settings(ctx, s.q)
}

// SetSettings changes the platform setting (platform admins with a session;
// audited as platform.break_glass_settings_update). A change applies to
// sessions started after it; open sessions keep their times.
func (s *Service) SetSettings(ctx context.Context, a authz.Actor, p authz.BreakGlassPolicy, expectedRevision int64) (Settings, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return Settings{}, errAdminOnly
	}
	if err := p.Validate(); err != nil {
		return Settings{}, err
	}
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockBreakGlassSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		before := policyOf(cur.ApprovalRequired, cur.MaxDurationMinutes, cur.ApprovalTimeoutMinutes)
		if before == p {
			return nil
		}
		if err := q.SetBreakGlassSettings(ctx, dbgen.SetBreakGlassSettingsParams{
			ApprovalRequired: p.ApprovalRequired, MaxDurationMinutes: minutes(p.MaxDuration),
			ApprovalTimeoutMinutes: minutes(p.ApprovalTimeout), UpdatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
		}); err != nil {
			return err
		}
		e := a.Audit("platform.break_glass_settings_update", "break_glass_settings", "break_glass_settings")
		e.Before, e.After = policySnapshot(before), policySnapshot(p)
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Settings{}, err
	}
	return s.settings(ctx, s.q)
}

func minutes(d time.Duration) int32 { return int32(d / time.Minute) }

func policySnapshot(p authz.BreakGlassPolicy) map[string]any {
	return map[string]any{
		"approvalRequired": p.ApprovalRequired, "maxDurationMinutes": minutes(p.MaxDuration),
		"approvalTimeoutMinutes": minutes(p.ApprovalTimeout),
	}
}

// lock reads a session for update.
func lock(ctx context.Context, q *dbgen.Queries, id uuid.UUID) (dbgen.BreakGlassSession, error) {
	row, err := q.LockBreakGlassSession(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return row, errNoSession
	}
	return row, err
}

// rule is the session as the authz rules see it.
func rule(r dbgen.BreakGlassSession) authz.BreakGlassSession {
	return authz.BreakGlassSession{
		ID: r.ID, TeamID: r.TeamID, RequestedBy: r.RequestedBy, Scopes: r.Scopes, Status: r.Status,
		ApprovalDeadline: r.ApprovalDeadline, StartedAt: r.StartedAt, ExpiresAt: r.ExpiresAt,
	}
}
