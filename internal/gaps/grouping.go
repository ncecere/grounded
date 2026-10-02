// Grouping questions into topics (docs/gaps.md, owner decision 4 of
// 2026-10-01). A new question joins the topic of its nearest question at a
// cosine similarity of at least JoinSimilarity, or the topic with the
// nearest centroid at least MergeSimilarity, else it starts a topic. Every
// run then merges topics whose centroids are within MergeSimilarity, so an
// early split doesn't last: the older topic keeps its ID, history and
// state, and is labelled again. With "Confirm similar questions with
// SystemOne" on for the team (gap_settings), borderline pairs are asked
// whether they are about the same subject: a question and its nearest
// question from ConfirmFloor to JoinSimilarity, and two topics' centroids
// from ConfirmFloor to MergeSimilarity (metered to the team).

package gaps

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	// JoinSimilarity: a question joins the topic of its nearest question
	// this close.
	JoinSimilarity = 0.72
	// MergeSimilarity: a question joins the topic whose centroid is this
	// close, and two topics this close merge (agents.GapSimilarity).
	MergeSimilarity = 0.8
	// ConfirmFloor: borderline pairs from here up are asked to SystemOne
	// when the team turned the confirmation on.
	ConfirmFloor = 0.65
	// mergesPerRun bounds the merges of a run.
	mergesPerRun = 500
)

// toAssign lists embedded questions in no topic, oldest first.
const toAssign = `
SELECT q.id, q.created_at, q.team_id, q.agent_id, q.question FROM gap_questions q
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
WHERE q.topic_id IS NULL AND q.embedding IS NOT NULL AND q.profile_id IS NOT NULL
ORDER BY q.created_at, q.id
LIMIT $1`

// nearest are the question's candidate topics in its agent and profile:
// the one with the nearest centroid ('c') and the one of its nearest
// grouped question ('q', with that question's text).
const nearest = `
(SELECT 'c' AS via, t.id, 1 - (t.centroid <=> q.embedding) AS sim, '' AS other
 FROM gap_topics t, gap_questions q
 WHERE q.id = $1 AND t.agent_id = q.agent_id AND t.profile_id = q.profile_id AND t.centroid IS NOT NULL
 ORDER BY t.centroid <=> q.embedding LIMIT 1)
UNION ALL
(SELECT 'q', o.topic_id, 1 - (o.embedding <=> q.embedding), o.question
 FROM gap_questions q
 JOIN gap_questions o ON o.agent_id = q.agent_id AND o.profile_id = q.profile_id AND o.id <> q.id
 JOIN conversations c ON c.id = o.conversation_id AND c.deleted_at IS NULL
 WHERE q.id = $1 AND o.topic_id IS NOT NULL AND o.embedding IS NOT NULL
 ORDER BY o.embedding <=> q.embedding LIMIT 1)`

// newQuestion is a question to group.
type newQuestion struct {
	id, teamID, agentID uuid.UUID
	created             time.Time
	text                string
}

// assign puts each new question in a topic, or a new one.
func (r *Runner) assign(ctx context.Context, sum *Summary, cf *confirmer) error {
	rows, err := r.Pool.Query(ctx, toAssign, assignBatch)
	if err != nil {
		return err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (newQuestion, error) {
		var q newQuestion
		return q, row.Scan(&q.id, &q.created, &q.teamID, &q.agentID, &q.text)
	})
	if err != nil {
		return err
	}
	for _, q := range list {
		topic, err := r.pick(ctx, q, cf)
		if err != nil {
			return err
		}
		reopened, err := r.assignOne(ctx, q, topic)
		if err != nil {
			return err
		}
		sum.Assigned++
		if topic == uuid.Nil {
			sum.NewTopics++
		}
		if reopened {
			sum.Reopened++
		}
	}
	return nil
}

// pick chooses the question's topic (uuid.Nil: a new one).
func (r *Runner) pick(ctx context.Context, q newQuestion, cf *confirmer) (uuid.UUID, error) {
	rows, err := r.Pool.Query(ctx, nearest, q.id)
	if err != nil {
		return uuid.Nil, err
	}
	type candidate struct {
		via   string
		topic uuid.UUID
		sim   float64
		other string
	}
	cands, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (candidate, error) {
		var c candidate
		return c, row.Scan(&c.via, &c.topic, &c.sim, &c.other)
	})
	if err != nil {
		return uuid.Nil, err
	}
	var best candidate
	var borderline *candidate
	for i, c := range cands {
		ok := (c.via == "c" && c.sim >= MergeSimilarity) || (c.via == "q" && c.sim >= JoinSimilarity)
		if ok && c.sim > best.sim {
			best = c
		}
		if c.via == "q" && c.sim >= ConfirmFloor && c.sim < JoinSimilarity {
			borderline = &cands[i]
		}
	}
	if best.topic != uuid.Nil || borderline == nil {
		return best.topic, nil
	}
	if cf.same(ctx, q.teamID, q.agentID, q.text, borderline.other) {
		return borderline.topic, nil
	}
	return uuid.Nil, nil
}

// assignOne puts one question in topic (uuid.Nil: a new topic) in a
// transaction and refreshes the topic.
func (r *Runner) assignOne(ctx context.Context, q newQuestion, topic uuid.UUID) (reopened bool, err error) {
	err = pgx.BeginFunc(ctx, r.Pool, func(tx pgx.Tx) error {
		if topic == uuid.Nil {
			if err := tx.QueryRow(ctx, `INSERT INTO gap_topics (team_id, agent_id, profile_id, centroid, last_failed_at)
				SELECT team_id, agent_id, profile_id, embedding, created_at FROM gap_questions WHERE id = $1 RETURNING id`, q.id).Scan(&topic); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE gap_questions SET topic_id = $2 WHERE id = $1`, q.id, topic); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, refreshTopic, topic, q.created).Scan(&reopened); err != nil {
			return err
		}
		return reopenedEvent(ctx, tx, topic, reopened)
	})
	return reopened, err
}

// reopenedEvent adds the job's reopening to a topic's history.
func reopenedEvent(ctx context.Context, tx pgx.Tx, topic uuid.UUID, reopened bool) error {
	if !reopened {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO gap_topic_events (topic_id, kind) VALUES ($1, 'reopened')`, topic)
	return err
}

// refreshTopic moves a topic's centroid to the mean of its questions and
// records a failure at $2: a topic dismissed for now, fixed or resolved
// reopens when the failure is newer than its closing (one dismissed as not
// for this agent never does), and good answers counted before it no longer
// count. It returns whether the topic reopened. The dismissal's reason
// stays in the topic's history (gap_topic_events).
const refreshTopic = `
WITH old AS (
    SELECT state <> 'open' AND NOT (state = 'dismissed' AND dismiss_kind IS NOT DISTINCT FROM 'not_for_agent')
           AND $2::timestamptz > state_changed_at AS reopen
    FROM gap_topics WHERE id = $1 FOR UPDATE)
UPDATE gap_topics t SET
    centroid = (SELECT avg(q.embedding) FROM gap_questions q JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
                WHERE q.topic_id = t.id AND q.embedding IS NOT NULL),
    last_failed_at = greatest(coalesce(t.last_failed_at, $2::timestamptz), $2::timestamptz),
    state = CASE WHEN old.reopen THEN 'open' ELSE t.state END,
    state_reason = CASE WHEN old.reopen THEN '' ELSE t.state_reason END,
    dismiss_kind = CASE WHEN old.reopen THEN NULL ELSE t.dismiss_kind END,
    state_changed_by = CASE WHEN old.reopen THEN NULL ELSE t.state_changed_by END,
    state_changed_at = CASE WHEN old.reopen THEN now() ELSE t.state_changed_at END,
    answered_since = CASE WHEN t.last_answered_at IS NULL OR $2::timestamptz > t.last_answered_at THEN 0 ELSE t.answered_since END,
    updated_at = now()
FROM old
WHERE t.id = $1
RETURNING old.reopen`
