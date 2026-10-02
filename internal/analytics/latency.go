package analytics

import (
	"context"
	"sync"
	"time"
)

// CheckLatencyDays is the window of CheckLatency: the last 14 UTC days, the
// window the admin SystemOne page shows.
const CheckLatencyDays = 14

// checkLatencyTTL is how long a process reuses CheckLatency's medians: they
// barely move in minutes, and every editor's status request reads them.
const checkLatencyTTL = 5 * time.Minute

// CheckLatency is the platform's median time each SystemOne check added to
// an answer (docs/v0.4.1.md §4: the agent editor's "Adds about 0.4 s"), the
// same numbers as the platform analytics' judging, citation and scope
// totals; nil without checked answers. It holds no team data.
type CheckLatency struct {
	JudgingMs, CitationsMs, ScopeMs *float64
}

// latencyCache keeps the last CheckLatency.
type latencyCache struct {
	mu  sync.Mutex
	at  time.Time
	val CheckLatency
}

// CheckLatency returns the medians over the last CheckLatencyDays UTC days,
// computed at most every few minutes per process (one scan of the window).
func (s *Service) CheckLatency(ctx context.Context) (CheckLatency, error) {
	c := &s.latency
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.at.IsZero() && time.Since(c.at) < checkLatencyTTL {
		return c.val, nil
	}
	from, to, err := Range(time.Now().AddDate(0, 0, -(CheckLatencyDays-1)), time.Time{})
	if err != nil {
		return CheckLatency{}, err
	}
	var out CheckLatency
	// The filters match QueryJudging, QueryCitations (answers with pairs) and
	// QueryScope.
	err = s.Pool.QueryRow(ctx, `SELECT
			percentile_cont(0.5) WITHIN GROUP (ORDER BY (judging->>'latencyMs')::bigint) FILTER (WHERE judging IS NOT NULL),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY (citations->>'latencyMs')::bigint)
				FILTER (WHERE citations IS NOT NULL AND (citations->>'pairs')::bigint > 0),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY (scope->>'latencyMs')::bigint) FILTER (WHERE scope IS NOT NULL)
		FROM message_events WHERE (judging IS NOT NULL OR citations IS NOT NULL OR scope IS NOT NULL) AND `+liveEvents,
		Filter{}.args(from, to.AddDate(0, 0, 1))...).Scan(&out.JudgingMs, &out.CitationsMs, &out.ScopeMs)
	if err != nil {
		return CheckLatency{}, err
	}
	c.at, c.val = time.Now(), out
	return out, nil
}
