-- The content health report (docs/content-health.md, ADR-0027). Every read of a team's data names the team, so
-- a report can never join across teams; every collection query is bounded by LIMIT and runs under a
-- statement timeout set by the caller.

-- ---- the platform switch ---------------------------------------------------------------------

-- name: GetContentHealthSettings :one
SELECT * FROM content_health_settings;

-- name: LockContentHealthSettings :one
SELECT * FROM content_health_settings FOR UPDATE;

-- name: SetContentHealthSettings :one
UPDATE content_health_settings SET enabled = $1, revision = revision + 1, updated_by = $2, updated_at = now() RETURNING *;

-- ---- reports ---------------------------------------------------------------------------------

-- name: InsertContentHealthReport :one
INSERT INTO content_health_reports (team_id, scope_source_id, scope_kb_id, stale_days, citation_window_days, requested_by)
VALUES (@team_id, @scope_source_id, @scope_kb_id, @stale_days, @citation_window_days, @requested_by)
RETURNING *;

-- name: GetContentHealthReport :one
SELECT * FROM content_health_reports WHERE id = @id AND team_id = @team_id AND (expires_at IS NULL OR expires_at > now());

-- name: GetContentHealthReportByID :one
SELECT * FROM content_health_reports WHERE id = $1;

-- A report that ended is listed until it expires; the newest first.
-- name: ListContentHealthReports :many
SELECT * FROM content_health_reports
WHERE team_id = @team_id AND (expires_at IS NULL OR expires_at > now())
ORDER BY created_at DESC, id DESC
LIMIT @page_size;

-- The pause between two reports of a team: 1 row when this request may go (and the team's clock is set), 0 when it must wait.
-- name: ClaimContentHealthSlot :execrows
INSERT INTO content_health_pacing (team_id, last_at) VALUES (@team_id, now())
ON CONFLICT (team_id) DO UPDATE SET last_at = now()
WHERE content_health_pacing.last_at <= now() - make_interval(secs => @cooldown_seconds::int);

-- name: ContentHealthPacing :one
SELECT last_at FROM content_health_pacing WHERE team_id = $1;

-- Only a queued report starts: one cancelled after the worker read it stays cancelled.
-- name: StartContentHealthReport :one
UPDATE content_health_reports SET status = 'running', as_of = now(), started_at = now()
WHERE id = $1 AND status = 'queued'
RETURNING *;

-- A report ends once, and only while it is running: a cancel in the meantime wins.
-- name: FinishContentHealthReport :execrows
UPDATE content_health_reports
SET status = 'completed', signals = @signals, finished_at = now(), expires_at = now() + make_interval(days => @retention_days::int)
WHERE id = @id AND status = 'running';

-- name: FailContentHealthReport :execrows
UPDATE content_health_reports
SET status = 'failed', error_code = @error_code, finished_at = now(), expires_at = now() + make_interval(days => @retention_days::int)
WHERE id = @id AND status IN ('queued', 'running');

-- name: CancelContentHealthReport :execrows
UPDATE content_health_reports
SET status = 'cancelled', finished_at = now(), expires_at = now() + make_interval(days => @retention_days::int)
WHERE id = @id AND team_id = @team_id AND status IN ('queued', 'running');

-- name: ContentHealthReportStatus :one
SELECT status FROM content_health_reports WHERE id = $1;

-- name: DeleteContentHealthReport :execrows
DELETE FROM content_health_reports WHERE id = @id AND team_id = @team_id;

-- A report that never started (its queue is not served) or whose worker died.
-- name: FailStuckContentHealthReports :execrows
UPDATE content_health_reports
SET status = 'failed', error_code = 'timed_out', finished_at = now(), expires_at = now() + make_interval(days => @retention_days::int)
WHERE (status = 'queued' AND created_at < now() - make_interval(mins => @queued_minutes::int))
   OR (status = 'running' AND started_at < now() - make_interval(mins => @running_minutes::int));

-- Expired reports, and every report beyond a team's newest @keep (findings and coverage go with them): all teams'
-- (the hourly job) or one team's (when it makes a report).
-- name: PruneContentHealthReports :execrows
DELETE FROM content_health_reports r
WHERE r.status NOT IN ('queued', 'running')
  AND (sqlc.narg(team_id)::uuid IS NULL OR r.team_id = sqlc.narg(team_id)::uuid)
  AND (r.expires_at <= now()
       OR r.id IN (SELECT x.id FROM (SELECT id, row_number() OVER (PARTITION BY team_id ORDER BY created_at DESC, id DESC) AS n
                                     FROM content_health_reports
                                     WHERE sqlc.narg(team_id)::uuid IS NULL OR team_id = sqlc.narg(team_id)::uuid) x
                   WHERE x.n > @keep::int));

-- ---- what a report reads ---------------------------------------------------------------------

-- The team's own sources in the scope (never a platform-shared one: team_id is the team's).
-- name: ContentHealthScopeSources :many
SELECT s.id, s.type::text AS type
FROM data_sources s
WHERE s.team_id = @team_id
  AND (sqlc.narg(source_id)::uuid IS NULL OR s.id = sqlc.narg(source_id)::uuid)
  AND (sqlc.narg(kb_id)::uuid IS NULL OR EXISTS (
        SELECT 1 FROM kb_sources k JOIN knowledge_bases b ON b.id = k.kb_id
        WHERE k.source_id = s.id AND k.kb_id = sqlc.narg(kb_id)::uuid AND b.team_id = @team_id))
ORDER BY s.id
LIMIT @page_size;

-- name: ContentHealthSourceCounts :many
SELECT d.source_id,
       count(*)::int AS documents,
       (count(*) FILTER (WHERE d.status = 'ready'))::int AS ready,
       (count(*) FILTER (WHERE d.status = 'ready' AND d.processed_at IS NULL))::int AS ready_no_date,
       (count(*) FILTER (WHERE d.status = 'ready' AND d.sha256 = ''))::int AS ready_no_hash
FROM documents d
WHERE d.team_id = @team_id AND d.source_id = ANY(@source_ids::uuid[])
GROUP BY d.source_id;

-- Stale: ready documents last processed at or before the cutoff, oldest first. total counts every match. confirmed_at is the
-- epoch when no crawl record says when a crawl last saw the page.
-- name: ContentHealthStale :many
SELECT d.id AS document_id, d.source_id, d.processed_at::timestamptz AS processed_at,
       coalesce((SELECT c.finished_at FROM web_crawls c WHERE c.id = d.last_seen_crawl_id), 'epoch'::timestamptz)::timestamptz AS confirmed_at,
       (count(*) OVER ())::bigint AS total
FROM documents d
WHERE d.team_id = @team_id AND d.source_id = ANY(@source_ids::uuid[])
  AND d.status = 'ready' AND d.processed_at IS NOT NULL AND d.processed_at <= @cutoff::timestamptz
ORDER BY d.processed_at, d.id
LIMIT @page_size;

-- Duplicates: raw SHA-256 groups with documents of at least two different sources of the scope, largest first.
-- name: ContentHealthDuplicateGroups :many
SELECT d.sha256::text AS sha256, count(*)::bigint AS members, (count(*) OVER ())::bigint AS total
FROM documents d
WHERE d.team_id = @team_id AND d.source_id = ANY(@source_ids::uuid[]) AND d.status = 'ready' AND d.sha256 <> ''
GROUP BY d.sha256
HAVING count(DISTINCT d.source_id) > 1
ORDER BY count(*) DESC, d.sha256
LIMIT @page_size;

-- At most @per_group documents of each group, one per source in turn so a group shows its different sources.
-- name: ContentHealthDuplicateMembers :many
SELECT y.id AS document_id, y.source_id, y.sha256::text AS sha256, y.processed_at::timestamptz AS processed_at
FROM (SELECT x.id, x.source_id, x.sha256, x.processed_at,
             row_number() OVER (PARTITION BY x.sha256 ORDER BY x.nth, x.source_id, x.id) AS n
      FROM (SELECT d.id, d.source_id, d.sha256, d.processed_at,
                   row_number() OVER (PARTITION BY d.sha256, d.source_id ORDER BY d.created_at, d.id) AS nth
            FROM documents d
            WHERE d.team_id = @team_id AND d.source_id = ANY(@source_ids::uuid[]) AND d.status = 'ready'
              AND d.sha256 = ANY(@hashes::text[])) x) y
WHERE y.n <= @per_group::int
ORDER BY y.sha256, y.n;

-- The team's agents: the answer events of the window are theirs.
-- name: ContentHealthTeamAgents :many
SELECT id FROM agents WHERE team_id = @team_id LIMIT 5000;

-- Answers in [from, to], counted up to @cap_plus_one (more means the scan is too big). Draft test chats are not use.
-- Events are content-free (no question, answer, user or conversation).
-- name: ContentHealthAnswerCount :one
SELECT count(*)::bigint AS answers
FROM (SELECT 1 FROM message_events e
      WHERE e.agent_id = ANY(@agent_ids::uuid[]) AND e.channel <> 'test' AND e.created_at >= @from_at::timestamptz AND e.created_at <= @to_at::timestamptz
      LIMIT @cap_plus_one::int) x;

-- The earliest of those answers (called only when their number is within the bound).
-- name: ContentHealthFirstAnswer :one
SELECT coalesce(min(e.created_at), 'epoch'::timestamptz)::timestamptz AS first_at
FROM message_events e
WHERE e.agent_id = ANY(@agent_ids::uuid[]) AND e.channel <> 'test' AND e.created_at >= @from_at::timestamptz AND e.created_at <= @to_at::timestamptz;

-- Documents that existed when observation began and that no answer in the window cited.
-- name: ContentHealthNeverCited :many
WITH cited AS MATERIALIZED (
    SELECT DISTINCT doc FROM message_events e, unnest(e.cited_document_ids) AS doc
    WHERE e.agent_id = ANY(@agent_ids::uuid[]) AND e.channel <> 'test' AND e.created_at >= @observed_since::timestamptz AND e.created_at <= @as_of::timestamptz
)
SELECT d.id AS document_id, d.source_id, d.created_at::timestamptz AS created_at,
       EXISTS (SELECT 1 FROM kb_sources k JOIN knowledge_bases b ON b.id = k.kb_id WHERE k.source_id = d.source_id AND b.team_id = @team_id) AS in_kb,
       (count(*) OVER ())::bigint AS total
FROM documents d
WHERE d.team_id = @team_id AND d.source_id = ANY(@source_ids::uuid[]) AND d.status = 'ready'
  AND d.created_at <= @observed_since::timestamptz
  AND NOT EXISTS (SELECT 1 FROM cited c WHERE c.doc = d.id)
ORDER BY d.created_at, d.id
LIMIT @page_size;

-- Ready documents the not-cited signal could judge, and those too new to judge.
-- name: ContentHealthJudgeable :one
SELECT (count(*) FILTER (WHERE d.created_at <= @observed_since::timestamptz))::bigint AS judged,
       (count(*) FILTER (WHERE d.created_at > @observed_since::timestamptz))::bigint AS too_new
FROM documents d
WHERE d.team_id = @team_id AND d.source_id = ANY(@source_ids::uuid[]) AND d.status = 'ready';

-- Failed, needs-OCR and not-finished documents (the classes of Admin → Parsing & OCR, and not_finished).
-- name: ContentHealthIngestionFailures :many
SELECT d.id AS document_id, d.source_id, d.error_code::text AS error_code, d.updated_at::timestamptz AS updated_at,
       (CASE
            WHEN d.status IN ('pending', 'queued', 'processing') THEN 'not_finished'
            WHEN d.error_code = 'needs_ocr' THEN 'needs_ocr'
            WHEN d.error_code LIKE 'ocr\_%' ESCAPE '\' THEN 'ocr_error'
            WHEN d.error_code IN ('corrupt', 'encrypted', 'unsupported_format', 'too_large') THEN 'damaged'
            ELSE 'other'
        END)::text AS class,
       (count(*) OVER ())::bigint AS total
FROM documents d
WHERE d.team_id = @team_id AND d.source_id = ANY(@source_ids::uuid[])
  AND (d.status = 'failed'
       OR (d.error_code = 'needs_ocr' AND d.status IN ('skipped', 'ready'))
       OR (d.status IN ('pending', 'queued', 'processing') AND d.updated_at <= @not_finished_before::timestamptz
           AND (d.waiting_until IS NULL OR d.waiting_until <= @as_of::timestamptz)))
ORDER BY d.updated_at, d.id
LIMIT @page_size;

-- Each web source's latest completed crawl.
-- name: ContentHealthLatestCrawls :many
SELECT DISTINCT ON (c.source_id) c.id, c.source_id, c.trigger::text AS trigger, c.truncated, c.finished_at::timestamptz AS finished_at
FROM web_crawls c
WHERE c.source_id = ANY(@source_ids::uuid[]) AND c.status = 'completed' AND c.finished_at IS NOT NULL
ORDER BY c.source_id, c.finished_at DESC, c.id;

-- name: ContentHealthFrontierCount :one
SELECT count(*)::bigint FROM web_frontier WHERE crawl_id = $1;

-- The URLs a crawl tried and failed to fetch (its own record; skipped URLs are not failures).
-- name: ContentHealthFrontierFailures :many
SELECT f.url::text AS url, f.reason::text AS reason, f.http_status, f.updated_at::timestamptz AS failed_at, (count(*) OVER ())::bigint AS total
FROM web_frontier f
WHERE f.crawl_id = @crawl_id AND f.status = 'failed'
ORDER BY f.url
LIMIT @page_size;

-- ---- what a report stores --------------------------------------------------------------------

-- name: InsertContentHealthSource :exec
INSERT INTO content_health_sources (report_id, source_id, source_type, documents, ready, ready_no_date, ready_no_hash,
                                    link_state, link_reason, link_crawl_at, link_truncated, link_failed)
VALUES (@report_id, @source_id, @source_type, @documents, @ready, @ready_no_date, @ready_no_hash,
        @link_state, @link_reason, @link_crawl_at, @link_truncated, @link_failed)
ON CONFLICT (report_id, source_id) DO NOTHING;

-- Findings are inserted by internal/contenthealth (multi-array unnest, which sqlc cannot analyse).

-- ---- what a reader sees ----------------------------------------------------------------------

-- A page of findings, joined to the team's live sources and documents: one whose document or source is gone
-- (or is not this team's) is not returned. Names are read now, never from the snapshot.
-- name: ListContentHealthFindings :many
SELECT f.signal, f.ord, f.source_id, s.name AS source_name, s.type::text AS source_type, f.document_id, f.ref, f.group_no, f.group_size, f.code,
       f.detail, f.value, f.observed_at, f.confirmed_at, f.in_kb,
       coalesce(d.title, '')::text AS title, coalesce(d.filename, '')::text AS filename, coalesce(d.url, '')::text AS doc_url,
       coalesce(d.kind, '')::text AS kind, coalesce(d.updated_at > r.as_of, false)::bool AS changed_since
FROM content_health_findings f
JOIN content_health_reports r ON r.id = f.report_id AND r.team_id = f.team_id
JOIN data_sources s ON s.id = f.source_id AND s.team_id = f.team_id
LEFT JOIN documents d ON d.id = f.document_id AND d.source_id = f.source_id AND d.team_id = f.team_id
WHERE f.report_id = @report_id AND f.team_id = @team_id AND f.signal = @signal AND f.ord > @after_ord::int
  AND (f.document_id IS NULL OR d.id IS NOT NULL)
ORDER BY f.ord
LIMIT @page_size;

-- What is still listed, by signal (the same joins as the page).
-- name: CountContentHealthFindings :many
SELECT f.signal::text AS signal, count(*)::bigint AS listed
FROM content_health_findings f
JOIN data_sources s ON s.id = f.source_id AND s.team_id = f.team_id
LEFT JOIN documents d ON d.id = f.document_id AND d.source_id = f.source_id AND d.team_id = f.team_id
WHERE f.report_id = @report_id AND f.team_id = @team_id AND (f.document_id IS NULL OR d.id IS NOT NULL)
GROUP BY f.signal;

-- name: ListContentHealthSources :many
SELECT c.report_id, c.source_id, s.name AS source_name, c.source_type, c.documents, c.ready, c.ready_no_date, c.ready_no_hash, c.link_state,
       c.link_reason, c.link_crawl_at, c.link_truncated, c.link_failed
FROM content_health_sources c
JOIN content_health_reports r ON r.id = c.report_id
JOIN data_sources s ON s.id = c.source_id AND s.team_id = r.team_id
WHERE c.report_id = @report_id AND r.team_id = @team_id
ORDER BY s.name, c.source_id;
