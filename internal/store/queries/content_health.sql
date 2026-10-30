-- The content health report (docs/content-health.md, ADR-0027). Every read of a team's data names the team, so
-- a report can never join across teams. Collection runs in a read-only, repeatable-read transaction per signal under a
-- client context deadline (not a server statement_timeout). The event cap applies before outcome filtering.

-- ---- the platform switch ---------------------------------------------------------------------

-- name: GetContentHealthSettings :one
SELECT * FROM content_health_settings;

-- Read under a share lock, so a report's store and the switch being turned off are ordered: the switch's own update waits.
-- name: GetContentHealthSettingsShare :one
SELECT * FROM content_health_settings FOR SHARE;

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

-- Claims a running report for its store: a cancel or a delete of it waits until the store commits, and a report that is no
-- longer running (cancelled, deleted, or removed with its team) is not claimed (no rows).
-- name: ClaimContentHealthReport :one
SELECT id FROM content_health_reports WHERE id = $1 AND status = 'running' FOR UPDATE;

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

-- The team's own sources in the scope (never a platform-shared one: team_id is the team's), with the revision and classification
-- the report saw them at.
-- name: ContentHealthScopeSources :many
SELECT s.id, s.type::text AS type, s.revision, s.classification::text AS classification
FROM data_sources s
WHERE s.team_id = @team_id
  AND (sqlc.narg(source_id)::uuid IS NULL OR s.id = sqlc.narg(source_id)::uuid)
  AND (sqlc.narg(kb_id)::uuid IS NULL OR EXISTS (
        SELECT 1 FROM kb_sources k JOIN knowledge_bases b ON b.id = k.kb_id
        WHERE k.source_id = s.id AND k.kb_id = sqlc.narg(kb_id)::uuid AND b.team_id = @team_id))
ORDER BY s.id
LIMIT @page_size;

-- The scope's sources that still exist, locked against deletion until the store commits (a source deleted meanwhile is skipped,
-- never a foreign key error). In id order, so two stores cannot deadlock.
-- name: ContentHealthLockScopeSources :many
SELECT s.id
FROM data_sources s
WHERE s.team_id = @team_id AND s.id = ANY(@source_ids::uuid[])
  AND (sqlc.narg(source_id)::uuid IS NULL OR s.id = sqlc.narg(source_id)::uuid)
  AND (sqlc.narg(kb_id)::uuid IS NULL OR EXISTS (
        SELECT 1 FROM kb_sources k JOIN knowledge_bases b ON b.id = k.kb_id
        WHERE k.source_id = s.id AND k.kb_id = sqlc.narg(kb_id)::uuid AND b.team_id = @team_id))
ORDER BY s.id
FOR KEY SHARE OF s;

-- The documents a snapshot refers to that still exist in their source, locked the same way.
-- name: ContentHealthLockDocuments :many
SELECT d.id, d.source_id
FROM documents d
WHERE d.team_id = @team_id AND d.id = ANY(@document_ids::uuid[])
ORDER BY d.id
FOR KEY SHARE OF d;

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
       (count(*) OVER ())::bigint AS total,
       -- Pages a crawl saw again after the cutoff: old by processing date, but confirmed by a recent crawl.
       (count(*) FILTER (WHERE (SELECT c.finished_at FROM web_crawls c WHERE c.id = d.last_seen_crawl_id) > @cutoff::timestamptz) OVER ())::bigint AS recently_confirmed
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

-- The team's agents (deleted ones too: their kept events are still the team's), in a fixed order. The caller asks for one more
-- than its cap, so more agents than the cap is detected, never silently cut.
-- name: ContentHealthTeamAgents :many
SELECT id FROM agents WHERE team_id = @team_id ORDER BY id LIMIT @cap::int;

-- Bound ALL non-test events before outcome filtering: refusal/error traffic also costs work in subsequent citation reads.
-- Within that bound, only answers that could cite count toward the minimum. The observation window starts at the earliest
-- retained non-test event, even if that event cannot count toward the minimum. The caller uses one repeatable-read snapshot
-- for the preflight and all subsequent exposure/citation queries, so a later commit cannot bypass this bound.
-- name: ContentHealthAnswerCount :one
SELECT count(*)::bigint AS events,
       (count(*) FILTER (WHERE x.error_code = '' AND NOT x.refused AND NOT x.no_context AND x.hit_count > 0
          AND coalesce(x.moderation_input->>'decision', '') NOT IN ('block', 'support')
          AND coalesce(x.moderation_output->>'decision', '') NOT IN ('block', 'support')))::bigint AS answers,
       coalesce(min(x.created_at), 'epoch'::timestamptz)::timestamptz AS first_at
FROM (SELECT e.created_at, e.error_code, e.refused, e.no_context, e.hit_count, e.moderation_input, e.moderation_output
      FROM message_events e
      WHERE e.agent_id = ANY(@agent_ids::uuid[]) AND e.channel <> 'test' AND e.created_at >= @from_at::timestamptz AND e.created_at <= @to_at::timestamptz
      LIMIT @cap_plus_one::int) x;

-- Per source of the scope: whether an active, published agent of the team reaches it through a knowledge base, since when (the
-- later of the source's attachment to the knowledge base and the agent's publish time, as the next UTC day: a conservative
-- bound, never earlier than the facts), and how many answers of such agents were kept after that. A source no agent reaches has
-- no row. Events are summed by agent and UTC day first, so the work follows the agents and days, not the answers.
-- name: ContentHealthSourceExposure :many
WITH pairs AS (
    SELECT ks.source_id, a.id AS agent_id, min(greatest(ks.created_at, v.published_at)) AS since
    FROM agents a
    JOIN agent_versions v ON v.id = a.published_version_id
    JOIN agent_version_kbs vk ON vk.version_id = v.id
    JOIN knowledge_bases b ON b.id = vk.kb_id AND b.team_id = a.team_id
    JOIN kb_sources ks ON ks.kb_id = b.id
    WHERE a.team_id = @team_id AND a.deleted_at IS NULL AND a.status = 'active' AND ks.source_id = ANY(@source_ids::uuid[])
    GROUP BY ks.source_id, a.id
), daily AS (
    SELECT e.agent_id, (e.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n
    FROM message_events e
    WHERE e.agent_id IN (SELECT agent_id FROM pairs) AND e.channel <> 'test' AND e.created_at >= @from_at::timestamptz AND e.created_at <= @to_at::timestamptz
      AND e.error_code = '' AND NOT e.refused AND NOT e.no_context AND e.hit_count > 0
      AND coalesce(e.moderation_input->>'decision', '') NOT IN ('block', 'support') AND coalesce(e.moderation_output->>'decision', '') NOT IN ('block', 'support')
    GROUP BY 1, 2
)
SELECT p.source_id,
       ((((min(p.since) AT TIME ZONE 'UTC')::date + 1)::timestamp) AT TIME ZONE 'UTC')::timestamptz AS exposed_from,
       (count(DISTINCT p.agent_id))::int AS agents,
       coalesce(sum(d.n), 0)::bigint AS answers
FROM pairs p
LEFT JOIN daily d ON d.agent_id = p.agent_id AND d.day > (p.since AT TIME ZONE 'UTC')::date
GROUP BY p.source_id
ORDER BY p.source_id;

-- Ready documents of the sources the signal may judge (@eligible_sources, each with the time its exposure began and the answers
-- since) that existed then and that no retained answer cited in the observation window.
-- name: ContentHealthNeverCited :many
WITH elig AS (
    SELECT unnest(@eligible_sources::uuid[]) AS source_id, unnest(@eligible_from::timestamptz[]) AS from_at, unnest(@eligible_answers::int[]) AS answers
), cited AS MATERIALIZED (
    SELECT DISTINCT doc FROM message_events e, unnest(e.cited_document_ids) AS doc
    WHERE e.agent_id = ANY(@agent_ids::uuid[]) AND e.channel <> 'test' AND e.created_at >= @observed_since::timestamptz AND e.created_at <= @as_of::timestamptz
)
SELECT d.id AS document_id, d.source_id, d.created_at::timestamptz AS created_at, l.answers::bigint AS answers,
       (count(*) OVER ())::bigint AS total
FROM documents d
JOIN elig l ON l.source_id = d.source_id
WHERE d.team_id = @team_id AND d.status = 'ready' AND d.created_at <= l.from_at
  AND NOT EXISTS (SELECT 1 FROM cited c WHERE c.doc = d.id)
ORDER BY d.created_at, d.id
LIMIT @page_size;

-- Ready documents of the judged sources that existed when their exposure began, and those added later (too new to judge).
-- name: ContentHealthJudgeable :one
SELECT (count(*) FILTER (WHERE d.created_at <= l.from_at))::bigint AS judged,
       (count(*) FILTER (WHERE d.created_at > l.from_at))::bigint AS too_new
FROM documents d
JOIN (SELECT unnest(@eligible_sources::uuid[]) AS source_id, unnest(@eligible_from::timestamptz[]) AS from_at) l ON l.source_id = d.source_id
WHERE d.team_id = @team_id AND d.status = 'ready';

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

-- The URLs a crawl tried and failed to fetch (its own record; skipped URLs are not failures), as the report may keep them: without
-- credentials (userinfo), query or fragment, each address once. The path may still hold something sensitive: the report says so.
-- name: ContentHealthFrontierFailures :many
SELECT d.url::text AS url, d.reason::text AS reason, d.http_status, d.failed_at::timestamptz AS failed_at, (count(*) OVER ())::bigint AS total
FROM (SELECT DISTINCT ON (s.url) s.url, s.reason, s.http_status, s.failed_at
      FROM (SELECT regexp_replace(regexp_replace(f.url, '[?#].*$', ''), '^([A-Za-z][A-Za-z0-9+.-]*://)[^/]*@', '\1') AS url, f.url AS raw,
                   f.reason, f.http_status, f.updated_at AS failed_at
            FROM web_frontier f WHERE f.crawl_id = @crawl_id AND f.status = 'failed') s
      ORDER BY s.url, s.raw) d
ORDER BY d.url
LIMIT @page_size;

-- ---- what a report stores --------------------------------------------------------------------

-- name: InsertContentHealthSource :exec
INSERT INTO content_health_sources (report_id, source_id, source_type, documents, ready, ready_no_date, ready_no_hash,
                                    link_state, link_reason, link_crawl_at, link_truncated, link_failed, link_crawl_id,
                                    source_revision, source_classification, cite_state, exposed_since, exposure_answers)
VALUES (@report_id, @source_id, @source_type, @documents, @ready, @ready_no_date, @ready_no_hash,
        @link_state, @link_reason, @link_crawl_at, @link_truncated, @link_failed, @link_crawl_id,
        @source_revision, @source_classification, @cite_state, @exposed_since, @exposure_answers)
ON CONFLICT (report_id, source_id) DO NOTHING;

-- Findings are inserted by internal/contenthealth (multi-array unnest, which sqlc cannot analyse).

-- ---- what a reader sees ----------------------------------------------------------------------
--
-- A snapshot is a record of one moment. Every read joins it to the team's rows as they are NOW and shows a finding only while
-- it still holds: its source and document exist and are this team's, its source is still inside the report's scope (the
-- source, or the knowledge base it was chosen by), a broken link's source still has the revision and classification the crawl
-- was read at and no newer completed crawl has replaced that observation, and a duplicate still shares its bytes with a
-- document of a different source of the report. Names are read now, never from the snapshot.

-- A page of one signal's findings.
-- name: ListContentHealthFindings :many
WITH live AS (
    SELECT f.signal, f.ord, f.source_id, s.name AS source_name, s.type::text AS source_type, f.document_id, f.ref, f.group_no, f.group_size,
           f.code, f.detail, f.value, f.observed_at, f.confirmed_at,
           coalesce(d.title, '')::text AS title, coalesce(d.filename, '')::text AS filename, coalesce(d.url, '')::text AS doc_url,
           coalesce(d.kind, '')::text AS kind, coalesce(d.updated_at > r.as_of, false)::bool AS changed_since,
           coalesce(d.status, '')::text AS doc_status, coalesce(d.sha256, '')::text AS doc_sha
    FROM content_health_findings f
    JOIN content_health_reports r ON r.id = f.report_id AND r.team_id = f.team_id
    JOIN data_sources s ON s.id = f.source_id AND s.team_id = f.team_id
    LEFT JOIN content_health_sources c ON c.report_id = f.report_id AND c.source_id = f.source_id
    LEFT JOIN documents d ON d.id = f.document_id AND d.source_id = f.source_id AND d.team_id = f.team_id
    WHERE f.report_id = @report_id AND f.team_id = @team_id AND f.signal = @signal
      AND (f.document_id IS NULL OR d.id IS NOT NULL)
      AND (r.scope_source_id IS NULL OR r.scope_source_id = f.source_id)
      AND (r.scope_kb_id IS NULL OR EXISTS (SELECT 1 FROM kb_sources k JOIN knowledge_bases b ON b.id = k.kb_id
                                            WHERE k.kb_id = r.scope_kb_id AND k.source_id = f.source_id AND b.team_id = r.team_id))
      AND (f.signal <> 'broken_link' OR (c.source_revision = s.revision AND c.source_classification = s.classification
           AND c.link_crawl_id IS NOT DISTINCT FROM (SELECT w.id FROM web_crawls w WHERE w.source_id = c.source_id AND w.status = 'completed'
                                                     AND w.finished_at IS NOT NULL ORDER BY w.finished_at DESC, w.id LIMIT 1)))
), dup AS (
    SELECT l.group_no, l.doc_sha FROM live l
    WHERE l.signal = 'duplicate' AND l.doc_status = 'ready' AND l.doc_sha <> ''
    GROUP BY l.group_no, l.doc_sha HAVING count(DISTINCT l.source_id) >= 2
)
SELECT l.signal, l.ord, l.source_id, l.source_name, l.source_type, l.document_id, l.ref, l.group_no, l.group_size, l.code, l.detail, l.value,
       l.observed_at, l.confirmed_at, l.title, l.filename, l.doc_url, l.kind, l.changed_since
FROM live l
WHERE l.ord > @after_ord::int
  AND (l.signal <> 'duplicate' OR EXISTS (SELECT 1 FROM dup x WHERE x.group_no = l.group_no AND x.doc_sha = l.doc_sha AND l.doc_status = 'ready'))
ORDER BY l.ord
LIMIT @page_size;

-- What is still listed, by signal (the same rules as the page): findings, and for duplicates groups, which still span at
-- least two of the report's sources.
-- name: CountContentHealthFindings :many
WITH live AS (
    SELECT f.signal, f.group_no, f.source_id, coalesce(d.status, '')::text AS doc_status, coalesce(d.sha256, '')::text AS doc_sha
    FROM content_health_findings f
    JOIN content_health_reports r ON r.id = f.report_id AND r.team_id = f.team_id
    JOIN data_sources s ON s.id = f.source_id AND s.team_id = f.team_id
    LEFT JOIN content_health_sources c ON c.report_id = f.report_id AND c.source_id = f.source_id
    LEFT JOIN documents d ON d.id = f.document_id AND d.source_id = f.source_id AND d.team_id = f.team_id
    WHERE f.report_id = @report_id AND f.team_id = @team_id
      AND (f.document_id IS NULL OR d.id IS NOT NULL)
      AND (r.scope_source_id IS NULL OR r.scope_source_id = f.source_id)
      AND (r.scope_kb_id IS NULL OR EXISTS (SELECT 1 FROM kb_sources k JOIN knowledge_bases b ON b.id = k.kb_id
                                            WHERE k.kb_id = r.scope_kb_id AND k.source_id = f.source_id AND b.team_id = r.team_id))
      AND (f.signal <> 'broken_link' OR (c.source_revision = s.revision AND c.source_classification = s.classification
           AND c.link_crawl_id IS NOT DISTINCT FROM (SELECT w.id FROM web_crawls w WHERE w.source_id = c.source_id AND w.status = 'completed'
                                                     AND w.finished_at IS NOT NULL ORDER BY w.finished_at DESC, w.id LIMIT 1)))
), dup AS (
    SELECT l.group_no, l.doc_sha FROM live l
    WHERE l.signal = 'duplicate' AND l.doc_status = 'ready' AND l.doc_sha <> ''
    GROUP BY l.group_no, l.doc_sha HAVING count(DISTINCT l.source_id) >= 2
)
SELECT l.signal::text AS signal,
       (CASE WHEN l.signal = 'duplicate' THEN count(DISTINCT l.group_no) ELSE count(*) END)::bigint AS listed
FROM live l
WHERE l.signal <> 'duplicate' OR EXISTS (SELECT 1 FROM dup x WHERE x.group_no = l.group_no AND x.doc_sha = l.doc_sha AND l.doc_status = 'ready')
GROUP BY l.signal;

-- The sources the report covered that are still in its scope, with whether their URLs are still shown: 'current', 'source_changed'
-- (revision or classification changed since the crawl was read), 'crawl_changed' (a newer completed crawl exists), or 'none' (no
-- URLs were observed).
-- name: ListContentHealthSources :many
SELECT c.report_id, c.source_id, s.name AS source_name, c.source_type, c.documents, c.ready, c.ready_no_date, c.ready_no_hash, c.link_state,
       c.link_reason, c.link_crawl_at, c.link_truncated, c.link_failed, c.cite_state, c.exposed_since, c.exposure_answers,
       (CASE WHEN c.link_state <> 'observed' THEN 'none'
             WHEN c.source_revision <> s.revision OR c.source_classification <> s.classification THEN 'source_changed'
             WHEN c.link_crawl_id IS DISTINCT FROM (SELECT w.id FROM web_crawls w WHERE w.source_id = c.source_id AND w.status = 'completed'
                                                    AND w.finished_at IS NOT NULL ORDER BY w.finished_at DESC, w.id LIMIT 1) THEN 'crawl_changed'
             ELSE 'current' END)::text AS link_refs
FROM content_health_sources c
JOIN content_health_reports r ON r.id = c.report_id
JOIN data_sources s ON s.id = c.source_id AND s.team_id = r.team_id
WHERE c.report_id = @report_id AND r.team_id = @team_id
  AND (r.scope_source_id IS NULL OR r.scope_source_id = c.source_id)
  AND (r.scope_kb_id IS NULL OR EXISTS (SELECT 1 FROM kb_sources k JOIN knowledge_bases b ON b.id = k.kb_id
                                        WHERE k.kb_id = r.scope_kb_id AND k.source_id = c.source_id AND b.team_id = r.team_id))
ORDER BY s.name, c.source_id;
