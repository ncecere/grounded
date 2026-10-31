package auditexport

import (
	"context"
	"crypto/ed25519"
	"errors"
	"io"
	"os"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Service retains private signing material only in process memory. Settings
// accept approval, never keys, paths, URLs or secret bytes.
type Service struct {
	Pool  *pgxpool.Pool
	Store blob.Store
	Jobs  *jobs.Client
	key   ed25519.PrivateKey
}

// New loads an explicitly configured operator file once, not on GET. Raw
// Ed25519 private keys only, regular file, private permissions, bounded read.
// Readiness is false for every error; no path/content escapes in an error.
func New(pool *pgxpool.Pool, store blob.Store, jobs *jobs.Client, path string) *Service {
	s := &Service{Pool: pool, Store: store, Jobs: jobs}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return s
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 {
		return s
	}
	b, err := io.ReadAll(io.LimitReader(f, 65))
	if err != nil {
		return s
	}
	if _, err = sign(Manifest{}, ed25519.PrivateKey(b)); err == nil {
		s.key = ed25519.PrivateKey(b)
	}
	return s
}
func (s *Service) KeyID() string {
	if len(s.key) != 64 {
		return ""
	}
	return digest(s.key.Public().(ed25519.PublicKey))
}
func unavailable() error {
	return apperr.New(503, "audit_export_unavailable", "Private signed export configuration is unavailable")
}
func date(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }

func (s *Service) Configure(ctx context.Context, rev int64, enabled bool, start time.Time, actor audit.Entry) (out dbgen.AuditExportSetting, err error) {

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if start.Location() != time.UTC || start != start.Truncate(24*time.Hour) || !start.Before(time.Now().UTC().Truncate(24*time.Hour)) {
		return out, ErrRange
	}
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, "SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '25s'"); e != nil {
			return e
		}
		q := dbgen.New(tx)
		cur, e := q.LockAuditExportSettings(ctx)
		if e != nil {
			return e
		}
		if cur.Revision != rev {
			return apperr.Stale()
		}
		if enabled && s.KeyID() == "" {
			return unavailable()
		}
		latest, e := q.LatestAuditExportRequest(ctx)
		if e == nil && !cur.CoverageStart.Time.Equal(start) {
			return apperr.Conflict("coverage_started", "Coverage start cannot change after a request")
		}
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		_ = latest
		out, e = q.UpdateAuditExportSettings(ctx, dbgen.UpdateAuditExportSettingsParams{Enabled: enabled, CoverageStart: date(start)})
		if e != nil {
			return e
		}
		actor.Action, actor.TargetType, actor.TargetID = "audit_export.configure", "platform_settings", "audit_exports"
		actor.Before, actor.After = nil, nil
		actor.Metadata = map[string]any{"enabled": enabled, "coverageStart": start.Format("2006-01-02")}
		return audit.Record(ctx, q, actor)
	})
	return
}

// Request serializes only approval/queue changes; no network I/O under locks.
// There is at most one outstanding day; failed days require explicit retry.
func (s *Service) Request(ctx context.Context, rev int64, day time.Time, retry uuid.UUID, actor audit.Entry) (out dbgen.AuditExportRequest, err error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if s.Jobs == nil {
		return out, unavailable()
	}
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, "SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '25s'"); e != nil {
			return e
		}
		q := dbgen.New(tx)
		cfg, e := s.approvedRequest(ctx, q, rev, retry)
		if e != nil {
			return e
		}
		if retry != uuid.Nil {
			out, e = q.RetryAuditExportRequest(ctx, dbgen.RetryAuditExportRequestParams{ID: retry, Revision: rev})
			if e != nil {
				return apperr.Conflict("not_failed", "Only failed requests can be retried")
			}
		} else {
			if cfg.Revision != rev {
				return apperr.Stale()
			}
			latest, e := q.LatestAuditExportRequest(ctx)
			want := cfg.CoverageStart.Time
			if e == nil {
				if latest.Day.Time.Equal(day) {
					out = latest
					return nil
				}
				if latest.State != "completed" {
					return apperr.Conflict("previous_incomplete", "Complete or retry the previous day first")
				}
				want = latest.Day.Time.AddDate(0, 0, 1)
			} else if !errors.Is(e, pgx.ErrNoRows) {
				return e
			}
			if !day.Equal(want) || !day.Before(time.Now().UTC().Truncate(24*time.Hour)) {
				return ErrRange
			}
			out, e = q.CreateAuditExportRequest(ctx, dbgen.CreateAuditExportRequestParams{ID: uuid.New(), Day: date(day)})
			if e != nil {
				return e
			}
		}
		if _, e = s.Jobs.InsertTx(ctx, tx, RunArgs{ID: out.ID}, nil); e != nil {
			return e
		}
		actor.Action, actor.TargetType, actor.TargetID = "audit_export.enqueue", "platform_settings", "audit_exports"
		actor.Metadata = map[string]any{"requestId": out.ID.String(), "day": out.Day.Time.Format("2006-01-02")}
		actor.Before, actor.After = nil, nil
		return audit.Record(ctx, q, actor)
	})
	return
}

func (s *Service) approvedRequest(ctx context.Context, q *dbgen.Queries, rev int64, retry uuid.UUID) (cfg dbgen.AuditExportSetting, err error) {
	cfg, err = q.LockAuditExportSettings(ctx)
	if err != nil {
		return
	}
	revision := cfg.Revision
	if retry != uuid.Nil {
		current, e := q.GetAuditExportRequest(ctx, retry)
		if e != nil {
			return cfg, e
		}
		revision = current.Revision
	}
	if revision != rev {
		return cfg, apperr.Stale()
	}
	if !cfg.Enabled {
		return cfg, apperr.Conflict("exports_off", "Daily exports are off")
	}
	if s.KeyID() == "" {
		return cfg, unavailable()
	}
	return cfg, nil
}
