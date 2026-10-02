// Failed questions for the gap report (docs/v0.4.0.md §2, ADR-0010 as
// amended for v0.4.0). When an answer in a stored conversation fails (no
// context, a strict refusal, every passage judged out, out of scope,
// unsupported or contradicted claims), its question is kept apart from the
// transcript in gap_questions, with the vector the search already computed
// (no extra model call: a question without one is embedded by the topics
// job) and a pseudonymous asker key; a thumbs-down adds the question too
// (feedback). A good answer to a question near an open topic counts towards
// closing it, without keeping anything of the question. The topics job,
// the API and the report are internal/gaps.

package agents

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/systemone"
)

// Gap signals: why a question counts as failed (gap_questions.signals).
const (
	GapNoContext   = "no_context"
	GapRefused     = "refused"
	GapJudgedOut   = "judged_out"
	GapOutOfScope  = "out_of_scope"
	GapUnsupported = "unsupported"
	GapThumbsDown  = "thumbs_down"
)

// GapSimilarity is the cosine similarity at which a question belongs to a
// topic (its centroid): the topics job groups by it, and a good answer
// this close to an open topic counts towards closing it.
const GapSimilarity = 0.8

// gapSignals says why an answer failed; nil for a good answer and for an
// answer that says nothing about the agent's knowledge (an error, a
// moderation notice, small talk). An uncited sentence isn't a failure
// (owner decision, 2026-10-01): models often leave a lead-in or a list item
// without a marker in an answer that is fine, so an answer whose only issue
// is uncited sentences counts as answered well (and may be saved); the
// chat and the claim-check analytics still show them.
func (ru *run) gapSignals(ans *Answer) []string {
	if ans.ErrorCode != "" || ans.Moderation != nil || ans.noContextReason == NoContextSmallTalk {
		return nil
	}
	var out []string
	if ans.Refused {
		out = append(out, GapRefused)
	}
	switch {
	case ans.noContextReason == NoContextJudgedOut:
		out = append(out, GapJudgedOut)
	case ans.NoContext && ans.noContextReason != NoContextOutOfScope:
		out = append(out, GapNoContext)
	}
	if ru.scopeRec != nil && ru.scopeRec.Decision == systemone.ScopeOutOfScope {
		out = append(out, GapOutOfScope)
	}
	if r := ru.citeRec; r != nil && !ans.Refused {
		if r.Unsupported+r.Contradicted > 0 {
			out = append(out, GapUnsupported)
		}
	}
	return out
}

// recordGap keeps a failed answer's question (stored conversations only:
// a question goes with its conversation, and stateless callers have none),
// or notes a good answer near an open topic. Failures are logged: the
// answer is already recorded.
func (ru *run) recordGap(ctx context.Context, ans *Answer) {
	if !ans.Persisted || ru.conv == nil || ru.channel == ChannelTest {
		return
	}
	signals := ru.gapSignals(ans)
	profile, vec := ru.gapVector()
	var err error
	switch {
	case len(signals) > 0:
		err = ru.captureGap(ctx, ans, signals, profile, vec)
	case ans.ErrorCode == "" && ans.Moderation == nil && len(ans.Citations) > 0 && vec != nil:
		err = noteAnswered(ctx, ru.s.Pool, ru.agent.ID, profile, vec)
	}
	if err != nil {
		ru.s.Log.Warn("record failed question", "err", err, "agent", ru.agent.ID)
	}
}

// captureGap stores the failed question.
func (ru *run) captureGap(ctx context.Context, ans *Answer, signals []string, profile uuid.NullUUID, vec []float32) error {
	asker := ru.pseudonym()
	if asker == nil {
		return nil // no pepper: askers can't be counted, so nothing is kept
	}
	_, err := ru.s.Pool.Exec(ctx, `INSERT INTO gap_questions (team_id, agent_id, conversation_id, message_id, question, profile_id, embedding, signals, asker_key)
		VALUES ($1, $2, $3, $4, $5, $6, $7::text::vector, $8, $9) ON CONFLICT (message_id) DO NOTHING`,
		ru.team.ID, ru.agent.ID, ru.conv.ID, ans.MessageID, ru.question, profile, VectorText(vec), signals, *asker)
	if err == nil {
		for _, sig := range signals {
			observability.GapQuestions.WithLabelValues(sig).Inc()
		}
	}
	return err
}

// gapVector is the agent's gap profile (the lowest profile ID among its
// knowledge bases, as the topics job picks it) and the vector this answer's
// first search computed in it, if any.
func (ru *run) gapVector() (uuid.NullUUID, []float32) {
	if ru.retr == nil || len(ru.retr.kbs) == 0 {
		return uuid.NullUUID{}, nil
	}
	ids := make([]uuid.UUID, len(ru.retr.kbs))
	for i, kb := range ru.retr.kbs {
		ids[i] = kb.EmbeddingProfileID
	}
	profile := slices.MinFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	text := ru.question
	if ru.firstSearch != nil && ru.firstSearch.Query != "" {
		text = ru.firstSearch.Query
	}
	vec, _ := ru.retr.cache.Lookup(profile, text)
	return uuid.NullUUID{UUID: profile, Valid: true}, vec
}

// noteAnswered counts a good answer towards closing the open topic nearest
// to its question, if one is within GapSimilarity. Nothing of the question
// is kept.
func noteAnswered(ctx context.Context, db *pgxpool.Pool, agentID uuid.UUID, profile uuid.NullUUID, vec []float32) error {
	_, err := db.Exec(ctx, `UPDATE gap_topics SET answered_since = CASE WHEN last_answered_at IS NULL OR last_answered_at < last_failed_at
		THEN 1 ELSE answered_since + 1 END, last_answered_at = now()
		WHERE id = (SELECT t.id FROM gap_topics t WHERE t.agent_id = $1 AND t.profile_id = $2 AND t.state = 'open' AND t.centroid IS NOT NULL
		            AND 1 - (t.centroid <=> $3::text::vector) >= $4 ORDER BY t.centroid <=> $3::text::vector LIMIT 1)`,
		agentID, profile, VectorText(vec), GapSimilarity)
	return err
}

// VectorText is a vector in pgvector's text form (nil for none).
func VectorText(vec []float32) *string {
	if vec == nil {
		return nil
	}
	var b strings.Builder
	b.WriteByte('[')
	for i, f := range vec {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'g', -1, 32))
	}
	b.WriteByte(']')
	s := b.String()
	return &s
}

// gapFeedback keeps a thumbs-down answer's question (with its reason and
// whether the asker shared it), or takes a changed rating back: a thumbs-up
// removes the thumbs-down signal, and the question when nothing else failed.
func gapFeedback(ctx context.Context, tx pgx.Tx, messageID uuid.UUID, rating string, reason *string, share bool, asker *string) error {
	if rating != "down" {
		if _, err := tx.Exec(ctx, `UPDATE gap_questions SET signals = array_remove(signals, 'thumbs_down'), feedback_reason = NULL,
			shared = false, updated_at = now() WHERE message_id = $1`, messageID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM gap_questions WHERE message_id = $1 AND signals = '{}'`, messageID)
		return err
	}
	if asker == nil {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO gap_questions (team_id, agent_id, conversation_id, message_id, question, signals, feedback_reason, asker_key, shared)
		SELECT a.team_id, c.agent_id, c.id, $1, u.content->>'text', ARRAY['thumbs_down'], $2, $3, $4
		FROM messages am
		JOIN conversations c ON c.id = am.conversation_id
		JOIN agents a ON a.id = c.agent_id
		JOIN LATERAL (SELECT content FROM messages WHERE conversation_id = am.conversation_id AND seq < am.seq AND role = 'user'
		              ORDER BY seq DESC LIMIT 1) u ON coalesce(u.content->>'text', '') <> ''
		WHERE am.id = $1
		ON CONFLICT (message_id) DO UPDATE SET signals = CASE WHEN 'thumbs_down' = ANY(gap_questions.signals) THEN gap_questions.signals
		    ELSE gap_questions.signals || ARRAY['thumbs_down'] END,
		    feedback_reason = EXCLUDED.feedback_reason, shared = EXCLUDED.shared, updated_at = now()`,
		messageID, reason, *asker, share)
	if err == nil {
		observability.GapQuestions.WithLabelValues(GapThumbsDown).Inc()
	}
	return err
}
