package contenthealth

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var (
	// errCancelled: the report was cancelled, or deleted, while it ran. Nothing is stored.
	errCancelled = errors.New("content health report cancelled")
	// errTooManySources: the scope holds more sources than a report covers.
	errTooManySources = errors.New("content health scope too large")
	// errDisabled: the platform switch was turned off while the report ran. Nothing more is read and nothing is stored.
	errDisabled = errors.New("content health switched off")
)

// storedSignal is a signal's result as kept in the report row: numbers and enums only.
type storedSignal struct {
	Signal        string           `json:"signal"`
	State         string           `json:"state"`
	Reason        string           `json:"reason,omitempty"`
	Found         int64            `json:"found"`
	Truncated     bool             `json:"truncated"`
	Counts        map[string]int64 `json:"counts,omitempty"`
	ObservedSince *time.Time       `json:"observedSince,omitempty"`
}

// outcome is everything a run found, kept in memory (at most MaxFindingsPerSignal per signal) until it is stored at once.
type outcome struct {
	signals  []storedSignal
	findings map[string][]Finding
	coverage []*Coverage
}

func (s *Service) signalTimeout() time.Duration {
	if s.SignalLimit > 0 {
		return s.SignalLimit
	}
	return SignalTimeout
}

// Execute makes a queued report: it starts it, collects every signal under its limits, and stores the result unless the
// report was cancelled or deleted meanwhile. A report that cannot be made ends as failed with a coarse code. It is called by
// the River job (worker.go) and by tests; a request never calls it.
func (s *Service) Execute(ctx context.Context, reportID uuid.UUID) error {
	rep, err := s.q.GetContentHealthReportByID(ctx, reportID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	if rep.Status != StatusQueued {
		return nil
	}
	if on, err := s.enabled(ctx); err != nil {
		return err
	} else if !on {
		return s.fail(ctx, reportID, ErrDisabled)
	}
	rep, err = s.q.StartContentHealthReport(ctx, reportID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // cancelled meanwhile
	} else if err != nil {
		return err
	}
	out, err := s.collect(ctx, rep, *rep.AsOf)
	switch {
	case errors.Is(err, errCancelled):
		return nil
	case errors.Is(err, errTooManySources):
		return s.fail(ctx, reportID, ErrTooManySources)
	case errors.Is(err, errDisabled):
		return s.fail(ctx, reportID, ErrDisabled)
	case err != nil:
		code := ErrInternal
		if errors.Is(err, context.DeadlineExceeded) {
			code = ErrTimedOut
		}
		if ferr := s.fail(ctx, reportID, code); ferr != nil {
			s.Log.WarnContext(ctx, "could not record a failed content health report", "report", reportID, "err", ferr)
		}
		return err
	}
	return s.store(ctx, rep, out)
}

// fail ends a report as failed, whatever the state of the request context.
func (s *Service) fail(ctx context.Context, id uuid.UUID, code string) error {
	n, err := s.q.FailContentHealthReport(context.WithoutCancel(ctx), dbgen.FailContentHealthReportParams{ID: id, ErrorCode: code, RetentionDays: RetentionDays})
	if err == nil && n > 0 {
		observability.ContentHealthReports.WithLabelValues(StatusFailed).Inc()
	}
	return err
}

// collect runs every signal for the report's scope, measuring from asOf. Each signal runs under its own time limit (a
// signal that hits it is unavailable: timed_out, and the others go on), and the report's status and the platform switch are read
// before each one, so a cancel, a delete or switching the feature off stops the work at its next step.
func (s *Service) collect(ctx context.Context, rep dbgen.ContentHealthReport, asOf time.Time) (*outcome, error) {
	env, err := s.environment(ctx, rep, asOf)
	if err != nil {
		return nil, err
	}
	out := &outcome{findings: map[string][]Finding{}}
	for _, sig := range s.signals() {
		if on, err := s.enabled(ctx); err != nil {
			return nil, err
		} else if !on {
			return nil, errDisabled
		}
		if st, err := s.q.ContentHealthReportStatus(ctx, rep.ID); errors.Is(err, pgx.ErrNoRows) || (err == nil && st != StatusRunning) {
			return nil, errCancelled
		} else if err != nil {
			return nil, err
		}
		res, err := s.collectOne(ctx, sig, env)
		if err != nil {
			return nil, err
		}
		if int64(len(res.Findings)) > MaxFindingsPerSignal {
			res.Findings, res.Truncated = res.Findings[:MaxFindingsPerSignal], true
		}
		out.signals = append(out.signals, storedSignal{Signal: sig.Name(), State: res.State, Reason: res.Reason, Found: res.Found,
			Truncated: res.Truncated, Counts: res.Counts, ObservedSince: res.ObservedSince})
		out.findings[sig.Name()] = res.Findings
	}
	for _, src := range env.Sources {
		out.coverage = append(out.coverage, env.Coverage[src.ID])
	}
	return out, nil
}

func (s *Service) signals() []Signal {
	if s.Signals != nil {
		return s.Signals
	}
	return Registry()
}

// collectOne runs one signal under its time limit, on a staged copy of the environment: the coverage the signal wrote is kept
// only when it succeeded in time. A signal that times out is unavailable (timed_out) and says so about its coverage; what it had
// written before is dropped.
func (s *Service) collectOne(ctx context.Context, sig Signal, env *Env) (Result, error) {
	sctx, cancel := context.WithTimeout(ctx, s.signalTimeout())
	defer cancel()
	staged := env.stage()
	res, err := sig.Collect(sctx, staged)
	if err != nil && ctx.Err() == nil && errors.Is(sctx.Err(), context.DeadlineExceeded) {
		if n, ok := sig.(timeoutNoter); ok {
			n.NoteTimeout(env)
		}
		return unavailable(ReasonTimedOut), nil
	}
	if err == nil {
		env.Coverage = staged.Coverage
	}
	return res, err
}

// environment resolves the scope's sources and what is known about each.
func (s *Service) environment(ctx context.Context, rep dbgen.ContentHealthReport, asOf time.Time) (*Env, error) {
	rows, err := s.q.ContentHealthScopeSources(ctx, dbgen.ContentHealthScopeSourcesParams{
		TeamID: nullID(rep.TeamID), SourceID: rep.ScopeSourceID, KBID: rep.ScopeKbID, PageSize: MaxSources + 1,
	})
	if err != nil {
		return nil, err
	}
	if len(rows) > MaxSources {
		return nil, errTooManySources
	}
	env := &Env{Q: s.q, TeamID: rep.TeamID, AsOf: asOf, Params: Params{StaleDays: int(rep.StaleDays), CitationWindowDays: int(rep.CitationWindowDays)},
		Coverage: map[uuid.UUID]*Coverage{}, AnswerScanLimit: s.AnswerScanLimit}
	for _, r := range rows {
		env.Sources = append(env.Sources, Source{ID: r.ID, Type: r.Type, Revision: r.Revision, Classification: r.Classification})
		cov := &Coverage{SourceID: r.ID, Type: r.Type, LinkState: LinkUnknown, SourceRevision: r.Revision, SourceClassification: r.Classification}
		if r.Type != "web" {
			cov.LinkState = LinkNotApplicable // an upload source has no links, whatever else happens
		}
		env.Coverage[r.ID] = cov
	}
	if len(env.Sources) == 0 {
		return env, nil
	}
	counts, err := s.q.ContentHealthSourceCounts(ctx, dbgen.ContentHealthSourceCountsParams{TeamID: nullID(rep.TeamID), SourceIds: env.SourceIDs()})
	if err != nil {
		return nil, err
	}
	for _, c := range counts {
		if cov := env.Coverage[c.SourceID]; cov != nil {
			cov.Documents, cov.Ready, cov.ReadyNoDate, cov.ReadyNoHash = c.Documents, c.Ready, c.ReadyNoDate, c.ReadyNoHash
		}
	}
	return env, nil
}
