package analytics

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CitationTotals are the SystemOne citation-check counts of a range
// (docs/systemone.md §3), from the content-free message_events.citations
// records. Answers, check times and the pair counts are of answers with
// claim–source pairs; the claim counts are of every checked answer's claims
// (factual sentences), the units of the chat's summary. Everything is zero
// when nothing was checked.
type CitationTotals struct {
	Answers, Pairs, Verified, Unsupported, Contradicted, Unchecked, LowConfidence, Removed, Refused int64
	// SupportRate is verified / checked pairs; nil without checked pairs.
	SupportRate *float64
	// LatencyP50Ms and LatencyP95Ms are the check's time per answer.
	LatencyP50Ms, LatencyP95Ms *float64
	// SupportedClaims, NotSupportedClaims and UncitedClaims count the
	// answers' claims by verdict (records from v0.2.1 on; older ones have
	// none). ClaimSupportRate is supported / all three; nil without claims.
	SupportedClaims, NotSupportedClaims, UncitedClaims int64
	ClaimSupportRate                                   *float64
}

// SupportRateSQL is the citation support rate of the grouped rows.
const SupportRateSQL = `sum((citations->>'verified')::bigint)::float8 / nullif(sum((citations->>'checked')::bigint), 0)`

// withPairs keeps the records of answers that had claim–source pairs.
const withPairs = ` FILTER (WHERE (citations->>'pairs')::bigint > 0)`

// claimSum sums one of the per-claim counts (absent before v0.2.1).
func claimSum(field string) string {
	return `coalesce(sum(coalesce((citations->>'` + field + `')::bigint, 0)), 0)`
}

// QueryCitations sums the citation records of the message_events rows
// matching where (with its arguments). The pair counts, answers and check
// times leave out records without claim–source pairs (an answer that cited
// nothing, recorded only for its uncited sentences); the claim counts don't,
// as the chat's summary counts such an answer's uncited claims too.
func QueryCitations(ctx context.Context, pool *pgxpool.Pool, where string, args ...any) (CitationTotals, error) {
	var t CitationTotals
	var lat []float64
	pairs := func(field string) string {
		return `coalesce(sum((citations->>'` + field + `')::bigint)` + withPairs + `, 0)`
	}
	err := pool.QueryRow(ctx, `SELECT count(*)`+withPairs+`,
			`+pairs("pairs")+`, `+pairs("verified")+`, `+pairs("unsupported")+`, `+pairs("contradicted")+`,
			`+pairs("unchecked")+`, `+pairs("lowConfidence")+`, `+pairs("removed")+`,
			count(*) FILTER (WHERE (citations->>'pairs')::bigint > 0 AND (citations->>'refused')::boolean),
			sum((citations->>'verified')::bigint)`+withPairs+`::float8 / nullif(sum((citations->>'checked')::bigint)`+withPairs+`, 0),
			percentile_cont(ARRAY[0.5, 0.95]) WITHIN GROUP (ORDER BY (citations->>'latencyMs')::bigint)`+withPairs+`,
			`+claimSum("supportedClaims")+`, `+claimSum("notSupportedClaims")+`, `+claimSum("uncitedClaims")+`
		FROM message_events WHERE citations IS NOT NULL AND `+where, args...).Scan(
		&t.Answers, &t.Pairs, &t.Verified, &t.Unsupported, &t.Contradicted, &t.Unchecked, &t.LowConfidence,
		&t.Removed, &t.Refused, &t.SupportRate, &lat, &t.SupportedClaims, &t.NotSupportedClaims, &t.UncitedClaims)
	if len(lat) == 2 {
		t.LatencyP50Ms, t.LatencyP95Ms = &lat[0], &lat[1]
	}
	if all := t.SupportedClaims + t.NotSupportedClaims + t.UncitedClaims; all > 0 {
		rate := float64(t.SupportedClaims) / float64(all)
		t.ClaimSupportRate = &rate
	}
	return t, err
}

// ScopeTotals are the SystemOne scope-check counts of a range
// (docs/systemone.md §4), from message_events.scope.
type ScopeTotals struct {
	Checked, SmallTalk, OutOfScope, Refused, Skipped int64
	LatencyP50Ms                                     *float64
}

// QueryScope sums the scope records of the message_events rows matching
// where (with its arguments).
func QueryScope(ctx context.Context, pool *pgxpool.Pool, where string, args ...any) (ScopeTotals, error) {
	var t ScopeTotals
	err := pool.QueryRow(ctx, `SELECT count(*),
			count(*) FILTER (WHERE scope->>'decision' = 'small_talk'),
			count(*) FILTER (WHERE scope->>'decision' = 'out_of_scope'),
			count(*) FILTER (WHERE scope->>'action' = 'refused'),
			count(*) FILTER (WHERE scope->>'decision' = 'skipped'),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY (scope->>'latencyMs')::bigint)
		FROM message_events WHERE scope IS NOT NULL AND `+where, args...).Scan(
		&t.Checked, &t.SmallTalk, &t.OutOfScope, &t.Refused, &t.Skipped, &t.LatencyP50Ms)
	return t, err
}
