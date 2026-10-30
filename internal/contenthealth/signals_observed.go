package contenthealth

import (
	"context"
	"net/url"
	"strings"

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

// NoteTimeout: the signal ran out of time, so its sources' links are unknown, never "observed" by a half-finished run.
func (linkSignal) NoteTimeout(env *Env) {
	for _, s := range env.Sources {
		if s.Type == "web" {
			env.Coverage[s.ID].LinkState, env.Coverage[s.ID].LinkReason = LinkUnknown, LinkSignalTimedOut
		}
	}
}

// sanitizeURL is an address as a report may keep it: scheme, host and path. Credentials (userinfo), the query and the fragment
// can hold secrets or tokens and are never stored. The path can still hold something sensitive (an identifier, a name): that is
// stated beside the finding and it is shown only to the team's editors. ok is false for an address that cannot be made safe.
func sanitizeURL(raw string) (string, bool) {
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", false
	}
	u.User, u.RawQuery, u.Fragment, u.ForceQuery = nil, "", "", false
	return u.String(), true
}

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
	cov.LinkState, cov.LinkCrawlAt, cov.LinkTruncated, cov.LinkCrawlID = LinkObserved, &at, crawl.Truncated, crawl.ID
	for i, r := range rows {
		total = r.Total
		if i >= room {
			break
		}
		taken++
		ref, ok := sanitizeURL(r.URL)
		if !ok { // counted as a failure, never stored: its address cannot be made safe to keep
			res.Counts["addressesNotKept"]++
			continue
		}
		res.Findings = append(res.Findings, Finding{
			SourceID: cov.SourceID, Ref: ref, Code: linkCode(r.Reason), Value: int64(r.HttpStatus), ObservedAt: at,
		})
	}
	cov.LinkFailed = int32(total)
	return total, taken, nil
}
