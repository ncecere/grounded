package costs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// The hourly usage rollup (docs/costs.md §3). A periodic job rolls each
// closed UTC hour up once, RollupGrace after it ends (for late commits),
// from usage_events into usage_rollup, and advances the watermark
// (usage_rollup_state.rolled_until). Reads add the open hours live from
// usage_events, in the same statement, so an hour is never counted twice.
//
// The first run backfills every past hour. Events the retention job purged
// before E2 existed survive only in usage_daily, by UTC day: each such day
// goes into its first hour. Afterwards the retention purge (internal/
// retention) adds events of hours not rolled up yet to usage_rollup itself,
// under a share lock on the watermark, so the purge and the rollup never
// count the same event.

// RollupGrace is how long after an hour ends it is rolled up.
const RollupGrace = 10 * time.Minute

// rollupChunk bounds the hours one transaction rolls up.
const rollupChunk = 7 * 24 * time.Hour

const rollupConflict = `
ON CONFLICT ON CONSTRAINT usage_rollup_key DO UPDATE
SET quantity = usage_rollup.quantity + EXCLUDED.quantity, events = usage_rollup.events + EXCLUDED.events`

// rollupEventsSQL rolls up the events of [$1, $2).
const rollupEventsSQL = `
INSERT INTO usage_rollup (hour, kind, team_id, agent_id, model_id, channel, quantity, events)
SELECT date_trunc('hour', occurred_at, 'UTC'), kind, team_id, agent_id, model_id, coalesce(metadata->>'channel', ''),
       sum(quantity), count(*)
FROM usage_events WHERE occurred_at >= $1 AND occurred_at < $2
GROUP BY 1, 2, 3, 4, 5, 6` + rollupConflict

// backfillSQL rolls up every event before $1 and every purged day.
const backfillSQL = `
INSERT INTO usage_rollup (hour, kind, team_id, agent_id, model_id, channel, quantity, events)
SELECT hour, kind, team_id, agent_id, model_id, channel, sum(quantity), sum(events)
FROM (
    SELECT date_trunc('hour', occurred_at, 'UTC') AS hour, kind, team_id, agent_id, model_id,
           coalesce(metadata->>'channel', '') AS channel, quantity, 1::bigint AS events
    FROM usage_events WHERE occurred_at < $1
    UNION ALL
    SELECT day::timestamp AT TIME ZONE 'UTC', kind, team_id, agent_id, model_id, channel, quantity, events
    FROM usage_daily
) u
GROUP BY 1, 2, 3, 4, 5, 6` + rollupConflict

// Rollup rolls up every closed hour not rolled yet and returns the new
// watermark (the first hour not rolled).
func (s *Service) Rollup(ctx context.Context) (time.Time, error) {
	until := s.now().Add(-RollupGrace).UTC().Truncate(time.Hour)
	for {
		var next time.Time
		err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, tx pgx.Tx) error {
			ru, err := q.LockRollupState(ctx)
			if err != nil {
				return err
			}
			switch {
			case ru == nil:
				next = until
				_, err = tx.Exec(ctx, backfillSQL, until)
			case !ru.Before(until):
				next = *ru
				return nil
			default:
				next = ru.Add(rollupChunk)
				if next.After(until) {
					next = until
				}
				_, err = tx.Exec(ctx, rollupEventsSQL, *ru, next)
			}
			if err != nil {
				return err
			}
			return q.SetRollupState(ctx, &next)
		})
		if err != nil || !next.Before(until) {
			return next.UTC(), err
		}
	}
}

// RollupInterval is how often the rollup job runs.
const RollupInterval = 5 * time.Minute

// RollupArgs is the periodic rollup job.
type RollupArgs struct{}

func (RollupArgs) Kind() string { return "costs.rollup" }

func (RollupArgs) InsertOpts() river.InsertOpts {
	// Several workers schedule the periodic job; one run per period is enough.
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: RollupInterval}}
}

// RollupWorker runs the rollup.
type RollupWorker struct {
	river.WorkerDefaults[RollupArgs]
	S *Service
}

func (w *RollupWorker) Timeout(*river.Job[RollupArgs]) time.Duration { return 30 * time.Minute }

func (w *RollupWorker) Work(ctx context.Context, _ *river.Job[RollupArgs]) error {
	_, err := w.S.Rollup(ctx)
	return err
}

// RollupPeriodic schedules the rollup every RollupInterval (and on start).
func RollupPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(RollupInterval),
		func() (river.JobArgs, *river.InsertOpts) { return RollupArgs{}, nil }, &river.PeriodicJobOpts{RunOnStart: true})
}
