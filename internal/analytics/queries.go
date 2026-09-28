package analytics

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// totals fills the answer counts, rates, latency and moderation totals.
func (s *Service) totals(ctx context.Context, t *Totals, args []any) error {
	var lat []float64
	dest := []any{&t.Answers, &t.Up, &t.Down, &t.NoContextRate, &t.RefusalRate, &t.ErrorRate, &lat, &t.FirstTokenP50Ms}
	err := s.Pool.QueryRow(ctx, `SELECT count(*),
			count(*) FILTER (WHERE feedback = 'up'), count(*) FILTER (WHERE feedback = 'down'),
			avg(no_context::int)::float8, avg(refused::int)::float8,
			-- As in team analytics: Stop is neither an error nor a latency.
			avg((error_code NOT IN ('', 'aborted'))::int)::float8,
			percentile_cont(ARRAY[0.5, 0.95]) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE error_code <> 'aborted'),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY first_token_ms) FILTER (WHERE error_code <> 'aborted'),
			`+ModerationTotalsSQL+`
		FROM message_events WHERE `+liveEvents, args...).Scan(append(dest, t.Moderation.Dest()...)...)
	if err != nil {
		return err
	}
	if len(lat) == 2 {
		t.LatencyP50Ms, t.LatencyP95Ms = &lat[0], &lat[1]
	}
	if t.Up+t.Down > 0 {
		v := float64(t.Up) / float64(t.Up+t.Down)
		t.Satisfaction = &v
	}
	return nil
}

// uniqueUsers counts distinct pseudonymous IDs; a hashed DISTINCT is much
// faster than count(DISTINCT …), which sorts.
func (s *Service) uniqueUsers(ctx context.Context, t *Totals, args []any) error {
	return s.Pool.QueryRow(ctx, `SELECT count(*) FROM (SELECT DISTINCT pseudonymous_user FROM message_events
		WHERE `+liveEvents+` AND pseudonymous_user IS NOT NULL) u`, args...).Scan(&t.UniqueUsers)
}

// conversationsIn selects the conversations started in the range within the
// filter (liveEvents' arguments): of the team's agents, and with an answer
// to the audience.
const conversationsIn = `c.created_at >= $1 AND c.created_at < $2
	AND ($3::uuid IS NULL OR c.agent_id IN (SELECT id FROM agents WHERE team_id = $3))
	AND ($4::text = '' OR EXISTS (SELECT 1 FROM messages m JOIN message_events e ON e.message_id = m.id
		WHERE m.conversation_id = c.id AND e.audience_type = $4))`

// conversations counts the conversations started in the range.
func (s *Service) conversations(ctx context.Context, t *Totals, args []any) error {
	return s.Pool.QueryRow(ctx, `SELECT count(*) FROM conversations c WHERE `+conversationsIn, args...).Scan(&t.Conversations)
}

// shares fills the answers by audience and by channel from one scan.
func (s *Service) shares(ctx context.Context, out *Overview, args []any) error {
	type pair struct {
		audience, channel string
		n                 int64
	}
	rows, err := QueryInto(ctx, s.Pool, []pair{}, func(r pgx.Rows, p *pair) error {
		return r.Scan(&p.audience, &p.channel, &p.n)
	}, `SELECT audience_type, channel, count(*) FROM message_events WHERE `+liveEvents+` GROUP BY 1, 2`, args...)
	if err != nil {
		return err
	}
	byAudience, byChannel := map[string]int64{}, map[string]int64{}
	var total int64
	for _, p := range rows {
		byAudience[p.audience] += p.n
		byChannel[p.channel] += p.n
		total += p.n
	}
	out.Audiences, out.Channels = sharesOf(byAudience, total), sharesOf(byChannel, total)
	return nil
}

// moderation fills the blocked and flagged counts by stage and category.
func (s *Service) moderation(ctx context.Context, out *Overview, args []any) (err error) {
	out.Moderation, err = QueryInto(ctx, s.Pool, []ModerationCount{}, func(r pgx.Rows, c *ModerationCount) error {
		return r.Scan(&c.Stage, &c.Decision, &c.Category, &c.Count)
	}, ModerationCountsSQL(liveEvents), args...)
	return err
}

// models fills the tokens by model from the usage ledger: chat input and
// output, and embedding tokens of both retrieval and ingestion (of one team
// when team is set; the ledger has no audience). Events that retention
// deleted count through their daily roll-ups (usage_daily), by UTC day.
func (s *Service) models(ctx context.Context, out *Overview, from, end time.Time, team uuid.NullUUID) (err error) {
	out.Models, err = QueryInto(ctx, s.Pool, []ModelTokens{}, func(r pgx.Rows, m *ModelTokens) error {
		return r.Scan(&m.ModelID, &m.ModelName, &m.Kind, &m.ChatInput, &m.ChatOutput, &m.Embedding)
	}, `SELECT u.model_id, coalesce(m.display_name, ''), coalesce(m.kind, ''),
			coalesce(sum(u.quantity) FILTER (WHERE u.kind = 'chat_tokens_in'), 0)::bigint,
			coalesce(sum(u.quantity) FILTER (WHERE u.kind = 'chat_tokens_out'), 0)::bigint,
			coalesce(sum(u.quantity) FILTER (WHERE u.kind = 'embed_tokens'), 0)::bigint
		FROM (SELECT model_id, kind, quantity, team_id FROM usage_events WHERE occurred_at >= $1 AND occurred_at < $2
			UNION ALL
			SELECT model_id, kind, quantity, team_id FROM usage_daily
			WHERE day >= ($1::timestamptz AT TIME ZONE 'UTC')::date AND day < $2::timestamptz AT TIME ZONE 'UTC') u
		LEFT JOIN models m ON m.id = u.model_id
		WHERE u.model_id IS NOT NULL
			AND u.kind IN ('chat_tokens_in', 'chat_tokens_out', 'embed_tokens') AND ($3::uuid IS NULL OR u.team_id = $3)
		GROUP BY u.model_id, m.display_name, m.kind ORDER BY sum(u.quantity) DESC, 2`, from, end, team)
	return err
}

// topAgents fills the agents with the most answers, with names resolved now.
func (s *Service) topAgents(ctx context.Context, out *Overview, args []any) (err error) {
	out.TopAgents, err = QueryInto(ctx, s.Pool, []TopAgent{}, func(r pgx.Rows, a *TopAgent) error {
		return r.Scan(&a.AgentID, &a.TeamID, &a.AgentSlug, &a.AgentName, &a.TeamSlug, &a.TeamName, &a.Deleted,
			&a.Answers, &a.NoContextRate, &a.Satisfaction, &a.CitationSupportRate)
	}, `WITH top AS (
			SELECT agent_id, team_id, count(*) AS answers, avg(no_context::int)::float8 AS no_context,
				count(*) FILTER (WHERE feedback = 'up')::float8
					/ nullif(count(*) FILTER (WHERE feedback IS NOT NULL), 0) AS satisfaction,
				`+SupportRateSQL+` AS support
			FROM message_events WHERE `+liveEvents+`
			GROUP BY agent_id, team_id ORDER BY answers DESC, agent_id LIMIT $5)
		SELECT top.agent_id, top.team_id, coalesce(a.slug, ''), coalesce(a.name, ''), coalesce(t.slug, ''), coalesce(t.name, ''),
			a.id IS NULL OR a.deleted_at IS NOT NULL, top.answers, top.no_context, top.satisfaction, top.support
		FROM top LEFT JOIN agents a ON a.id = top.agent_id LEFT JOIN teams t ON t.id = top.team_id
		ORDER BY top.answers DESC, top.agent_id`, append(args[:len(args):len(args)], topN)...)
	return err
}

// topTeams fills the teams with the most answers.
func (s *Service) topTeams(ctx context.Context, out *Overview, args []any) (err error) {
	out.TopTeams, err = QueryInto(ctx, s.Pool, []TopTeam{}, func(r pgx.Rows, t *TopTeam) error {
		return r.Scan(&t.TeamID, &t.Slug, &t.Name, &t.Answers, &t.Agents)
	}, `WITH top AS (
			SELECT team_id, count(*) AS answers, count(DISTINCT agent_id) AS agents
			FROM message_events WHERE `+liveEvents+`
			GROUP BY team_id ORDER BY answers DESC, team_id LIMIT $5)
		SELECT top.team_id, coalesce(t.slug, ''), coalesce(t.name, ''), top.answers, top.agents
		FROM top LEFT JOIN teams t ON t.id = top.team_id ORDER BY top.answers DESC, top.team_id`, append(args[:len(args):len(args)], topN)...)
	return err
}

// daily returns one row per UTC day in [from, end), including empty days;
// args are liveEvents' arguments for the same range.
func (s *Service) daily(ctx context.Context, from, end time.Time, args []any) ([]Day, error) {
	events, err := QueryInto(ctx, s.Pool, []Day{}, func(r pgx.Rows, d *Day) error {
		return r.Scan(&d.Date, &d.Answers, &d.NoContext, &d.Refused, &d.Blocked, &d.Flagged)
	}, `SELECT date_trunc('day', created_at, 'UTC'), count(*), count(*) FILTER (WHERE no_context), count(*) FILTER (WHERE refused),
			count(*) FILTER (WHERE moderation_input->>'decision' = 'block' OR moderation_output->>'decision' = 'block'),
			count(*) FILTER (WHERE moderation_input->>'decision' = 'flag' OR moderation_output->>'decision' = 'flag')
		FROM message_events WHERE `+liveEvents+` GROUP BY 1`, args...)
	if err != nil {
		return nil, err
	}
	convs, err := QueryInto(ctx, s.Pool, []Day{}, func(r pgx.Rows, d *Day) error {
		return r.Scan(&d.Date, &d.Conversations)
	}, `SELECT date_trunc('day', c.created_at, 'UTC'), count(*) FROM conversations c
		WHERE `+conversationsIn+` GROUP BY 1`, args...)
	if err != nil {
		return nil, err
	}
	return fillDays(from, end, events, convs), nil
}

// fillDays merges the event and conversation rows into one row per day.
func fillDays(from, end time.Time, events, convs []Day) []Day {
	days := []Day{}
	index := map[time.Time]int{}
	for d := from; d.Before(end); d = d.AddDate(0, 0, 1) {
		index[d] = len(days)
		days = append(days, Day{Date: d})
	}
	for _, e := range events {
		if i, ok := index[e.Date.UTC()]; ok {
			d := &days[i]
			d.Answers, d.NoContext, d.Refused, d.Blocked, d.Flagged = e.Answers, e.NoContext, e.Refused, e.Blocked, e.Flagged
		}
	}
	for _, c := range convs {
		if i, ok := index[c.Date.UTC()]; ok {
			days[i].Conversations = c.Conversations
		}
	}
	return days
}

// sharesOf turns counts into shares, largest first.
func sharesOf(counts map[string]int64, total int64) []Share {
	out := make([]Share, 0, len(counts))
	for k, n := range counts {
		sh := Share{Key: k, Answers: n}
		if total > 0 {
			sh.Share = float64(n) / float64(total)
		}
		out = append(out, sh)
	}
	slices.SortFunc(out, func(a, b Share) int {
		if c := cmp.Compare(b.Answers, a.Answers); c != 0 {
			return c
		}
		return strings.Compare(a.Key, b.Key)
	})
	return out
}

// QueryInto runs a query and appends one scanned T per row to dst.
func QueryInto[T any](ctx context.Context, pool *pgxpool.Pool, dst []T, scan func(pgx.Rows, *T) error, sql string, args ...any) ([]T, error) {
	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return dst, err
	}
	defer rows.Close()
	for rows.Next() {
		var v T
		if err := scan(rows, &v); err != nil {
			return dst, err
		}
		dst = append(dst, v)
	}
	return dst, rows.Err()
}
