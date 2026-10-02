// Merging topics (owner decision 4 of 2026-10-01): every run merges an
// agent's topics whose centroids are within MergeSimilarity, closest
// first, and, for teams that turned the confirmation on, borderline pairs
// SystemOne says are about the same subject.

package gaps

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// closePairs are an agent's topic pairs at least $1 alike (at most $2 when
// $3, leaving out pairs SystemOne already told apart), the older topic
// first, closest first.
const closePairs = `
SELECT a.id, b.id, a.team_id, a.agent_id
FROM gap_topics a
JOIN gap_topics b ON b.agent_id = a.agent_id AND b.profile_id = a.profile_id AND (a.created_at, a.id) < (b.created_at, b.id)
WHERE a.centroid IS NOT NULL AND b.centroid IS NOT NULL AND 1 - (a.centroid <=> b.centroid) >= $1
  AND (NOT $3::boolean OR (1 - (a.centroid <=> b.centroid) < $2
       AND EXISTS (SELECT 1 FROM gap_settings s WHERE s.team_id = a.team_id AND s.confirm_similar)
       AND NOT EXISTS (SELECT 1 FROM gap_topic_pairs p WHERE p.topic_a = least(a.id, b.id) AND p.topic_b = greatest(a.id, b.id))))
ORDER BY a.centroid <=> b.centroid
LIMIT $4`

type topicPair struct{ keep, gone, teamID, agentID uuid.UUID }

// merge merges close topics, then confirmed borderline ones.
func (r *Runner) merge(ctx context.Context, sum *Summary, cf *confirmer) error {
	for sum.Merged < mergesPerRun {
		n, err := r.mergePass(ctx, false, nil, mergesPerRun-sum.Merged)
		if err != nil {
			return err
		}
		sum.Merged += n
		if n == 0 {
			break
		}
	}
	if !cf.available(ctx) {
		return nil
	}
	n, err := r.mergePass(ctx, true, cf, mergesPerRun-sum.Merged)
	sum.Merged += n
	return err
}

// mergePass merges the pairs found in one query, skipping topics already
// merged in this pass (their centroids moved); borderline pairs are merged
// only when SystemOne confirms them, and remembered when it doesn't.
func (r *Runner) mergePass(ctx context.Context, borderline bool, cf *confirmer, limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	floor := MergeSimilarity
	if borderline {
		floor = ConfirmFloor
	}
	rows, err := r.Pool.Query(ctx, closePairs, floor, MergeSimilarity, borderline, limit*4)
	if err != nil {
		return 0, err
	}
	pairs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (topicPair, error) {
		var p topicPair
		return p, row.Scan(&p.keep, &p.gone, &p.teamID, &p.agentID)
	})
	if err != nil {
		return 0, err
	}
	touched := map[uuid.UUID]bool{}
	n := 0
	for _, p := range pairs {
		if n >= limit {
			break
		}
		if touched[p.keep] || touched[p.gone] {
			continue
		}
		if borderline {
			same, asked, err := r.confirmPair(ctx, cf, p)
			if err != nil {
				return n, err
			}
			if !asked || !same {
				continue
			}
		}
		touched[p.keep], touched[p.gone] = true, true
		if err := pgx.BeginFunc(ctx, r.Pool, func(tx pgx.Tx) error { return mergePair(ctx, tx, p.keep, p.gone) }); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// confirmPair asks SystemOne whether two topics' representative questions
// (each the nearest to its centroid) are about the same subject; a "no" is
// remembered so the pair isn't asked again. asked is false when the check
// couldn't run (no SystemOne, the team's budget, an error).
func (r *Runner) confirmPair(ctx context.Context, cf *confirmer, p topicPair) (same, asked bool, err error) {
	var a, b string
	err = r.Pool.QueryRow(ctx, `SELECT
		(SELECT q.question FROM gap_questions q, gap_topics t WHERE t.id = $1 AND q.topic_id = t.id AND q.embedding IS NOT NULL
		 ORDER BY q.embedding <=> t.centroid LIMIT 1),
		(SELECT q.question FROM gap_questions q, gap_topics t WHERE t.id = $2 AND q.topic_id = t.id AND q.embedding IS NOT NULL
		 ORDER BY q.embedding <=> t.centroid LIMIT 1)`, p.keep, p.gone).Scan(&a, &b)
	if err != nil {
		return false, false, nil // a topic without questions: nothing to ask
	}
	same, asked = cf.ask(ctx, p.teamID, p.agentID, a, b)
	if asked && !same {
		_, err = r.Pool.Exec(ctx, `INSERT INTO gap_topic_pairs (topic_a, topic_b) VALUES (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))
			ON CONFLICT DO NOTHING`, p.keep, p.gone)
	}
	return same, asked, err
}

// mergePair moves the newer topic's questions and history into the older
// one, which keeps its ID, history and state, except that a topic
// dismissed as not for this agent passes that on (the editor's decision
// covers the subject). The kept topic then follows the usual rule: dismissed
// for now, fixed or resolved, it reopens when the merged questions include
// a failure newer than its closing. It is labelled again (labelled_questions
// 0), keeping the newer topic's label meanwhile when it had none.
func mergePair(ctx context.Context, tx pgx.Tx, keep, gone uuid.UUID) error {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM gap_topics WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`, keep, gone); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE gap_topics k SET state = g.state, state_reason = g.state_reason, dismiss_kind = g.dismiss_kind,
		state_changed_at = g.state_changed_at, state_changed_by = g.state_changed_by
		FROM gap_topics g WHERE k.id = $1 AND g.id = $2 AND g.state = 'dismissed' AND g.dismiss_kind = 'not_for_agent'
		AND NOT (k.state = 'dismissed' AND k.dismiss_kind IS NOT DISTINCT FROM 'not_for_agent')`, keep, gone); err != nil {
		return err
	}
	var last any
	if err := tx.QueryRow(ctx, `UPDATE gap_topics k SET label = CASE WHEN k.label = '' THEN g.label ELSE k.label END, labelled_questions = 0,
		last_failed_at = greatest(k.last_failed_at, g.last_failed_at), updated_at = now()
		FROM gap_topics g WHERE k.id = $1 AND g.id = $2 RETURNING k.last_failed_at`, keep, gone).Scan(&last); err != nil {
		return err
	}
	for _, sql := range []string{
		`UPDATE gap_questions SET topic_id = $1 WHERE topic_id = $2`,
		`UPDATE gap_topic_events SET topic_id = $1 WHERE topic_id = $2`,
	} {
		if _, err := tx.Exec(ctx, sql, keep, gone); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM gap_topics WHERE id = $1`, gone); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO gap_topic_events (topic_id, kind) VALUES ($1, 'merged')`, keep); err != nil {
		return err
	}
	if last == nil {
		_, err := tx.Exec(ctx, `UPDATE gap_topics t SET centroid = (SELECT avg(q.embedding) FROM gap_questions q WHERE q.topic_id = t.id
			AND q.embedding IS NOT NULL) WHERE t.id = $1`, keep)
		return err
	}
	var reopened bool
	if err := tx.QueryRow(ctx, refreshTopic, keep, last).Scan(&reopened); err != nil {
		return err
	}
	return reopenedEvent(ctx, tx, keep, reopened)
}
