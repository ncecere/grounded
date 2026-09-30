package healthcheck

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// A Target is one probe of the health job, covering one or more subjects
// (a connection and its models).
type Target struct {
	// Key serialises probes: targets with the same key never run at once.
	// A connection's targets use its ID, so a connection is probed at most
	// once at a time.
	Key string
	// Probe tests the target and returns a result per subject it covers.
	// An error means nothing could be concluded (for example the subject
	// was deleted meanwhile, or the database failed): nothing is recorded.
	Probe func(ctx context.Context) ([]Result, error)
}

// A Checker lists the targets of one family of subjects: the enabled ones.
type Checker interface {
	Targets(ctx context.Context) ([]Target, error)
}

// Store records results and prunes the history (a *Service).
type Store interface {
	Record(ctx context.Context, r Result) (Check, error)
	Prune(ctx context.Context, keep time.Duration) (int64, error)
}

// DefaultConcurrency is how many probes a run has in flight at once.
const DefaultConcurrency = 4

// probeTimeout bounds one probe, besides the connection's own timeout.
const probeTimeout = 2 * time.Minute

// Runner is one run of the health job.
type Runner struct {
	Store    Store
	Checkers []Checker
	// Concurrency bounds the probes in flight (DefaultConcurrency when 0).
	Concurrency int
	// Keep is how long the history is kept (Keep when 0).
	Keep time.Duration
	Log  *slog.Logger
}

// Summary describes a run.
type Summary struct {
	Targets, Healthy, Failing, Errors int
	Pruned                            int64
}

// Run re-tests every target of every checker, records the results and
// prunes the history. With nothing enabled it probes nothing (and still
// prunes the history of deleted subjects).
func (r *Runner) Run(ctx context.Context) (Summary, error) {
	var targets []Target
	for _, c := range r.Checkers {
		ts, err := c.Targets(ctx)
		if err != nil {
			return Summary{}, err
		}
		targets = append(targets, ts...)
	}
	sum := r.probeAll(ctx, targets)
	keep := r.Keep
	if keep == 0 {
		keep = Keep
	}
	n, err := r.Store.Prune(ctx, keep)
	sum.Pruned = n
	return sum, err
}

// probeAll runs the targets, at most Concurrency at once and one per key at
// a time, recording each result.
func (r *Runner) probeAll(ctx context.Context, targets []Target) Summary {
	sum := Summary{Targets: len(targets)}
	if len(targets) == 0 {
		return sum
	}
	n := r.Concurrency
	if n <= 0 {
		n = DefaultConcurrency
	}
	sem := make(chan struct{}, n)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, group := range byKey(targets) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for _, t := range group {
				sem <- struct{}{}
				h, f, e := r.probe(ctx, t)
				<-sem
				mu.Lock()
				sum.Healthy, sum.Failing, sum.Errors = sum.Healthy+h, sum.Failing+f, sum.Errors+e
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return sum
}

// probe runs one target and records its results: the healthy and failing
// results recorded, and 1 if the probe or a record failed.
func (r *Runner) probe(ctx context.Context, t Target) (healthy, failing, errs int) {
	pctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	results, err := t.Probe(pctx)
	if err != nil {
		r.log().WarnContext(ctx, "health check failed to run", "target", t.Key, "err", err)
		return 0, 0, 1
	}
	for _, res := range results {
		res.Trigger = TriggerScheduled
		if _, err := r.Store.Record(ctx, res); err != nil {
			r.log().WarnContext(ctx, "could not record a health check", "kind", res.Kind, "subject", res.SubjectID, "err", err)
			errs = 1
			continue
		}
		if res.OK {
			healthy++
		} else {
			failing++
		}
	}
	return healthy, failing, errs
}

func (r *Runner) log() *slog.Logger {
	if r.Log == nil {
		return slog.Default()
	}
	return r.Log
}

// byKey groups targets by key, keeping their order.
func byKey(targets []Target) [][]Target {
	index := map[string]int{}
	var out [][]Target
	for _, t := range targets {
		i, ok := index[t.Key]
		if !ok {
			i = len(out)
			index[t.Key] = i
			out = append(out, nil)
		}
		out[i] = append(out[i], t)
	}
	return out
}
