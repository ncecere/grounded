// Automatic runs (docs/evaluations.md §4, owner decision 3): opt-in per
// set, retrieval checks only, after an agent is published (its sets), after
// a knowledge base switches embedding profile (its sets), and nightly when
// a knowledge base's documents changed that day. A run that scores worse
// than the previous one notifies the team's editors.

package evals

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// QueueForAgent queues retrieval checks of an agent's sets with automatic
// runs, of its published version. It is agents.Service.OnPublished and runs
// in the publish transaction.
func (s *Service) QueueForAgent(ctx context.Context, tx pgx.Tx, agentID uuid.UUID) error {
	q := dbgen.New(tx)
	return s.queueAuto(ctx, q, tx, TriggerAgentPublished, VersionPublished, func() ([]dbgen.EvalSet, error) {
		return q.AutoRunSetsForAgent(ctx, uuid.NullUUID{UUID: agentID, Valid: true})
	})
}

// QueueForKB queues retrieval checks of a knowledge base's sets with
// automatic runs. It is profilemig.Service.OnSwitched and runs in the switch
// transaction.
func (s *Service) QueueForKB(ctx context.Context, tx pgx.Tx, kbID uuid.UUID) error {
	q := dbgen.New(tx)
	return s.queueAuto(ctx, q, tx, TriggerProfileSwitched, "", func() ([]dbgen.EvalSet, error) {
		return q.AutoRunSetsForKB(ctx, uuid.NullUUID{UUID: kbID, Valid: true})
	})
}

// queueAuto queues a run of each set in the caller's transaction, unless
// evaluations are off. A set with a run in progress or no questions is
// skipped. What the run tests is recorded when it starts (the change that
// triggered it isn't committed yet).
func (s *Service) queueAuto(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, trigger, version string, sets func() ([]dbgen.EvalSet, error)) error {
	st, err := q.GetEvaluationSettings(ctx)
	if err != nil || !st.Enabled {
		return err
	}
	list, err := sets()
	if err != nil {
		return err
	}
	for _, set := range list {
		if _, err := s.queueOne(ctx, q, tx, set, trigger, version); err != nil {
			return err
		}
	}
	return nil
}

// queueOne queues one automatic run; queued is false when the set was
// skipped.
func (s *Service) queueOne(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, set dbgen.EvalSet, trigger, version string) (bool, error) {
	if set.AgentID.Valid && version == "" {
		version = VersionDraft
	}
	run, err := s.insertRun(ctx, q, tx, set, KindRetrieval, trigger, uuid.NullUUID{}, RunConfig{Version: version})
	if errors.Is(err, errRunning) || errors.Is(err, errNoQuestions) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	return true, auditSystem(ctx, q, run, set)
}

// Nightly queues a retrieval check of every set with automatic runs whose
// knowledge bases had documents added, changed or deleted in the last day
// and that had no nightly run since. Agent sets test the published version
// (the draft when never published). It returns how many runs it queued.
func (s *Service) Nightly(ctx context.Context, now time.Time) (int, error) {
	on, err := s.Enabled(ctx)
	if err != nil || !on {
		return 0, err
	}
	sets, err := s.q.NightlyEvalSets(ctx, dbgen.NightlyEvalSetsParams{ChangedSince: now.Add(-24 * time.Hour), RanSince: now.Add(-20 * time.Hour)})
	if err != nil {
		return 0, err
	}
	n := 0
	for _, set := range sets {
		version := ""
		if set.AgentID.Valid {
			version = VersionDraft
			if ag, err := s.q.GetAgent(ctx, set.AgentID.UUID); err == nil && ag.PublishedVersionID.Valid {
				version = VersionPublished
			}
		}
		err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
			locked, err := loadSet(ctx, q, set.TeamID, set.ID, true)
			if err != nil {
				return err
			}
			queued, err := s.queueOne(ctx, q, tx, locked, TriggerNightly, version)
			if queued {
				n++
			}
			return err
		})
		if err != nil && !errors.Is(err, errNoSet) {
			return n, err
		}
	}
	return n, nil
}

// checkDrop compares an automatic run with the previous completed
// retrieval check that has a score and notifies the team's editors when recall@k fell by
// more than 5 points or a question newly fails.
func (s *Service) checkDrop(ctx context.Context, run dbgen.EvalRun, set dbgen.EvalSet, sum Summary) error {
	if s.Notify == nil {
		return nil
	}
	prev, err := s.q.PreviousCompletedRun(ctx, dbgen.PreviousCompletedRunParams{SetID: set.ID, Kind: KindRetrieval, Before: run.CreatedAt})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	prevStatus, err := s.statuses(ctx, prev.ID)
	if err != nil {
		return err
	}
	curStatus, err := s.statuses(ctx, run.ID)
	if err != nil {
		return err
	}
	d := DetectDrop(DecodeRun(prev).Summary, sum, prevStatus, curStatus)
	if !d.Notify() {
		return nil
	}
	team, err := s.q.GetTeamByID(ctx, set.TeamID)
	if err != nil {
		return err
	}
	target := ""
	if v, err := s.view(ctx, set.TeamID, set.ID); err == nil {
		target = v.TargetName
	}
	s.Notify.EmitNow(ctx, notify.EvaluationRegressionEvent(notify.TeamRef{ID: team.ID, Slug: team.Slug, Name: team.Name}, notify.Regression{
		SetID: set.ID, RunID: run.ID, SetName: set.Name, Target: target, Trigger: run.Trigger,
		Recall: d.Recall, PrevRecall: d.PrevRecall, NewlyFailing: d.NewlyFailing,
	}))
	return nil
}

// statuses are a run's result statuses by question.
func (s *Service) statuses(ctx context.Context, runID uuid.UUID) (map[uuid.UUID]string, error) {
	rows, err := s.q.ListEvalResults(ctx, runID)
	out := map[uuid.UUID]string{}
	for _, r := range rows {
		if r.CaseID.Valid {
			out[r.CaseID.UUID] = r.Status
		}
	}
	return out, err
}

// NightlyArgs queues the nightly automatic runs.
type NightlyArgs struct{}

func (NightlyArgs) Kind() string { return "evaluation.nightly" }

func (NightlyArgs) InsertOpts() river.InsertOpts {
	// Several workers schedule the same periodic job; one run a night is enough.
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: 12 * time.Hour}}
}

// NightlyWorker runs Nightly.
type NightlyWorker struct {
	river.WorkerDefaults[NightlyArgs]
	S *Service
}

func (w *NightlyWorker) Work(ctx context.Context, _ *river.Job[NightlyArgs]) error {
	n, err := w.S.Nightly(ctx, time.Now())
	if n > 0 {
		w.S.Log.InfoContext(ctx, "queued nightly evaluation runs", "count", n)
	}
	return err
}

// dailyAt is a periodic schedule: every day at a UTC hour.
type dailyAt int

func (h dailyAt) Next(t time.Time) time.Time {
	t = t.UTC()
	next := time.Date(t.Year(), t.Month(), t.Day(), int(h), 0, 0, 0, time.UTC)
	if !next.After(t) {
		next = next.Add(24 * time.Hour)
	}
	return next
}

// NightlyHour is when the nightly runs are queued (UTC).
const NightlyHour = 3

// Register adds the run and nightly workers.
func Register(w *river.Workers, s *Service) {
	river.AddWorker(w, &RunWorker{S: s})
	river.AddWorker(w, &NightlyWorker{S: s})
}

// Periodic queues the nightly runs every day at NightlyHour UTC.
func Periodic() *river.PeriodicJob {
	return river.NewPeriodicJob(dailyAt(NightlyHour), func() (river.JobArgs, *river.InsertOpts) { return NightlyArgs{}, nil }, nil)
}
