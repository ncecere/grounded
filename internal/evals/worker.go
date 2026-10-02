// The run job (docs/evaluations.md §4): a River job checks a run's
// questions a few at a time, for a bounded time per invocation (then it
// snoozes and carries on), and stops when the run is cancelled or a limit
// refuses it. Results are written as they come, so progress is live and a
// resumed job skips what is done.

package evals

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
)

// Queue is the River queue of evaluation runs.
const Queue = "evaluations"

// RunArgs works one evaluation run.
type RunArgs struct {
	RunID uuid.UUID `json:"runId"`
}

func (RunArgs) Kind() string { return "evaluation.run" }

func (RunArgs) InsertOpts() river.InsertOpts { return river.InsertOpts{Queue: Queue} }

// RunWorker runs evaluation.run.
type RunWorker struct {
	river.WorkerDefaults[RunArgs]
	S *Service
	// Budget is the work time per invocation (default 3 min); the rest
	// continues in the next one.
	Budget time.Duration
}

func (w *RunWorker) budget() time.Duration {
	if w.Budget > 0 {
		return w.Budget
	}
	return 3 * time.Minute
}

func (w *RunWorker) Timeout(*river.Job[RunArgs]) time.Duration { return w.budget() + 10*time.Minute }

func (w *RunWorker) Work(ctx context.Context, job *river.Job[RunArgs]) error {
	more, err := w.S.Execute(ctx, job.Args.RunID, time.Now().Add(w.budget()))
	if err != nil || !more {
		return err
	}
	return river.JobSnooze(0)
}

// Execute works a run until it ends or the deadline passes (more: call
// again). A run that can't go on (a limit or budget refused it, its agent
// can't answer) ends as failed with the reason; other errors are returned
// for River to retry. Its SystemOne calls (through the agent pipeline) run at
// background priority (docs/v0.4.1.md §4), behind answers people wait for.
func (s *Service) Execute(ctx context.Context, runID uuid.UUID, deadline time.Time) (more bool, err error) {
	ctx = systemone.WithPriority(ctx, systemone.Background)
	run, err := s.q.GetEvalRunByID(ctx, runID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil // the set (or the run) was deleted
	} else if err != nil {
		return false, err
	}
	if run.Status != "queued" && run.Status != "running" {
		return false, nil
	}
	set, err := s.q.GetEvalSetByID(ctx, run.SetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	if err := s.q.MarkEvalRunRunning(ctx, run.ID); err != nil {
		return false, err
	}
	x, err := s.executor(ctx, run, set)
	if err != nil {
		return false, s.endRun(ctx, run, set, err)
	}
	for time.Now().Before(deadline) {
		cur, err := s.q.GetEvalRunByID(ctx, run.ID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && cur.Status != "running") {
			return false, nil // cancelled, or the set was deleted
		} else if err != nil {
			return false, err
		}
		cases, err := s.q.PendingEvalCases(ctx, dbgen.PendingEvalCasesParams{SetID: set.ID, Before: run.CreatedAt, RunID: run.ID,
			Lim: int32(max(s.Concurrency, 1))})
		if err != nil {
			return false, err
		}
		if len(cases) == 0 {
			return false, s.endRun(ctx, run, set, nil)
		}
		fatal := x.checkAll(ctx, cases)
		if err := s.q.SetEvalRunProgress(ctx, run.ID); err != nil {
			return false, err
		}
		if fatal != nil {
			if ctx.Err() != nil {
				return false, ctx.Err() // shutting down: River runs it again
			}
			return false, s.endRun(ctx, run, set, fatal)
		}
	}
	return true, nil
}

// executor checks a run's questions.
type executor struct {
	s       *Service
	run     dbgen.EvalRun
	actor   authz.Actor
	t       target
	sources []uuid.UUID
	meta    map[string]any
}

// executor resolves what the run checks, as it is now, and records that
// configuration on the run (automatic runs are queued before it is known).
func (s *Service) executor(ctx context.Context, run dbgen.EvalRun, set dbgen.EvalSet) (*executor, error) {
	cfg := DecodeRun(run).Config
	t, err := s.loadTarget(ctx, set, cfg.Version, cfg.Rerank == RerankOff)
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(t.cfg)
	if err := s.q.SetEvalRunConfig(ctx, dbgen.SetEvalRunConfigParams{ID: run.ID, Config: raw}); err != nil {
		return nil, err
	}
	run.Config = raw
	x := &executor{s: s, run: run, actor: systemActor, t: t,
		meta: map[string]any{"source": "evaluation", "evaluationRunId": run.ID.String(), "evaluationSetId": set.ID.String()}}
	if run.StartedBy.Valid {
		x.actor = authz.Actor{UserID: run.StartedBy.UUID}
	}
	kbIDs := make([]uuid.UUID, len(t.cfg.KBs))
	for i, kb := range t.cfg.KBs {
		kbIDs[i] = kb.ID
	}
	if x.sources, err = s.sourceIDs(ctx, kbIDs); err != nil {
		return nil, err
	}
	return x, nil
}

// checkAll checks cases a few at a time and stores their results. It
// returns the first error that stops the run.
func (x *executor) checkAll(ctx context.Context, cases []dbgen.EvalCase) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var (
		mu    sync.Mutex
		fatal error
		wg    sync.WaitGroup
	)
	stop := func(err error) {
		mu.Lock()
		defer mu.Unlock()
		if fatal == nil {
			fatal = err
			cancel()
		}
	}
	sem := make(chan struct{}, max(x.s.Concurrency, 1))
	for _, c := range cases {
		sem <- struct{}{}
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			p, err := x.check(ctx, c)
			if err != nil {
				stop(err)
				return
			}
			if err := x.s.q.InsertEvalResult(context.WithoutCancel(ctx), p); err != nil {
				stop(err)
			}
		}()
	}
	wg.Wait()
	mu.Lock()
	defer mu.Unlock()
	return fatal
}

// endRun ends a run: completed (cause nil) or failed with the cause's
// message, with its summary; an automatic retrieval check that dropped
// notifies the team's editors.
func (s *Service) endRun(ctx context.Context, run dbgen.EvalRun, set dbgen.EvalSet, cause error) error {
	ctx = context.WithoutCancel(ctx)
	if cur, err := s.q.GetEvalRunByID(ctx, run.ID); err == nil {
		run = cur // the configuration the executor recorded
	}
	sum, err := summarize(ctx, s.q, run)
	if err != nil {
		return err
	}
	raw, _ := json.Marshal(sum)
	p := dbgen.FinishEvalRunParams{ID: run.ID, Status: "completed", Summary: raw}
	if cause != nil {
		p.Status, p.Error = "failed", "The run stopped: something went wrong."
		if e, ok := apperr.As(cause); ok {
			p.Error = "The run stopped: " + e.Message
		} else {
			s.Log.Error("evaluation run failed", "run", run.ID, "err", cause)
		}
	}
	done, err := s.q.FinishEvalRun(ctx, p)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // cancelled meanwhile
	} else if err != nil {
		return err
	}
	if cause == nil && done.Trigger != TriggerManual && done.Kind == KindRetrieval {
		if err := s.checkDrop(ctx, done, set, sum); err != nil {
			s.Log.Warn("evaluation regression check", "run", run.ID, "err", err)
		}
	}
	return nil
}
