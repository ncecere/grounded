package analytics

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
)

// The moderation drill-down (docs/ui-review F-02): the individual
// moderation decisions behind the counts by category, so admins can see
// which category flagged or blocked which agent's traffic, and whether an
// uncalibrated provider's block was lowered to a flag. It reads only the
// content-free decision records in message_events (ADR-0010): no message
// text and no user identity.

// ModerationEvent is one moderated stage of one answer.
type ModerationEvent struct {
	ID          int64
	At          time.Time
	AgentID     uuid.UUID
	AgentName   string
	AgentSlug   string
	TeamSlug    string
	Deleted     bool
	Channel     string
	Audience    string
	Stage       string
	Decision    string
	TopCategory string
	Score       float64
	Categories  []string
	Downgraded  []string
	Provider    string
	Calibrated  bool
	LatencyMs   int64
}

// ModerationEventFilter narrows the drill-down. Decision "" means every
// decision except pass.
type ModerationEventFilter struct {
	From, To time.Time // UTC days, inclusive (Range)
	Decision string
	Category string
	AgentID  *uuid.UUID
	// The cursor: rows strictly before (BeforeID, BeforeStage) in the
	// order id desc, stage desc.
	BeforeID    *int64
	BeforeStage string
	Limit       int32
}

var eventDecisions = map[string]bool{"": true, "block": true, "flag": true, "support": true, "error": true}

// ModerationEvents lists moderation decisions, newest first (platform
// admins and auditors). The second result is true when more follow.
func (s *Service) ModerationEvents(ctx context.Context, a authz.Actor, f ModerationEventFilter) ([]ModerationEvent, bool, error) {
	if err := authorize(a); err != nil {
		return nil, false, err
	}
	if !eventDecisions[f.Decision] {
		return nil, false, apperr.Invalid("invalid_decision", "decision must be block, flag, support or error")
	}
	from, to, err := Range(f.From, f.To)
	if err != nil {
		return nil, false, err
	}
	var agent any
	if f.AgentID != nil {
		agent = *f.AgentID
	}
	var before any
	if f.BeforeID != nil {
		before = *f.BeforeID
	}
	rows, err := QueryInto(ctx, s.Pool, []ModerationEvent{}, scanModerationEvent, moderationEventsSQL,
		from, to.AddDate(0, 0, 1), f.Decision, f.Category, agent, before, f.BeforeStage, f.Limit+1)
	if err != nil {
		return nil, false, err
	}
	more := len(rows) > int(f.Limit)
	if more {
		rows = rows[:f.Limit]
	}
	return rows, more, nil
}

// One row per moderated stage with a decision other than pass, ordered by
// message_events id and stage (both stages of an answer share the id).
const moderationEventsSQL = `
	SELECT e.id, e.created_at, e.agent_id, coalesce(a.name, ''), coalesce(a.slug, ''), coalesce(t.slug, ''),
		a.id IS NULL OR a.deleted_at IS NOT NULL, e.channel, e.audience_type, m.stage, m.rec
	FROM message_events e
	CROSS JOIN LATERAL (VALUES ('input', e.moderation_input), ('output', e.moderation_output)) AS m(stage, rec)
	LEFT JOIN agents a ON a.id = e.agent_id
	LEFT JOIN teams t ON t.id = e.team_id
	WHERE e.created_at >= $1 AND e.created_at < $2 AND e.channel <> 'test' AND m.rec IS NOT NULL
		AND m.rec->>'decision' <> 'pass'
		AND ($3 = '' OR m.rec->>'decision' = $3)
		AND ($4 = '' OR m.rec->>'topCategory' = $4 OR m.rec->'categories' ? $4)
		AND ($5::uuid IS NULL OR e.agent_id = $5::uuid)
		AND ($6::bigint IS NULL OR (e.id, m.stage) < ($6::bigint, $7::text))
	ORDER BY e.id DESC, m.stage DESC
	LIMIT $8`

func scanModerationEvent(r pgx.Rows, e *ModerationEvent) error {
	var rec json.RawMessage
	if err := r.Scan(&e.ID, &e.At, &e.AgentID, &e.AgentName, &e.AgentSlug, &e.TeamSlug, &e.Deleted,
		&e.Channel, &e.Audience, &e.Stage, &rec); err != nil {
		return err
	}
	var d struct {
		Decision    string   `json:"decision"`
		TopCategory string   `json:"topCategory"`
		Score       float64  `json:"score"`
		Categories  []string `json:"categories"`
		Downgraded  []string `json:"downgraded"`
		Provider    string   `json:"provider"`
		Calibrated  bool     `json:"calibrated"`
		LatencyMs   int64    `json:"latencyMs"`
	}
	if err := json.Unmarshal(rec, &d); err != nil {
		return err
	}
	e.Decision, e.TopCategory, e.Score, e.Provider, e.Calibrated, e.LatencyMs =
		d.Decision, d.TopCategory, d.Score, d.Provider, d.Calibrated, d.LatencyMs
	e.Categories, e.Downgraded = nonNil(d.Categories), nonNil(d.Downgraded)
	return nil
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
