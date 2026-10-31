package auditexport

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Freeze creates an immutable daily snapshot. This internal function has no
// HTTP caller: future integration MUST authorize an approved admin request and
// enqueue River work in the transaction, not expose this as a direct route.
// Existing-day requests return the original ID. Serialization conflicts retry
// at most four times; callers may safely retry after a transport failure.
func Freeze(ctx context.Context, pool *pgxpool.Pool, day time.Time, actor audit.Entry) (uuid.UUID, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if day.Location() != time.UTC || day != day.Truncate(24*time.Hour) {
		return uuid.Nil, ErrRange
	}
	for range 4 {
		id, err := freezeOnce(ctx, pool, day, actor)
		var pgerr *pgconn.PgError
		if !errors.As(err, &pgerr) || (pgerr.Code != "40001" && pgerr.Code != "23505") {
			return id, err
		}
	}
	return uuid.Nil, errors.New("audit export: snapshot contention; retry request")
}

func freezeOnce(ctx context.Context, pool *pgxpool.Pool, day time.Time, actor audit.Entry) (uuid.UUID, error) {
	id := uuid.New()
	err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET LOCAL statement_timeout = '25s'; SET LOCAL lock_timeout = '5s'; SET LOCAL idle_in_transaction_session_timeout = '30s'"); err != nil {
			return err
		}
		q := dbgen.New(tx)
		if err := q.LockAuditExports(ctx); err != nil {
			return err
		}
		clock, err := q.AuditExportSnapshot(ctx)
		if err != nil {
			return err
		}
		if !day.AddDate(0, 0, 1).Before(clock.SnapshotAt) && !day.AddDate(0, 0, 1).Equal(clock.SnapshotAt) {
			return ErrRange
		}
		date := pgtype.Date{Time: day, Valid: true}
		existing, err := q.GetAuditExportByDay(ctx, date)
		if err == nil {
			id = existing.ID
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		prev, err := q.LatestAuditExport(ctx)
		previousHash := ""
		coverage := date
		if err == nil {
			if prev.State != "completed" || !prev.Day.Time.AddDate(0, 0, 1).Equal(day) {
				return ErrRange
			}
			previousHash = *prev.EnvelopeHash
			coverage = prev.CoverageStart
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		count, err := q.CountAuditExportCandidates(ctx, dbgen.CountAuditExportCandidatesParams{Watermark: clock.Watermark, CoverageStart: coverage.Time, DayEnd: day.AddDate(0, 0, 1)})
		if err != nil {
			return err
		}
		if count > MaxRecords {
			return ErrLimit
		}
		if err := q.CreateAuditExport(ctx, dbgen.CreateAuditExportParams{
			ID: id, Day: date, CoverageStart: coverage, SnapshotAt: clock.SnapshotAt, Watermark: clock.Watermark, PreviousHash: previousHash,
		}); err != nil {
			return err
		}
		if err := freezePages(ctx, q, id, coverage.Time, day, clock.Watermark); err != nil {
			return err
		}
		actor.Action, actor.TargetType, actor.TargetID = "audit_export.request", "platform_settings", "audit_exports"
		actor.Before, actor.After = nil, nil
		actor.Metadata = map[string]any{"exportId": id.String(), "day": day.Format("2006-01-02")}
		return audit.Record(ctx, q, actor)
	})
	return id, err
}

func freezePages(ctx context.Context, q *dbgen.Queries, id uuid.UUID, coverage, day time.Time, watermark int64) error {
	var after, count int64
	for {
		ids, err := q.FreezeAuditExportPage(ctx, dbgen.FreezeAuditExportPageParams{
			ExportID: id, AfterID: after, Watermark: watermark, CoverageStart: coverage, DayEnd: day.AddDate(0, 0, 1),
		})
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		count += int64(len(ids))
		if count > MaxRecords {
			return ErrLimit
		}
		// INSERT RETURNING has no ordering promise; compute max explicitly.
		for _, n := range ids {
			after = max(after, n)
		}
	}
}
