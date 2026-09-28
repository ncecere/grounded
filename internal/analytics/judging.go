package analytics

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// JudgingTotals are the SystemOne passage-judging counts of a range
// (docs/systemone.md §2), from the content-free message_events.judging
// records. Everything is zero when nothing was judged.
type JudgingTotals struct {
	Answers, Candidates, Evidence, Conflicting, Kept, Skipped, Requests int64
	DroppedInjection, DroppedIrrelevant, DroppedNotUsable               int64
	// JudgedOut counts strict refusals without a chat-model call.
	JudgedOut int64
	// LatencyP50Ms and LatencyP95Ms are the latency judging added to an
	// answer; nil without judged answers.
	LatencyP50Ms, LatencyP95Ms *float64
}

// QueryJudging sums the judging records of the message_events rows
// matching where (with its arguments).
func QueryJudging(ctx context.Context, pool *pgxpool.Pool, where string, args ...any) (JudgingTotals, error) {
	var t JudgingTotals
	var lat []float64
	err := pool.QueryRow(ctx, `SELECT count(*),
			coalesce(sum((judging->>'candidates')::bigint), 0), coalesce(sum((judging->>'evidence')::bigint), 0),
			coalesce(sum((judging->>'conflicting')::bigint), 0), coalesce(sum((judging->>'kept')::bigint), 0),
			coalesce(sum((judging->>'skipped')::bigint), 0), coalesce(sum((judging->>'requests')::bigint), 0),
			coalesce(sum((judging->'dropped'->>'injection')::bigint), 0),
			coalesce(sum((judging->'dropped'->>'irrelevant')::bigint), 0),
			coalesce(sum((judging->'dropped'->>'not_usable')::bigint), 0),
			count(*) FILTER (WHERE judging->>'noContextReason' = 'judged_out'),
			percentile_cont(ARRAY[0.5, 0.95]) WITHIN GROUP (ORDER BY (judging->>'latencyMs')::bigint)
		FROM message_events WHERE judging IS NOT NULL AND `+where, args...).Scan(
		&t.Answers, &t.Candidates, &t.Evidence, &t.Conflicting, &t.Kept, &t.Skipped, &t.Requests,
		&t.DroppedInjection, &t.DroppedIrrelevant, &t.DroppedNotUsable, &t.JudgedOut, &lat)
	if len(lat) == 2 {
		t.LatencyP50Ms, t.LatencyP95Ms = &lat[0], &lat[1]
	}
	return t, err
}
