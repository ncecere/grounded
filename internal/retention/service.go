package retention

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Service is the administration of retention and legal holds: the period
// settings, the dry-run report, runs, and holds. Platform admins change
// them (with a session); platform auditors read them. Nobody else sees
// them, holds included (DESIGN.md §3.4).
type Service struct {
	Pool *pgxpool.Pool
	// Jobs enqueues requested runs (an insert-only client is enough).
	Jobs *jobs.Client
	Env  config.Retention
	Log  *slog.Logger
}

// New returns the service.
func New(pool *pgxpool.Pool, jobsClient *jobs.Client, env config.Retention, log *slog.Logger) *Service {
	return &Service{Pool: pool, Jobs: jobsClient, Env: env, Log: log}
}

var (
	errAdminOnly = apperr.Forbidden("Only platform admins can do this")
	errReadOnly  = apperr.Forbidden("Only platform admins and auditors can see this")
)

func canRead(a authz.Actor) error {
	if !a.CanReadPlatform() {
		return errReadOnly
	}
	return nil
}

func canWrite(a authz.Actor) error {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return errAdminOnly
	}
	return nil
}

// Person names who changed or asked for something (zero ID: nobody).
type Person struct {
	ID          uuid.UUID
	DisplayName string
	Email       string
}

func person(id uuid.NullUUID, name, email string) Person {
	if !id.Valid || email == "" {
		return Person{}
	}
	return Person{ID: id.UUID, DisplayName: name, Email: email}
}

// Level is a classification level's conversation retention (set on the
// level, in Administration > Classifications).
type Level struct {
	Key, Name string
	Rank      int32
	// ConversationDays: signed-in conversations; nil keeps them.
	ConversationDays *int32
	// AnonymousHours: anonymous conversations.
	AnonymousHours int32
}

// Settings are the retention settings.
type Settings struct {
	Periods   Periods
	Levels    []Level
	Revision  int64
	UpdatedAt time.Time
	UpdatedBy Person
}

// Settings returns the effective periods, where each comes from, and the
// per-level conversation retention.
func (s *Service) Settings(ctx context.Context, a authz.Actor) (Settings, error) {
	if err := canRead(a); err != nil {
		return Settings{}, err
	}
	return s.settings(ctx)
}

func (s *Service) settings(ctx context.Context) (Settings, error) {
	q := dbgen.New(s.Pool)
	row, err := q.GetRetentionSettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	stored, err := ParseStored(row.Periods)
	if err != nil {
		return Settings{}, err
	}
	levels, err := s.levels(ctx, q)
	if err != nil {
		return Settings{}, err
	}
	return Settings{
		Periods: Resolve(stored, s.Env), Levels: levels, Revision: row.Revision, UpdatedAt: row.UpdatedAt,
		UpdatedBy: person(row.UpdatedBy, row.UpdatedByName, row.UpdatedByEmail),
	}, nil
}

func (s *Service) levels(ctx context.Context, q *dbgen.Queries) ([]Level, error) {
	rows, err := q.ListClassifications(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Level, 0, len(rows))
	for _, l := range rows {
		out = append(out, Level{Key: l.Key, Name: l.Name, Rank: l.Rank, ConversationDays: l.ConversationRetentionDays, AnonymousHours: l.AnonymousRetentionHours})
	}
	return out, nil
}

// Period modes of an update.
const (
	ModeDefault = "default" // use the environment default
	ModeKeep    = "keep"    // keep the data
	ModeDays    = "days"    // delete after Days
)

// PeriodUpdate sets one kind's platform period.
type PeriodUpdate struct {
	Kind Kind
	Mode string
	Days int
}

func (u PeriodUpdate) apply(stored Stored) error {
	p, ok := u.Kind.Period()
	if !ok {
		return apperr.Invalid("invalid_kind", fmt.Sprintf("%q has no retention period to set here", u.Kind))
	}
	switch u.Mode {
	case ModeDefault:
		delete(stored, p.Kind)
	case ModeKeep:
		stored[p.Kind] = nil
	case ModeDays:
		if u.Days < p.Min || u.Days > p.Max {
			return apperr.Invalid("invalid_period", fmt.Sprintf("The period for %s must be from %d to %d days", u.Kind, p.Min, p.Max))
		}
		stored[p.Kind] = intPtr(u.Days)
	default:
		return apperr.Invalid("invalid_mode", "The mode must be default, keep or days")
	}
	return nil
}

// SetPeriods changes the platform periods (platform admins; audited with
// before and after). Kinds not listed keep their current setting.
// expectedRevision is the If-Match revision.
func (s *Service) SetPeriods(ctx context.Context, a authz.Actor, in []PeriodUpdate, expectedRevision int64) (Settings, error) {
	if err := canWrite(a); err != nil {
		return Settings{}, err
	}
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockRetentionSettings(ctx)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		before, err := ParseStored(cur.Periods)
		if err != nil {
			return err
		}
		after := maps.Clone(before)
		seen := map[Kind]bool{}
		for _, u := range in {
			if seen[u.Kind] {
				return apperr.Invalid("invalid_kind", fmt.Sprintf("%s is listed twice", u.Kind))
			}
			seen[u.Kind] = true
			if err := u.apply(after); err != nil {
				return err
			}
		}
		if samePeriods(before, after) {
			return nil
		}
		raw, err := json.Marshal(after)
		if err != nil {
			return err
		}
		if err := q.SetRetentionPeriods(ctx, dbgen.SetRetentionPeriodsParams{Periods: raw, UpdatedBy: actorID(a.UserID)}); err != nil {
			return err
		}
		e := a.Audit("retention.settings_update", "retention_settings", "retention_settings")
		e.Before, e.After = before, after
		e.Metadata = map[string]any{"name": "Retention settings"}
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return Settings{}, err
	}
	return s.settings(ctx)
}

func samePeriods(a, b Stored) bool {
	return maps.EqualFunc(a, b, func(x, y *int) bool { return (x == nil) == (y == nil) && (x == nil || *x == *y) })
}
