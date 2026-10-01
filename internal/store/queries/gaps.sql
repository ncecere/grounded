-- The gap report (docs/v0.4.0.md §2, internal/gaps). Counts are read live
-- from gap_questions, leaving out conversations their users deleted, so a
-- topic hides as soon as it has fewer than the minimum of askers. The
-- vector work (embedding, grouping, matching) is in internal/gaps.

-- name: ListGapTopics :many
-- A team's topics with at least min_askers different askers (one topic
-- with topic_id), open first, then by recent activity.
SELECT t.id, t.team_id, t.agent_id, a.name AS agent_name, t.label, t.state, t.state_reason, t.state_changed_at, t.created_at,
       s.questions, s.askers, s.shared, s.recent, s.first_seen, s.last_seen
FROM gap_topics t
JOIN agents a ON a.id = t.agent_id AND a.deleted_at IS NULL
JOIN LATERAL (
    SELECT count(*)::int AS questions, count(DISTINCT q.asker_key)::int AS askers,
           (count(*) FILTER (WHERE q.shared))::int AS shared,
           (count(*) FILTER (WHERE q.created_at >= now() - interval '30 days'))::int AS recent,
           coalesce(min(q.created_at), t.created_at)::timestamptz AS first_seen,
           coalesce(max(q.created_at), t.created_at)::timestamptz AS last_seen
    FROM gap_questions q JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
    WHERE q.topic_id = t.id
) s ON s.askers >= @min_askers::int
WHERE t.team_id = @team_id
  AND (sqlc.narg(agent_id)::uuid IS NULL OR t.agent_id = sqlc.narg(agent_id))
  AND (sqlc.narg(topic_id)::uuid IS NULL OR t.id = sqlc.narg(topic_id))
  AND (cardinality(@states::text[]) = 0 OR t.state = ANY(@states::text[]))
ORDER BY (t.state = 'open') DESC, s.recent DESC, s.last_seen DESC, t.id
LIMIT 200;

-- name: GapTopicSignals :many
-- How many of each topic's questions have each signal.
SELECT q.topic_id::uuid AS topic_id, sig::text AS signal, count(*)::int AS n
FROM gap_questions q
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
CROSS JOIN LATERAL unnest(q.signals) AS sig
WHERE q.topic_id = ANY(@topic_ids::uuid[])
GROUP BY 1, 2;

-- name: GapTopicReasons :many
-- The thumbs-down reasons of each topic's questions.
SELECT q.topic_id::uuid AS topic_id, q.feedback_reason::text AS reason, count(*)::int AS n
FROM gap_questions q
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
WHERE q.topic_id = ANY(@topic_ids::uuid[]) AND q.feedback_reason IS NOT NULL
GROUP BY 1, 2;

-- name: GapTopicTrend :many
-- Each topic's questions per week over the last 8 weeks (0: this week).
SELECT q.topic_id::uuid AS topic_id, floor(extract(epoch FROM now() - q.created_at) / 604800)::int AS weeks_ago, count(*)::int AS n
FROM gap_questions q
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
WHERE q.topic_id = ANY(@topic_ids::uuid[]) AND q.created_at > now() - interval '56 days'
GROUP BY 1, 2;

-- name: GapPendingCount :one
-- A team's failed questions of the last 30 days that aren't in a topic
-- shown yet (not grouped, or in a topic below the minimum of askers).
SELECT count(*)::int
FROM gap_questions q
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
JOIN agents a ON a.id = q.agent_id AND a.deleted_at IS NULL
WHERE q.team_id = @team_id AND (sqlc.narg(agent_id)::uuid IS NULL OR q.agent_id = sqlc.narg(agent_id))
  AND q.created_at >= now() - interval '30 days'
  AND (q.topic_id IS NULL OR (SELECT count(DISTINCT q2.asker_key) FROM gap_questions q2
                              JOIN conversations c2 ON c2.id = q2.conversation_id AND c2.deleted_at IS NULL
                              WHERE q2.topic_id = q.topic_id) < @min_askers::int);

-- name: ListSharedGapQuestions :many
-- The questions their askers shared, newest first.
SELECT q.id, q.question, q.feedback_reason, q.evaluation_question_id, q.created_at
FROM gap_questions q
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
WHERE q.topic_id = @topic_id AND q.shared
ORDER BY q.created_at DESC
LIMIT 100;

-- name: GetSharedGapQuestion :one
SELECT q.id, q.question, q.feedback_reason, q.evaluation_question_id, q.created_at
FROM gap_questions q
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
WHERE q.id = @id AND q.topic_id = @topic_id AND q.shared;

-- name: SetGapQuestionEvaluation :exec
UPDATE gap_questions SET evaluation_question_id = @evaluation_question_id, updated_at = now() WHERE id = @id;

-- name: LockGapTopic :one
SELECT id, team_id, agent_id, label, state, state_reason FROM gap_topics WHERE id = @id AND team_id = @team_id FOR UPDATE;

-- name: SetGapTopicState :exec
-- A person's action: dismissed (with an optional reason) or fixed. The
-- topic reopens when a newer failure joins it (internal/gaps).
UPDATE gap_topics SET state = @state, state_reason = @state_reason, state_changed_at = now(), state_changed_by = @state_changed_by,
    answered_since = 0, updated_at = now()
WHERE id = @id;

-- name: GapCountsByTeam :many
-- Platform admins and auditors: failed questions per team and signal in a
-- period (counts only, never topics or questions).
SELECT t.id AS team_id, t.slug, t.name, sig::text AS signal, count(*)::int AS n
FROM gap_questions q
JOIN teams t ON t.id = q.team_id
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
CROSS JOIN LATERAL unnest(q.signals) AS sig
WHERE q.created_at >= @from_at AND q.created_at < @to_at
GROUP BY 1, 2, 3, 4;

-- name: GapTotalsByTeam :many
SELECT t.id AS team_id, t.slug, t.name, count(*)::int AS questions
FROM gap_questions q
JOIN teams t ON t.id = q.team_id
JOIN conversations c ON c.id = q.conversation_id AND c.deleted_at IS NULL
WHERE q.created_at >= @from_at AND q.created_at < @to_at
GROUP BY 1, 2, 3
ORDER BY 4 DESC, 2;
