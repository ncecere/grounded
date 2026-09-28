// Package analytics computes the platform analytics overview
// (docs/phase4-publishing.md §9) and the pieces it shares with team
// analytics: date ranges and moderation counts.
//
// Everything here is an aggregate over message_events, conversations and the
// usage ledger. Nothing reads message content, and no result carries a user
// identity (ADR-0010): unique users are distinct pseudonymous IDs, which are
// counted and never returned.
package analytics

import (
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
)

// Service reads platform analytics.
type Service struct {
	Pool *pgxpool.Pool
}

// New returns a Service.
func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

// MaxDays bounds a range.
const MaxDays = 366

// Range applies the defaults to a date range of UTC days (inclusive) and
// checks it: a zero to is today, a zero from is 29 days before to, and the
// range may cover at most MaxDays days.
func Range(from, to time.Time) (time.Time, time.Time, error) {
	day := func(t time.Time) time.Time {
		y, m, d := t.UTC().Date()
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}
	if to.IsZero() {
		to = time.Now()
	}
	to = day(to)
	if from.IsZero() {
		from = to.AddDate(0, 0, -29)
	}
	from = day(from)
	if from.After(to) {
		return from, to, apperr.Invalid("invalid_range", "from must not be after to")
	}
	if to.Sub(from) > MaxDays*24*time.Hour {
		return from, to, apperr.Invalid("invalid_range", "The range can be at most 366 days")
	}
	return from, to, nil
}

// ModerationCount counts moderation decisions of one stage (input: the
// question, output: the answer), outcome and top category.
type ModerationCount struct {
	Stage    string `json:"stage"`
	Decision string `json:"decision"`
	Category string `json:"category"`
	Count    int64  `json:"count"`
}

// ModerationCountsSQL counts blocked and flagged decisions (and provider
// errors, which block when the policy fails closed) by stage and top
// category, over the message_events rows that match where. Only the
// content-free decision record is read.
func ModerationCountsSQL(where string) string {
	return `
	SELECT stage, rec->>'decision', coalesce(rec->>'topCategory', ''), count(*)
	FROM message_events,
		LATERAL (VALUES ('input', moderation_input), ('output', moderation_output)) AS m(stage, rec)
	WHERE ` + where + ` AND (moderation_input IS NOT NULL OR moderation_output IS NOT NULL)
		AND rec->>'decision' IN ('block', 'flag', 'support', 'error')
	GROUP BY 1, 2, 3 ORDER BY 1, count(*) DESC, 3`
}

// ModerationTotalsSQL is four aggregate columns over message_events: the
// questions blocked, the answers withheld (output blocked), the answers
// with a flag at either stage and the answers replaced by the support
// message (ModerationTotals.Scan reads them).
const ModerationTotalsSQL = `
	count(*) FILTER (WHERE moderation_input->>'decision' = 'block'),
	count(*) FILTER (WHERE moderation_output->>'decision' = 'block'),
	count(*) FILTER (WHERE moderation_input->>'decision' = 'flag' OR moderation_output->>'decision' = 'flag'),
	count(*) FILTER (WHERE moderation_input->>'decision' = 'support' OR moderation_output->>'decision' = 'support')`

// ModerationTotals are the moderation outcomes of a range, by answer.
type ModerationTotals struct {
	QuestionsBlocked int64
	AnswersWithheld  int64
	Flagged          int64
	Supported        int64
}

// Dest are the scan destinations of ModerationTotalsSQL's columns.
func (m *ModerationTotals) Dest() []any {
	return []any{&m.QuestionsBlocked, &m.AnswersWithheld, &m.Flagged, &m.Supported}
}
