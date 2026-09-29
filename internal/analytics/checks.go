package analytics

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CitationTotals are the SystemOne citation-check counts of a range
// (docs/systemone.md §3), from the content-free message_events.citations
// records. Counts are claim–source pairs; everything is zero when nothing
// was checked.
type CitationTotals struct {
	Answers, Pairs, Verified, Unsupported, Contradicted, Unchecked, LowConfidence, Removed, Refused int64
	// SupportRate is verified / checked pairs; nil without checked pairs.
	SupportRate *float64
	// LatencyP50Ms and LatencyP95Ms are the check's time per answer.
	LatencyP50Ms, LatencyP95Ms *float64
}

// SupportRateSQL is the citation support rate of the grouped rows.
const SupportRateSQL = `sum((citations->>'verified')::bigint)::float8 / nullif(sum((citations->>'checked')::bigint), 0)`

// QueryCitations sums the citation records of the message_events rows
// matching where (with its arguments). Records without claim–source pairs
// (an answer that cited nothing, recorded only for its uncited sentences)
// are left out, so answers and check times are of answers that were checked.
func QueryCitations(ctx context.Context, pool *pgxpool.Pool, where string, args ...any) (CitationTotals, error) {
	var t CitationTotals
	var lat []float64
	err := pool.QueryRow(ctx, `SELECT count(*),
			coalesce(sum((citations->>'pairs')::bigint), 0), coalesce(sum((citations->>'verified')::bigint), 0),
			coalesce(sum((citations->>'unsupported')::bigint), 0), coalesce(sum((citations->>'contradicted')::bigint), 0),
			coalesce(sum((citations->>'unchecked')::bigint), 0), coalesce(sum((citations->>'lowConfidence')::bigint), 0),
			coalesce(sum((citations->>'removed')::bigint), 0),
			count(*) FILTER (WHERE (citations->>'refused')::boolean),
			`+SupportRateSQL+`,
			percentile_cont(ARRAY[0.5, 0.95]) WITHIN GROUP (ORDER BY (citations->>'latencyMs')::bigint)
		FROM message_events WHERE citations IS NOT NULL AND (citations->>'pairs')::bigint > 0 AND `+where, args...).Scan(
		&t.Answers, &t.Pairs, &t.Verified, &t.Unsupported, &t.Contradicted, &t.Unchecked, &t.LowConfidence,
		&t.Removed, &t.Refused, &t.SupportRate, &lat)
	if len(lat) == 2 {
		t.LatencyP50Ms, t.LatencyP95Ms = &lat[0], &lat[1]
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
