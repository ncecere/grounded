package contenthealth

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Link failure kinds (the finding's code).
const (
	LinkNotFound     = "not_found"
	LinkHTTPError    = "http_error"
	LinkNetworkError = "network_error"
)

// linkCode classifies a failed frontier URL by the reason the crawler recorded: a 404 or 410, another HTTP status, or a
// network or redirect error. The error's own text is never kept.
func linkCode(reason string) string {
	switch reason {
	case "not_found":
		return LinkNotFound
	case "http_error":
		return LinkHTTPError
	}
	return LinkNetworkError
}

// linkSignal: URLs the latest completed crawl of a web source tried to fetch and failed. It is a read of the crawl's own
// record (the frontier Grounded keeps for the latest completed crawl of each source): no request is made, and nothing
// outside the crawler's allowlist and SSRF controls is ever fetched. It says nothing about which page links to the URL
// (the crawler does not record that) or whether the link still fails. A source without such a record is unknown.
type linkSignal struct{}

func (linkSignal) Name() string { return SignalBrokenLink }

func (linkSignal) Collect(ctx context.Context, env *Env) (Result, error) {
	var web []uuid.UUID
	for _, s := range env.Sources {
		if s.Type == "web" {
			web = append(web, s.ID)
		} else {
			env.Coverage[s.ID].LinkState = LinkNotApplicable
		}
	}
	if len(web) == 0 {
		return notApplicable(ReasonNoWebSources), nil
	}
	crawls, err := env.Q.ContentHealthLatestCrawls(ctx, web)
	if err != nil {
		return Result{}, err
	}
	latest := make(map[uuid.UUID]dbgen.ContentHealthLatestCrawlsRow, len(crawls))
	for _, c := range crawls {
		latest[c.SourceID] = c
	}
	res := Result{State: StateMeasured, Counts: map[string]int64{}}
	var observed, unknown int64
	for _, id := range web {
		cov := env.Coverage[id]
		n, taken, err := collectLinks(ctx, env, cov, latest[id], &res)
		if err != nil {
			return Result{}, err
		}
		if cov.LinkState == LinkObserved {
			observed++
			res.Found += n
			res.Truncated = res.Truncated || n > taken
		} else {
			unknown++
		}
	}
	res.Counts["sourcesObserved"], res.Counts["sourcesUnknown"] = observed, unknown
	if observed == 0 {
		out := unavailable(ReasonNoCrawlRecord)
		out.Counts = res.Counts
		return out, nil
	}
	return res, nil
}

// collectLinks reads one web source's failures into res and records on its coverage whether its links were observed.
// It returns how many failures the crawl recorded and how many it kept.
func collectLinks(ctx context.Context, env *Env, cov *Coverage, crawl dbgen.ContentHealthLatestCrawlsRow, res *Result) (total, taken int64, err error) {
	switch {
	case crawl.ID == uuid.Nil:
		cov.LinkState, cov.LinkReason = LinkUnknown, LinkNeverCrawled
		return 0, 0, nil
	case crawl.Trigger == "page":
		// A single-page re-fetch prunes the full crawl's record when it finishes, so nothing says what the last full crawl saw.
		cov.LinkState, cov.LinkReason = LinkUnknown, LinkPageRefetchLatest
		return 0, 0, nil
	}
	have, err := env.Q.ContentHealthFrontierCount(ctx, crawl.ID)
	if err != nil {
		return 0, 0, err
	}
	if have == 0 {
		cov.LinkState, cov.LinkReason = LinkUnknown, LinkNoCrawlRecord
		return 0, 0, nil
	}
	room := MaxFindingsPerSignal - len(res.Findings)
	rows, err := env.Q.ContentHealthFrontierFailures(ctx, dbgen.ContentHealthFrontierFailuresParams{CrawlID: crawl.ID, PageSize: int32(max(room, 1))})
	if err != nil {
		return 0, 0, err
	}
	at := crawl.FinishedAt
	cov.LinkState, cov.LinkCrawlAt, cov.LinkTruncated = LinkObserved, &at, crawl.Truncated
	for i, r := range rows {
		total = r.Total
		if i >= room {
			break
		}
		taken++
		res.Findings = append(res.Findings, Finding{
			SourceID: cov.SourceID, Ref: r.URL, Code: linkCode(r.Reason), Value: int64(r.HttpStatus), ObservedAt: at,
		})
	}
	cov.LinkFailed = int32(total)
	return total, taken, nil
}

func (e *Env) scanLimit() int64 {
	if e.AnswerScanLimit > 0 {
		return e.AnswerScanLimit
	}
	return MaxAnswerScan
}

// citedSignal: ready documents no answer cited in the observation window. The window starts at the later of
// asOf − citationWindowDays and the team's earliest remaining answer event, so a team with little history, or whose events
// were deleted or aged out, is not judged on time nobody observed; only documents that existed then are judged. It needs
// MinAnswers answers to say anything, and it is not proof a document is useless. It reads message_events only: one
// content-free row per answer (time, channel, cited document IDs), never a question, an answer, a person or a conversation.
type citedSignal struct{}

func (citedSignal) Name() string { return SignalNeverCited }

func (citedSignal) Collect(ctx context.Context, env *Env) (Result, error) {
	if ready, _ := env.readyDocuments(); ready == 0 {
		return notApplicable(ReasonNoDocuments), nil
	}
	agents, err := env.Q.ContentHealthTeamAgents(ctx, env.TeamID)
	if err != nil {
		return Result{}, err
	}
	if len(agents) == 0 {
		return unavailable(ReasonNoAnswers), nil
	}
	floor := env.AsOf.Add(-time.Duration(env.Params.CitationWindowDays) * day)
	answers, err := env.Q.ContentHealthAnswerCount(ctx, dbgen.ContentHealthAnswerCountParams{AgentIDs: agents, FromAt: floor, ToAt: env.AsOf, CapPlusOne: int32(env.scanLimit() + 1)})
	if err != nil {
		return Result{}, err
	}
	counts := map[string]int64{"answers": answers, "minAnswers": MinAnswers}
	switch {
	case answers > env.scanLimit():
		delete(counts, "answers")
		return Result{State: StateUnavailable, Reason: ReasonTooManyAnswers, Counts: counts}, nil
	case answers == 0:
		return Result{State: StateUnavailable, Reason: ReasonNoAnswers, Counts: counts}, nil
	case answers < MinAnswers:
		return Result{State: StateUnavailable, Reason: ReasonTooFewAnswers, Counts: counts}, nil
	}
	first, err := env.Q.ContentHealthFirstAnswer(ctx, dbgen.ContentHealthFirstAnswerParams{AgentIDs: agents, FromAt: floor, ToAt: env.AsOf})
	if err != nil {
		return Result{}, err
	}
	since := first
	judge, err := env.Q.ContentHealthJudgeable(ctx, dbgen.ContentHealthJudgeableParams{
		TeamID: nullID(env.TeamID), SourceIds: env.SourceIDs(), ObservedSince: since,
	})
	if err != nil {
		return Result{}, err
	}
	counts["judged"], counts["tooNew"] = judge.Judged, judge.TooNew
	rows, err := env.Q.ContentHealthNeverCited(ctx, dbgen.ContentHealthNeverCitedParams{
		TeamID: env.TeamID, SourceIds: env.SourceIDs(), ObservedSince: since, AgentIDs: agents, AsOf: env.AsOf, PageSize: MaxFindingsPerSignal,
	})
	if err != nil {
		return Result{}, err
	}
	res := Result{State: StateMeasured, Counts: counts, ObservedSince: &since}
	for _, r := range rows {
		res.Found = r.Total
		res.Findings = append(res.Findings, Finding{SourceID: r.SourceID, DocumentID: r.DocumentID, ObservedAt: r.CreatedAt, InKB: r.InKb})
	}
	res.Truncated = res.Found > int64(len(res.Findings))
	return res, nil
}
