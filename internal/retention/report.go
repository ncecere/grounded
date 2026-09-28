package retention

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ---- dry-run report ----------------------------------------------------------------------

// Group counts the rows of one kind due now for one team, level, audience
// and reason.
type Group struct {
	TeamID   uuid.NullUUID
	TeamName string
	// Level is the classification level of the rank (nil: none applies).
	Level          *Level
	Audience       string
	Reason         string
	Due, HeldCount int64
}

// KindReport is what one kind's rule would delete now.
type KindReport struct {
	Kind Kind
	// Kept: no period is set, so nothing is due.
	Kept bool
	// Due excludes held rows; Held counts rows past their period that holds keep.
	Due, Held int64
	Groups    []Group
}

// Report is the dry run of every rule: counts only.
type Report struct {
	GeneratedAt time.Time
	Kinds       []KindReport
}

// Report returns what a run would delete now, per kind, team, level,
// audience and reason, and what legal holds keep. It runs in a read-only
// transaction, so it can't write anything.
func (s *Service) Report(ctx context.Context, a authz.Actor) (Report, error) {
	if err := canRead(a); err != nil {
		return Report{}, err
	}
	now := time.Now()
	out := Report{GeneratedAt: now}
	err := pgx.BeginTxFunc(ctx, s.Pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		periods, err := LoadPeriods(ctx, tx, s.Env)
		if err != nil {
			return err
		}
		levels, err := s.levels(ctx, dbgen.New(tx))
		if err != nil {
			return err
		}
		for _, rule := range Rules() {
			kr, err := reportKind(ctx, tx, rule, periods, levels, now)
			if err != nil {
				return fmt.Errorf("retention report %s: %w", rule.Kind, err)
			}
			out.Kinds = append(out.Kinds, kr)
		}
		return nil
	})
	return out, err
}

func reportKind(ctx context.Context, tx pgx.Tx, rule Rule, periods Periods, levels []Level, now time.Time) (KindReport, error) {
	kr := KindReport{Kind: rule.Kind, Groups: []Group{}}
	candidates, ok := rule.candidates(periods)
	if !ok {
		kr.Kept = true
		return kr, nil
	}
	rows, err := tx.Query(ctx, `SELECT c.team_id, coalesce(t.name, ''), c.rank, c.audience, c.reason,
       count(*) FILTER (WHERE NOT c.held), count(*) FILTER (WHERE c.held)
FROM (`+candidates+`) c
LEFT JOIN teams t ON t.id = c.team_id
GROUP BY 1, 2, 3, 4, 5
ORDER BY 6 DESC, 7 DESC, 2, 3`, now)
	if err != nil {
		return kr, err
	}
	kr.Groups, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Group, error) {
		var g Group
		var rank *int32
		err := row.Scan(&g.TeamID, &g.TeamName, &rank, &g.Audience, &g.Reason, &g.Due, &g.HeldCount)
		g.Level = levelOf(levels, rank)
		return g, err
	})
	for _, g := range kr.Groups {
		kr.Due += g.Due
		kr.Held += g.HeldCount
	}
	return kr, err
}

// levelOf is the level a rank falls in: the highest level at or below it.
func levelOf(levels []Level, rank *int32) *Level {
	if rank == nil {
		return nil
	}
	var out *Level
	for i := range levels {
		if levels[i].Rank <= *rank && (out == nil || levels[i].Rank > out.Rank) {
			out = &levels[i]
		}
	}
	return out
}

// ---- runs --------------------------------------------------------------------------------

// Run is one retention run.
type Run struct {
	ID          int64
	Trigger     string
	RequestedBy Person
	// Kinds lists the kinds it ran (empty: all).
	Kinds      []Kind
	Status     string
	Results    Results
	Error      string
	CreatedAt  time.Time
	StartedAt  *time.Time
	FinishedAt *time.Time
}

// Runs lists the latest runs, newest first.
func (s *Service) Runs(ctx context.Context, a authz.Actor, limit int32) ([]Run, error) {
	if err := canRead(a); err != nil {
		return nil, err
	}
	rows, err := dbgen.New(s.Pool).ListRetentionRuns(ctx, limit)
	if err != nil {
		return nil, err
	}
	out := make([]Run, 0, len(rows))
	for _, r := range rows {
		run, err := toRun(r.RetentionRun)
		if err != nil {
			return nil, err
		}
		run.RequestedBy = person(r.RetentionRun.RequestedBy, r.RequestedByName, r.RequestedByEmail)
		out = append(out, run)
	}
	return out, nil
}

func toRun(r dbgen.RetentionRun) (Run, error) {
	run := Run{ID: r.ID, Trigger: r.Trigger, Kinds: []Kind{}, Status: r.Status, Results: Results{}, Error: r.Error,
		CreatedAt: r.CreatedAt, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt}
	for _, k := range r.Kinds {
		run.Kinds = append(run.Kinds, Kind(k))
	}
	if len(r.Results) > 0 {
		if err := json.Unmarshal(r.Results, &run.Results); err != nil {
			return Run{}, err
		}
	}
	return run, nil
}

// RequestRun queues a run of the given kinds (all when none) now, after any
// run in progress (platform admins; audited).
func (s *Service) RequestRun(ctx context.Context, a authz.Actor, kinds []Kind) (Run, error) {
	if err := canWrite(a); err != nil {
		return Run{}, err
	}
	names := make([]string, 0, len(kinds))
	for _, k := range kinds {
		if !k.Valid() {
			return Run{}, apperr.Invalid("invalid_kind", fmt.Sprintf("Unknown data kind %q", k))
		}
		names = append(names, string(k))
	}
	if s.Jobs == nil {
		return Run{}, apperr.New(503, "jobs_unavailable", "The job queue is not available")
	}
	var run Run
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		r, err := q.InsertRetentionRun(ctx, dbgen.InsertRetentionRunParams{Trigger: "manual", RequestedBy: actorID(a.UserID), Kinds: names, Status: "queued"})
		if err != nil {
			return err
		}
		if _, err := s.Jobs.InsertTx(ctx, tx, RequestedArgs{RunID: r.ID}, nil); err != nil {
			return err
		}
		e := a.Audit("retention.run_request", "retention", strconv.FormatInt(r.ID, 10))
		e.Metadata = map[string]any{"name": "Retention run", "runId": r.ID, "kinds": names}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		run, err = toRun(r)
		return err
	})
	return run, err
}
