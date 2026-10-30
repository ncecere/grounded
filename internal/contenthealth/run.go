package contenthealth

import (
	"context"
	"encoding/json"
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
// signal that hits it is unavailable: timed_out, and the others go on), and the report's status is read before each one,
// so a cancel or a delete stops the work at its next step.
func (s *Service) collect(ctx context.Context, rep dbgen.ContentHealthReport, asOf time.Time) (*outcome, error) {
	env, err := s.environment(ctx, rep, asOf)
	if err != nil {
		return nil, err
	}
	out := &outcome{findings: map[string][]Finding{}}
	for _, sig := range s.signals() {
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

// collectOne runs one signal under its time limit.
func (s *Service) collectOne(ctx context.Context, sig Signal, env *Env) (Result, error) {
	sctx, cancel := context.WithTimeout(ctx, s.signalTimeout())
	defer cancel()
	res, err := sig.Collect(sctx, env)
	if err != nil && ctx.Err() == nil && errors.Is(sctx.Err(), context.DeadlineExceeded) {
		return unavailable(ReasonTimedOut), nil
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
		env.Sources = append(env.Sources, Source{ID: r.ID, Type: r.Type})
		env.Coverage[r.ID] = &Coverage{SourceID: r.ID, Type: r.Type, LinkState: LinkUnknown}
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

// store keeps the outcome and ends the report, in one transaction that first claims the report's end: a report cancelled or
// deleted while it ran ends nothing, and its findings are never written.
func (s *Service) store(ctx context.Context, rep dbgen.ContentHealthReport, out *outcome) error {
	raw, err := json.Marshal(out.signals)
	if err != nil {
		return err
	}
	bg := context.WithoutCancel(ctx) // the report is stored even when the job's own time is up: it was made
	err = pgx.BeginFunc(bg, s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		n, err := q.FinishContentHealthReport(bg, dbgen.FinishContentHealthReportParams{ID: rep.ID, Signals: raw, RetentionDays: RetentionDays})
		if err != nil {
			return err
		}
		if n == 0 {
			return errCancelled
		}
		for _, c := range out.coverage {
			if err := q.InsertContentHealthSource(bg, dbgen.InsertContentHealthSourceParams{
				ReportID: rep.ID, SourceID: c.SourceID, SourceType: c.Type, Documents: c.Documents, Ready: c.Ready, ReadyNoDate: c.ReadyNoDate,
				ReadyNoHash: c.ReadyNoHash, LinkState: c.LinkState, LinkReason: c.LinkReason, LinkCrawlAt: c.LinkCrawlAt, LinkTruncated: c.LinkTruncated,
				LinkFailed: c.LinkFailed,
			}); err != nil {
				return err
			}
		}
		for _, sig := range out.signals {
			if err := insertFindings(bg, tx, rep.ID, rep.TeamID, sig.Signal, out.findings[sig.Signal]); err != nil {
				return err
			}
		}
		return nil
	})
	if errors.Is(err, errCancelled) {
		return nil
	}
	if err == nil {
		observability.ContentHealthReports.WithLabelValues(StatusCompleted).Inc()
	}
	return err
}

// insertFindingsSQL writes a signal's findings from parallel arrays (one round trip). A nil UUID and a zero time mean none.
const insertFindingsSQL = `INSERT INTO content_health_findings (report_id, signal, ord, team_id, source_id, document_id, ref, group_no, group_size, code, detail, value,
                                     observed_at, confirmed_at, in_kb)
SELECT $1, $2, a.ord, $3, a.source_id, NULLIF(a.document_id, '00000000-0000-0000-0000-000000000000'::uuid), a.ref, a.group_no, a.group_size, a.code, a.detail, a.value,
       NULLIF(a.observed_at, '0001-01-01 00:00:00+00'::timestamptz), NULLIF(a.confirmed_at, '0001-01-01 00:00:00+00'::timestamptz), a.in_kb
FROM unnest($4::int[], $5::uuid[], $6::uuid[], $7::text[], $8::int[], $9::int[], $10::text[], $11::text[], $12::bigint[], $13::timestamptz[], $14::timestamptz[], $15::bool[])
     AS a(ord, source_id, document_id, ref, group_no, group_size, code, detail, value, observed_at, confirmed_at, in_kb)`

func insertFindings(ctx context.Context, tx pgx.Tx, reportID, teamID uuid.UUID, signal string, fs []Finding) error {
	if len(fs) == 0 {
		return nil
	}
	n := len(fs)
	ord, src, doc := make([]int32, n), make([]uuid.UUID, n), make([]uuid.UUID, n)
	ref, code, detail := make([]string, n), make([]string, n), make([]string, n)
	groupNo, groupSize := make([]int32, n), make([]int32, n)
	value := make([]int64, n)
	observed, confirmed := make([]time.Time, n), make([]time.Time, n)
	inKB := make([]bool, n)
	for i, f := range fs {
		ord[i], src[i], doc[i], ref[i] = int32(i+1), f.SourceID, f.DocumentID, f.Ref
		groupNo[i], groupSize[i], code[i], detail[i], value[i] = f.GroupNo, f.GroupSize, f.Code, f.Detail, f.Value
		observed[i], confirmed[i], inKB[i] = f.ObservedAt, f.ConfirmedAt, f.InKB
	}
	_, err := tx.Exec(ctx, insertFindingsSQL, reportID, signal, teamID, ord, src, doc, ref, groupNo, groupSize, code, detail, value, observed, confirmed, inKB)
	return err
}
