-- Evaluation sets, questions, runs and results (migrations/00032_evaluations.sql,
-- docs/evaluations.md).

-- ---- the platform switch ------------------------------------------------------

-- name: GetEvaluationSettings :one
SELECT * FROM evaluation_settings;

-- name: LockEvaluationSettings :one
SELECT * FROM evaluation_settings FOR UPDATE;

-- name: SetEvaluationsEnabled :one
UPDATE evaluation_settings
SET enabled = @enabled, revision = revision + 1, updated_by = @updated_by, updated_at = now()
RETURNING *;

-- ---- sets -------------------------------------------------------------------------

-- name: InsertEvalSet :one
INSERT INTO eval_sets (team_id, kb_id, agent_id, name, description, auto_run, created_by)
VALUES (@team_id, @kb_id, @agent_id, @name, @description, @auto_run, @created_by)
RETURNING *;

-- A team's sets with their target's name, question count and latest
-- finished run (optionally one knowledge base's or agent's).
-- name: ListEvalSetViews :many
SELECT sqlc.embed(s), coalesce(kb.name, ag.name, '')::text AS target_name,
       (SELECT count(*) FROM eval_cases c WHERE c.set_id = s.id)::bigint AS question_count,
       lr.id AS last_run_id, lr.kind AS last_run_kind, lr.status AS last_run_status, lr.summary AS last_run_summary,
       lr.created_at AS last_run_at
FROM eval_sets s
LEFT JOIN knowledge_bases kb ON kb.id = s.kb_id
LEFT JOIN agents ag ON ag.id = s.agent_id
LEFT JOIN eval_runs lr ON lr.id = (
    SELECT r.id FROM eval_runs r WHERE r.set_id = s.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1
)
WHERE s.team_id = @team_id
  AND (sqlc.narg(kb_id)::uuid IS NULL OR s.kb_id = sqlc.narg(kb_id)::uuid)
  AND (sqlc.narg(agent_id)::uuid IS NULL OR s.agent_id = sqlc.narg(agent_id)::uuid)
ORDER BY lower(s.name), s.id;

-- name: GetEvalSet :one
SELECT * FROM eval_sets WHERE id = @id AND team_id = @team_id;

-- name: LockEvalSet :one
SELECT * FROM eval_sets WHERE id = @id AND team_id = @team_id FOR UPDATE;

-- name: GetEvalSetByID :one
SELECT * FROM eval_sets WHERE id = @id;

-- name: UpdateEvalSet :one
UPDATE eval_sets
SET name = @name, description = @description, auto_run = @auto_run, revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: DeleteEvalSet :exec
DELETE FROM eval_sets WHERE id = @id;

-- A soft-deleted agent's sets go with it (hard deletes cascade).
-- name: DeleteAgentEvalSets :exec
DELETE FROM eval_sets WHERE agent_id = @agent_id;

-- name: CountTeamEvalSets :one
SELECT count(*) FROM eval_sets WHERE team_id = @team_id;

-- Sets with automatic runs of an agent (after a publish).
-- name: AutoRunSetsForAgent :many
SELECT * FROM eval_sets WHERE agent_id = @agent_id AND auto_run ORDER BY created_at, id;

-- Sets with automatic runs of a knowledge base (after a profile switch).
-- name: AutoRunSetsForKB :many
SELECT * FROM eval_sets WHERE kb_id = @kb_id AND auto_run ORDER BY created_at, id;

-- Sets with automatic runs whose knowledge bases (the set's, or the
-- published agent's) had documents added, changed or deleted since @since,
-- and no nightly run since then. Archived teams and deleted agents are left
-- out.
-- name: NightlyEvalSets :many
SELECT s.* FROM eval_sets s
JOIN teams t ON t.id = s.team_id AND t.status = 'active'
LEFT JOIN agents a ON a.id = s.agent_id
WHERE s.auto_run
  AND (s.agent_id IS NULL OR a.deleted_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM eval_runs r WHERE r.set_id = s.id AND r.trigger = 'nightly' AND r.created_at >= @since::timestamptz)
  AND EXISTS (
      SELECT 1 FROM kb_sources ks
      WHERE (ks.kb_id = s.kb_id
             OR ks.kb_id IN (SELECT vk.kb_id FROM agent_version_kbs vk WHERE vk.version_id = a.published_version_id))
        AND (EXISTS (SELECT 1 FROM documents d WHERE d.source_id = ks.source_id AND d.updated_at >= @since::timestamptz)
             OR EXISTS (SELECT 1 FROM deleted_files f WHERE f.source_id = ks.source_id AND f.deleted_at >= @since::timestamptz)))
ORDER BY s.created_at, s.id;

-- ---- questions ----------------------------------------------------------------------

-- name: InsertEvalCase :one
INSERT INTO eval_cases (set_id, question, expected, must_mention, note, created_by)
VALUES (@set_id, @question, @expected, @must_mention, @note, @created_by)
RETURNING *;

-- name: ListEvalCases :many
SELECT * FROM eval_cases WHERE set_id = @set_id ORDER BY created_at, id;

-- name: GetEvalCase :one
SELECT * FROM eval_cases WHERE id = @id AND set_id = @set_id;

-- name: LockEvalCase :one
SELECT * FROM eval_cases WHERE id = @id AND set_id = @set_id FOR UPDATE;

-- name: UpdateEvalCase :one
UPDATE eval_cases
SET question = @question, expected = @expected, must_mention = @must_mention, note = @note,
    revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: DeleteEvalCase :exec
DELETE FROM eval_cases WHERE id = @id;

-- name: CountEvalCases :one
SELECT count(*) FROM eval_cases WHERE set_id = @set_id;

-- The questions a run still has to check: those that existed when it was
-- started and have no result yet (a resumed job skips the rest).
-- name: PendingEvalCases :many
SELECT c.* FROM eval_cases c
WHERE c.set_id = @set_id AND c.created_at <= @before::timestamptz
  AND NOT EXISTS (SELECT 1 FROM eval_results r WHERE r.run_id = @run_id AND r.case_id = c.id)
ORDER BY c.created_at, c.id
LIMIT @lim;

-- name: CountEvalCasesBefore :one
SELECT count(*) FROM eval_cases WHERE set_id = @set_id AND created_at <= @before::timestamptz;

-- ---- documents ------------------------------------------------------------------------

-- name: EvalKBSourceIDs :many
SELECT DISTINCT source_id FROM kb_sources WHERE kb_id = ANY(@kb_ids::uuid[]);

-- Whether any expected document of a question still exists in the sources.
-- urls are compared without trailing slashes; prefixes with starts_with;
-- filenames lower-cased.
-- name: ExpectedDocumentExists :one
SELECT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.source_id = ANY(@source_ids::uuid[])
      AND (d.id = ANY(@document_ids::uuid[])
           OR (d.url <> '' AND rtrim(d.url, '/') = ANY(@urls::text[]))
           OR (d.url <> '' AND EXISTS (SELECT 1 FROM unnest(@url_prefixes::text[]) p WHERE starts_with(d.url, p)))
           OR (d.filename <> '' AND lower(d.filename) = ANY(@filenames::text[])))
)::boolean;

-- Documents of the sources whose title, filename or URL matches, for the
-- expected-documents picker.
-- name: SearchEvalDocuments :many
SELECT d.id, d.title, d.filename, d.url, s.name AS source_name
FROM documents d
JOIN data_sources s ON s.id = d.source_id
WHERE d.source_id = ANY(@source_ids::uuid[])
  AND (@pattern::text = '' OR d.title ILIKE @pattern::text OR d.filename ILIKE @pattern::text OR d.url ILIKE @pattern::text)
ORDER BY lower(coalesce(nullif(d.title, ''), nullif(d.filename, ''), d.url)), d.id
LIMIT @lim;

-- name: EvalDocumentsByID :many
SELECT d.id, d.title, d.filename, d.url FROM documents d WHERE d.id = ANY(@ids::uuid[]);

-- ---- runs ---------------------------------------------------------------------------------

-- name: InsertEvalRun :one
INSERT INTO eval_runs (set_id, team_id, kind, trigger, started_by, config, total)
VALUES (@set_id, @team_id, @kind, @trigger, @started_by, @config, @total)
RETURNING *;

-- name: GetEvalRun :one
SELECT * FROM eval_runs WHERE id = @id AND set_id = @set_id;

-- name: GetEvalRunByID :one
SELECT * FROM eval_runs WHERE id = @id;

-- name: LockEvalRun :one
SELECT * FROM eval_runs WHERE id = @id FOR UPDATE;

-- name: ListEvalRuns :many
SELECT * FROM eval_runs WHERE set_id = @set_id ORDER BY created_at DESC, id DESC LIMIT @lim;

-- name: ActiveEvalRun :one
SELECT * FROM eval_runs WHERE set_id = @set_id AND status IN ('queued', 'running') ORDER BY created_at LIMIT 1;

-- name: MarkEvalRunRunning :exec
UPDATE eval_runs SET status = 'running', started_at = coalesce(started_at, now()) WHERE id = @id AND status IN ('queued', 'running');

-- name: SetEvalRunProgress :exec
UPDATE eval_runs SET done = (SELECT count(*) FROM eval_results r WHERE r.run_id = @id) WHERE id = @id;

-- name: FinishEvalRun :one
UPDATE eval_runs
SET status = @status, summary = @summary, error = @error, finished_at = now(),
    done = (SELECT count(*) FROM eval_results r WHERE r.run_id = @id)
WHERE id = @id
RETURNING *;

-- The latest completed run of a kind before @before, for regression checks.
-- name: PreviousCompletedRun :one
SELECT * FROM eval_runs
WHERE set_id = @set_id AND kind = @kind AND status = 'completed' AND created_at < @before::timestamptz
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- ---- results ------------------------------------------------------------------------------

-- name: InsertEvalResult :exec
INSERT INTO eval_results (run_id, case_id, question, status, rank, hits, answer, scores, error, latency_ms)
VALUES (@run_id, @case_id, @question, @status, @rank, @hits, @answer, @scores, @error, @latency_ms)
ON CONFLICT ON CONSTRAINT eval_results_run_case_key DO NOTHING;

-- name: ListEvalResults :many
SELECT r.* FROM eval_results r
LEFT JOIN eval_cases c ON c.id = r.case_id
WHERE r.run_id = @run_id
ORDER BY c.created_at NULLS LAST, r.created_at, r.id;

-- A question's results in the latest runs, newest first.
-- name: ListCaseResults :many
SELECT sqlc.embed(r), run.kind AS run_kind, run.trigger AS run_trigger, run.created_at AS run_created_at, run.config AS run_config
FROM eval_results r
JOIN eval_runs run ON run.id = r.run_id
WHERE r.case_id = @case_id
ORDER BY run.created_at DESC, run.id DESC
LIMIT @lim;

-- ---- search (⌘K) --------------------------------------------------------------------------

-- Evaluation sets of the teams where the user is an editor or above.
-- name: SearchEvalSets :many
SELECT s.id, s.name, s.kb_id, s.agent_id, t.slug AS team_slug, t.name AS team_name,
       (CASE WHEN s.name ILIKE @prefix::text THEN 0 WHEN s.name ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM eval_sets s
JOIN team_members tm ON tm.team_id = s.team_id AND tm.user_id = @user_id::uuid AND tm.role IN ('owner', 'admin', 'editor')
JOIN teams t ON t.id = s.team_id
WHERE s.name ILIKE @contains::text
ORDER BY rank, length(s.name), lower(s.name), s.id
LIMIT @lim;
