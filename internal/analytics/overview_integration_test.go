package analytics_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/analytics"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/testutil"
)

// seedYearSQL inserts $1 synthetic answers spread over the last year across
// 12 teams and 60 agents, a third of them with conversations, and four
// ledger rows per answer: a platform a year into Phase 4.
const seedYearSQL = `
WITH t AS (
	INSERT INTO teams (slug, name, max_classification)
	SELECT 'perf-' || g, 'Perf ' || g, 'open' FROM generate_series(1, 12) g RETURNING id
), a AS (
	INSERT INTO agents (team_id, slug, name) SELECT t.id, 'agent-' || g, 'Agent ' || g FROM t, generate_series(1, 5) g
	RETURNING id, team_id
)
SELECT count(*) FROM a`

const seedEventsSQL = `
CREATE TEMP TABLE perf_agents AS SELECT row_number() OVER (ORDER BY id) - 1 AS n, id, team_id FROM agents;
CREATE TEMP TABLE perf_events AS
	SELECT g, now() - random() * interval '365 days' AS at, floor(power(random(), 2) * 60)::int AS agent_n,
		random() AS r1, random() AS r2, random() AS r3
	FROM generate_series(1, 200000) g;
INSERT INTO message_events (team_id, agent_id, created_at, channel, audience_type, latency_ms, first_token_ms,
	no_context, refused, pseudonymous_user, feedback, moderation_input, moderation_output)
SELECT a.team_id, a.id, e.at,
	(ARRAY['ui', 'ui', 'ui', 'api', 'openai', 'public', 'widget', 'test'])[1 + floor(e.r1 * 8)::int],
	(ARRAY['team', 'all_authenticated', 'public'])[1 + floor(e.r2 * 3)::int],
	(500 + e.r2 * 5000)::int, (100 + e.r3 * 900)::int, e.r3 < 0.1, e.r2 < 0.05,
	md5(a.team_id::text || floor(e.r3 * 400)::int), CASE WHEN e.r3 > 0.9 THEN 'up' WHEN e.r3 < 0.03 THEN 'down' END,
	CASE WHEN e.r1 > 0.6 THEN jsonb_build_object('decision', CASE WHEN e.r2 < 0.03 THEN 'block' WHEN e.r2 < 0.06 THEN 'flag' ELSE 'pass' END,
		'topCategory', 'violence', 'score', e.r2) END,
	CASE WHEN e.r1 > 0.6 THEN jsonb_build_object('decision', 'pass', 'score', 0) END
FROM perf_events e JOIN perf_agents a ON a.n = e.agent_n;
INSERT INTO conversations (agent_id, user_id, created_at, updated_at)
SELECT a.id, $1, e.at, e.at FROM perf_events e JOIN perf_agents a ON a.n = e.agent_n WHERE e.g % 3 = 0;
INSERT INTO usage_events (occurred_at, kind, quantity, team_id, agent_id)
SELECT e.at, k, 100, a.team_id, a.id FROM perf_events e JOIN perf_agents a ON a.n = e.agent_n,
	unnest(ARRAY['query', 'chat_tokens_in', 'chat_tokens_out', 'embed_tokens']) k;
ANALYZE message_events; ANALYZE conversations; ANALYZE usage_events;`

// TestOverviewPerformance is a coarse guard on a year of events: the
// overview for the whole year stays far below a second (it measures about
// 100 ms on a laptop; the bound leaves room for slow CI machines).
func TestOverviewPerformance(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	var n int
	if err := pool.QueryRow(ctx, seedYearSQL).Scan(&n); err != nil || n != 60 {
		t.Fatalf("seed agents: %d %v", n, err)
	}
	var user uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO users (oidc_issuer, oidc_subject, email) VALUES ('perf', 'perf', 'perf@example.edu') RETURNING id`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Multiple statements need the simple protocol, so the user ID is inlined.
	if _, err := conn.Conn().PgConn().Exec(ctx, strings.ReplaceAll(seedEventsSQL, "$1", "'"+user.String()+"'")).ReadAll(); err != nil {
		t.Fatal(err)
	}
	conn.Release()

	svc := analytics.New(pool)
	admin := authz.Actor{UserID: uuid.New(), PlatformRole: authz.PlatformAuditor}
	to := time.Now().UTC()
	from := to.AddDate(-1, 0, 1)
	if _, err := svc.Overview(ctx, admin, from, to, analytics.Filter{}); err != nil { // warm the cache
		t.Fatal(err)
	}
	best := time.Hour
	for range 3 {
		start := time.Now()
		ov, err := svc.Overview(ctx, admin, from, to, analytics.Filter{})
		if err != nil {
			t.Fatal(err)
		}
		best = min(best, time.Since(start))
		if ov.Totals.Answers < 150000 || len(ov.Daily) != 365 || len(ov.TopAgents) != 10 {
			t.Fatalf("overview = %d answers, %d days, %d agents", ov.Totals.Answers, len(ov.Daily), len(ov.TopAgents))
		}
	}
	// The budget is for production builds: well under a second on a
	// developer machine. The race detector (CI runs go test -race on shared
	// runners) slows it several times over, so the check there only catches
	// a regression of the query plan, not small changes in speed.
	budget := 1500 * time.Millisecond
	if raceEnabled {
		budget = 8 * time.Second
	}
	t.Logf("overview of a year (200k events): %v (budget %v, race detector %v)", best, budget, raceEnabled)
	if best > budget {
		t.Errorf("overview took %v, over the %v budget", best, budget)
	}
}
