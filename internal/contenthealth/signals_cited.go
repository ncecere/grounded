package contenthealth

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

func (e *Env) scanLimit() int64 {
	if e.AnswerScanLimit > 0 {
		return e.AnswerScanLimit
	}
	return MaxAnswerScan
}

// citedSignal: ready documents for which the retained answer events hold no citation in the observation window. It is **no
// retained citation evidence**, not "never cited" and not "unused", and it is not a claim that the document had a fair chance of
// being cited: Grounded keeps no record of which documents a question could have reached.
//
//   - The window is team-wide: it starts at the later of asOf − citationWindowDays and the team's earliest retained answer event
//     (the first retained event, not the first time any agent could have used a document). Analytics events that were never
//     kept, or that retention removed, are invisible.
//   - Only answers that could have cited something count toward the minimum: not draft test chats, errors, refusals, answers with
//     no context or no retrieved passage, or moderated ones.
//   - Only documents of sources an active, published agent of the team reaches through a knowledge base are judged, only when
//     MinAnswers such answers were kept since the source became reachable (the later of its attachment to the knowledge base and the
//     agent's publish time, rounded up to a UTC day: a bound that can be later than the truth, never earlier), and only documents
//     that existed then. The others are counted, not listed. Earlier exposure (a detached and re-attached source, an older version
//     of the agent) is not recorded, so it is not used.
//   - Which agents' events are read is a bounded, ordered list: more than MaxAgents agents makes the signal unavailable.
//
// It reads message_events only: one content-free row per answer (time, channel, outcome flags, cited document IDs), never a
// question, an answer, a person or a conversation.
type citedSignal struct{}

func (citedSignal) Name() string { return SignalNeverCited }

func (citedSignal) Collect(ctx context.Context, env *Env) (Result, error) {
	if ready, _ := env.readyDocuments(); ready == 0 {
		return notApplicable(ReasonNoDocuments), nil
	}
	agents, err := env.Q.ContentHealthTeamAgents(ctx, dbgen.ContentHealthTeamAgentsParams{TeamID: env.TeamID, Cap: MaxAgents + 1})
	if err != nil {
		return Result{}, err
	}
	switch {
	case len(agents) > MaxAgents:
		return unavailable(ReasonTooManyAgents), nil
	case len(agents) == 0:
		return unavailable(ReasonNoAnswers), nil
	}
	floor := env.AsOf.Add(-time.Duration(env.Params.CitationWindowDays) * day)
	window, err := env.Q.ContentHealthAnswerCount(ctx, dbgen.ContentHealthAnswerCountParams{AgentIDs: agents, FromAt: floor, ToAt: env.AsOf, CapPlusOne: int32(env.scanLimit() + 1)})
	if err != nil {
		return Result{}, err
	}
	counts := map[string]int64{"answers": window.Answers, "minAnswers": MinAnswers}
	switch {
	case window.Events > env.scanLimit():
		delete(counts, "answers") // the limited prefix is not the whole window's denominator
		return Result{State: StateUnavailable, Reason: ReasonTooManyAnswers, Counts: counts}, nil
	case window.Answers == 0:
		return Result{State: StateUnavailable, Reason: ReasonNoAnswers, Counts: counts}, nil
	case window.Answers < MinAnswers:
		return Result{State: StateUnavailable, Reason: ReasonTooFewAnswers, Counts: counts}, nil
	}
	since := window.FirstAt
	elig, err := env.exposure(ctx, since, counts)
	if err != nil {
		return Result{}, err
	}
	res := Result{State: StateUnavailable, Reason: ReasonNoExposure, Counts: counts, ObservedSince: &since}
	if len(elig.sources) == 0 {
		return res, nil
	}
	judge, err := env.Q.ContentHealthJudgeable(ctx, dbgen.ContentHealthJudgeableParams{TeamID: nullID(env.TeamID), EligibleSources: elig.sources, EligibleFrom: elig.from})
	if err != nil {
		return Result{}, err
	}
	counts["judged"], counts["tooNew"] = judge.Judged, judge.TooNew
	if judge.Judged == 0 {
		return res, nil
	}
	rows, err := env.Q.ContentHealthNeverCited(ctx, dbgen.ContentHealthNeverCitedParams{
		TeamID: nullID(env.TeamID), PageSize: MaxFindingsPerSignal, EligibleSources: elig.sources, EligibleFrom: elig.from, EligibleAnswers: elig.answers,
		AgentIDs: agents, ObservedSince: since, AsOf: env.AsOf,
	})
	if err != nil {
		return Result{}, err
	}
	res = Result{State: StateMeasured, Counts: counts, ObservedSince: &since}
	for _, r := range rows {
		res.Found = r.Total
		res.Findings = append(res.Findings, Finding{SourceID: r.SourceID, DocumentID: r.DocumentID, Value: r.Answers, ObservedAt: r.CreatedAt})
	}
	res.Truncated = res.Found > int64(len(res.Findings))
	return res, nil
}

// eligible are the sources whose documents may be judged, with when each became reachable and the answers kept since.
type eligible struct {
	sources []uuid.UUID
	from    []time.Time
	answers []int32
}

// exposure decides, per source of the scope, whether its documents can be judged, records that on the staged coverage and adds
// the document counts that were left out (notServed, fewAnswers) to counts. since is the team-wide window's start.
func (e *Env) exposure(ctx context.Context, since time.Time, counts map[string]int64) (eligible, error) {
	rows, err := e.Q.ContentHealthSourceExposure(ctx, dbgen.ContentHealthSourceExposureParams{TeamID: e.TeamID, SourceIds: e.SourceIDs(), FromAt: since, ToAt: e.AsOf})
	if err != nil {
		return eligible{}, err
	}
	byID := make(map[uuid.UUID]dbgen.ContentHealthSourceExposureRow, len(rows))
	for _, r := range rows {
		byID[r.SourceID] = r
	}
	var out eligible
	var notServed, fewAnswers int64
	for _, s := range e.Sources {
		cov := e.Coverage[s.ID]
		r, ok := byID[s.ID]
		switch {
		case !ok:
			cov.CiteState = CiteNotServed
			notServed += int64(cov.Ready)
		case r.Answers < MinAnswers:
			from := r.ExposedFrom
			cov.CiteState, cov.ExposedSince, cov.ExposureAnswers = CiteTooFewAnswer, &from, int32(r.Answers)
			fewAnswers += int64(cov.Ready)
		default:
			from := r.ExposedFrom
			if from.Before(since) {
				from = since
			}
			cov.CiteState, cov.ExposedSince, cov.ExposureAnswers = CiteJudged, &from, int32(r.Answers)
			out.sources, out.from, out.answers = append(out.sources, s.ID), append(out.from, from), append(out.answers, int32(r.Answers))
		}
	}
	counts["notServed"], counts["fewAnswers"], counts["sourcesJudged"] = notServed, fewAnswers, int64(len(out.sources))
	return out, nil
}
