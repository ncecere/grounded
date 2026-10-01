package agents

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/analytics"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Analytics are an agent's aggregates for a date range (docs/phase3-agents.md
// §8). They never contain message content or user identities. Draft test
// chats (channel test) are excluded except from ByChannel.
type Analytics struct {
	From, To time.Time // UTC days, inclusive
	Totals   AnalyticsTotals
	Daily    []DailyCount
	Models   []ModelTokens
	TopDocs  []CitedDocument
	Reasons  []ReasonCount
	Channels []ChannelCount
	// Audiences counts answers by the audience they were given under
	// (phase 4 spec, section 9); test chats excluded.
	Audiences []AudienceCount
	// Moderation counts blocked and flagged questions and answers by
	// category (phase 4 spec, section 9).
	Moderation []ModerationCount
}

// ModerationCount counts moderation decisions of one stage, outcome and
// top category.
type ModerationCount = analytics.ModerationCount

// AudienceCount counts answers given under one audience.
type AudienceCount struct {
	Audience string
	Answers  int64
}

// AnalyticsTotals summarises the range.
type AnalyticsTotals struct {
	Conversations   int64
	Answers         int64
	UniqueUsers     int64
	Up, Down        int64
	Satisfaction    *float64 // up / (up + down); nil without feedback
	NoContextRate   *float64
	RefusalRate     *float64
	ErrorRate       *float64
	LatencyP50Ms    *float64
	LatencyP95Ms    *float64
	FirstTokenP50Ms *float64
	Moderation      analytics.ModerationTotals
	Judging         analytics.JudgingTotals
	Citations       analytics.CitationTotals
	Scope           analytics.ScopeTotals
	Cache           CacheTotals
}

// CacheTotals are the answers served from the answer cache
// (docs/answer-cache.md): their share of answers and the model tokens
// their originals spent.
type CacheTotals struct {
	Hits        int64
	HitRate     *float64
	TokensSaved int64
}

// DailyCount is one UTC day.
type DailyCount struct {
	Date          time.Time
	Conversations int64
	Answers       int64
}

// ModelTokens is token use by one model.
type ModelTokens struct {
	ModelID                                 uuid.UUID
	ModelName                               string
	Answers, Input, Output, ReasoningTokens int64
}

// CitedDocument is a frequently cited document; the title is resolved now.
type CitedDocument struct {
	DocumentID uuid.UUID
	Title      string // "" when the document was deleted
	Citations  int64
}

// ReasonCount counts a thumbs-down reason.
type ReasonCount struct {
	Reason string
	Count  int64
}

// ChannelCount counts answers by channel (including test).
type ChannelCount struct {
	Channel string
	Answers int64
}

// Analytics returns an agent's aggregates (team editors, admins and owners).
// from and to are UTC dates (inclusive); zero values default to the last 30
// days.
func (s *Service) Analytics(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, from, to time.Time) (Analytics, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, "")
	if err != nil {
		return Analytics{}, err
	}
	if a.Key != nil || !authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
		return Analytics{}, apperr.Forbidden("Only team editors, admins and owners can see agent analytics")
	}
	if _, err := s.loadAgent(ctx, s.q, acc.Team.ID, id, false); err != nil {
		return Analytics{}, err
	}
	from, to, err = analytics.Range(from, to)
	if err != nil {
		return Analytics{}, err
	}
	end := to.AddDate(0, 0, 1)
	out := Analytics{From: from, To: to, Daily: []DailyCount{}, Models: []ModelTokens{}, TopDocs: []CitedDocument{},
		Reasons: []ReasonCount{}, Channels: []ChannelCount{}, Audiences: []AudienceCount{}, Moderation: []ModerationCount{}}
	if err := s.analyticsTotals(ctx, &out.Totals, id, from, end); err != nil {
		return out, err
	}
	if err := s.analyticsLists(ctx, &out, id, from, end); err != nil {
		return out, err
	}
	out.Moderation, err = analytics.QueryInto(ctx, s.Pool, out.Moderation, func(r pgx.Rows, c *ModerationCount) error {
		return r.Scan(&c.Stage, &c.Decision, &c.Category, &c.Count)
	}, analytics.ModerationCountsSQL(liveEvents), id, from, end)
	return out, err
}

// Analytics covers answers outside draft test chats.
const (
	liveEvents  = "agent_id = $1 AND created_at >= $2 AND created_at < $3 AND channel <> 'test'"
	liveEventsE = "e.agent_id = $1 AND e.created_at >= $2 AND e.created_at < $3 AND e.channel <> 'test'"
)

// analyticsTotals fills the totals over [from, end).
func (s *Service) analyticsTotals(ctx context.Context, t *AnalyticsTotals, id uuid.UUID, from, end time.Time) error {
	err := s.Pool.QueryRow(ctx, `SELECT count(*), count(DISTINCT pseudonymous_user),
			count(*) FILTER (WHERE feedback = 'up'), count(*) FILTER (WHERE feedback = 'down'),
			avg(no_context::int)::float8, avg(refused::int)::float8,
			-- A user pressing Stop is not an error, and a stopped answer's
			-- latency says nothing about the model: leave both out.
			avg((error_code NOT IN ('', 'aborted'))::int)::float8,
			percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE error_code <> 'aborted'),
			percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE error_code <> 'aborted'),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY first_token_ms) FILTER (WHERE error_code <> 'aborted'),
			`+analytics.ModerationTotalsSQL+`
		FROM message_events WHERE `+liveEvents, id, from, end).Scan(append([]any{
		&t.Answers, &t.UniqueUsers, &t.Up, &t.Down, &t.NoContextRate, &t.RefusalRate, &t.ErrorRate,
		&t.LatencyP50Ms, &t.LatencyP95Ms, &t.FirstTokenP50Ms}, t.Moderation.Dest()...)...)
	if err != nil {
		return err
	}
	if t.Judging, err = analytics.QueryJudging(ctx, s.Pool, liveEvents, id, from, end); err != nil {
		return err
	}
	if t.Citations, err = analytics.QueryCitations(ctx, s.Pool, liveEvents, id, from, end); err != nil {
		return err
	}
	if t.Scope, err = analytics.QueryScope(ctx, s.Pool, liveEvents, id, from, end); err != nil {
		return err
	}
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE cached), avg(cached::int)::float8, coalesce(sum(tokens_saved), 0)
		FROM message_events WHERE `+liveEvents, id, from, end).Scan(&t.Cache.Hits, &t.Cache.HitRate, &t.Cache.TokensSaved); err != nil {
		return err
	}
	if t.Up+t.Down > 0 {
		v := float64(t.Up) / float64(t.Up+t.Down)
		t.Satisfaction = &v
	}
	return s.Pool.QueryRow(ctx, `SELECT count(*) FROM conversations WHERE agent_id = $1 AND created_at >= $2 AND created_at < $3`,
		id, from, end).Scan(&t.Conversations)
}

// analyticsLists fills the daily counts, models, top cited documents,
// feedback reasons, channels and audiences over [from, end).
func (s *Service) analyticsLists(ctx context.Context, out *Analytics, id uuid.UUID, from, end time.Time) error {
	var err error
	if out.Daily, err = analytics.QueryInto(ctx, s.Pool, out.Daily, func(r pgx.Rows, d *DailyCount) error {
		err := r.Scan(&d.Date, &d.Conversations, &d.Answers)
		d.Date = d.Date.UTC()
		return err
	}, `
		WITH days AS (SELECT generate_series($2::timestamptz, $3::timestamptz - interval '1 day', interval '1 day') AS d)
		SELECT days.d,
			(SELECT count(*) FROM conversations c WHERE c.agent_id = $1 AND c.created_at >= days.d AND c.created_at < days.d + interval '1 day'),
			(SELECT count(*) FROM message_events e WHERE e.agent_id = $1 AND e.channel <> 'test'
				AND e.created_at >= days.d AND e.created_at < days.d + interval '1 day')
		FROM days ORDER BY days.d`, id, from, end); err != nil {
		return err
	}
	if out.Models, err = analytics.QueryInto(ctx, s.Pool, out.Models, func(r pgx.Rows, m *ModelTokens) error {
		return r.Scan(&m.ModelID, &m.ModelName, &m.Answers, &m.Input, &m.Output, &m.ReasoningTokens)
	}, `SELECT e.model_id, coalesce(m.display_name, ''), count(*), sum(e.input_tokens), sum(e.output_tokens), sum(e.reasoning_tokens)
		FROM message_events e LEFT JOIN models m ON m.id = e.model_id
		WHERE e.model_id IS NOT NULL AND `+liveEventsE+`
		GROUP BY e.model_id, m.display_name ORDER BY sum(e.input_tokens) + sum(e.output_tokens) DESC`, id, from, end); err != nil {
		return err
	}
	if out.TopDocs, err = analytics.QueryInto(ctx, s.Pool, out.TopDocs, func(r pgx.Rows, c *CitedDocument) error {
		return r.Scan(&c.DocumentID, &c.Citations)
	}, `SELECT doc, count(*) FROM message_events, unnest(cited_document_ids) AS doc
		WHERE `+liveEvents+` GROUP BY doc ORDER BY count(*) DESC, doc LIMIT 10`, id, from, end); err != nil {
		return err
	}
	if err := s.titleDocuments(ctx, out.TopDocs); err != nil {
		return err
	}
	if out.Reasons, err = analytics.QueryInto(ctx, s.Pool, out.Reasons, func(r pgx.Rows, c *ReasonCount) error {
		return r.Scan(&c.Reason, &c.Count)
	}, `SELECT feedback_reason, count(*) FROM message_events
		WHERE feedback = 'down' AND feedback_reason IS NOT NULL AND `+liveEvents+` GROUP BY feedback_reason ORDER BY count(*) DESC`, id, from, end); err != nil {
		return err
	}
	if out.Channels, err = analytics.QueryInto(ctx, s.Pool, out.Channels, func(r pgx.Rows, c *ChannelCount) error {
		return r.Scan(&c.Channel, &c.Answers)
	}, `SELECT channel, count(*) FROM message_events
		WHERE agent_id = $1 AND created_at >= $2 AND created_at < $3 GROUP BY channel ORDER BY count(*) DESC, channel`, id, from, end); err != nil {
		return err
	}
	out.Audiences, err = analytics.QueryInto(ctx, s.Pool, out.Audiences, func(r pgx.Rows, c *AudienceCount) error {
		return r.Scan(&c.Audience, &c.Answers)
	}, `SELECT audience_type, count(*) FROM message_events WHERE `+liveEvents+` GROUP BY 1 ORDER BY count(*) DESC, 1`, id, from, end)
	return err
}

// titleDocuments adds the documents' titles.
func (s *Service) titleDocuments(ctx context.Context, docs []CitedDocument) error {
	if len(docs) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, len(docs))
	for i, d := range docs {
		ids[i] = d.DocumentID
	}
	titles, err := s.q.DocumentTitles(ctx, ids)
	if err != nil {
		return err
	}
	byID := map[uuid.UUID]string{}
	for _, t := range titles {
		byID[t.ID] = t.Title
	}
	for i := range docs {
		docs[i].Title = byID[docs[i].DocumentID]
	}
	return nil
}

// AccessLogFilter narrows the access log.
type AccessLogFilter struct {
	From, To *time.Time
	AgentID  *uuid.UUID
	UserID   *uuid.UUID
	// Channel is ui, api, openai, test, public, widget or mcp ("" for all).
	Channel string
	// Before is the cursor: entries strictly older than (At, ID).
	BeforeAt *time.Time
	BeforeID *int64
	Limit    int32
}

// AccessLogEntry is one use of a Sensitive or Restricted agent.
type AccessLogEntry = dbgen.ListAccessLogRow

// AccessLog lists the access log, newest first (platform admins and
// auditors). The second result is true when more entries follow.
func (s *Service) AccessLog(ctx context.Context, a authz.Actor, f AccessLogFilter) ([]AccessLogEntry, bool, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return nil, false, apperr.Forbidden("Only platform admins and auditors can read the access log")
	}
	p := dbgen.ListAccessLogParams{FromAt: f.From, ToAt: f.To, BeforeAt: f.BeforeAt, BeforeID: f.BeforeID, PageSize: f.Limit + 1}
	if f.AgentID != nil {
		p.AgentID = uuid.NullUUID{UUID: *f.AgentID, Valid: true}
	}
	if f.UserID != nil {
		p.UserID = uuid.NullUUID{UUID: *f.UserID, Valid: true}
	}
	if f.Channel != "" {
		p.Channel = &f.Channel
	}
	rows, err := s.q.ListAccessLog(ctx, p)
	if err != nil {
		return nil, false, err
	}
	more := len(rows) > int(f.Limit)
	if more {
		rows = rows[:f.Limit]
	}
	return rows, more, nil
}
