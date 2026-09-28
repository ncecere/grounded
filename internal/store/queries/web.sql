-- ---- allowlist and domain requests -------------------------------------

-- name: ListAllowlist :many
SELECT * FROM crawl_allowlist ORDER BY pattern;

-- name: InsertAllowlist :one
INSERT INTO crawl_allowlist (pattern, note, created_by) VALUES (@pattern, @note, @created_by) RETURNING *;

-- name: DeleteAllowlist :one
DELETE FROM crawl_allowlist WHERE id = $1 RETURNING *;

-- name: ApprovedTeamPatterns :many
SELECT pattern FROM crawl_domain_requests WHERE team_id = $1 AND status = 'approved';

-- name: InsertDomainRequest :one
INSERT INTO crawl_domain_requests (team_id, pattern, reason, requested_by)
VALUES (@team_id, @pattern, @reason, @requested_by)
RETURNING *;

-- Requests with the requester's and reviewer's names ('' when the user
-- no longer exists).
-- name: ListTeamDomainRequests :many
SELECT r.*, t.slug AS team_slug, t.name AS team_name,
       coalesce(ru.display_name, '')::text AS requester_name, coalesce(ru.email::text, '')::text AS requester_email,
       coalesce(rv.display_name, '')::text AS reviewer_name, coalesce(rv.email::text, '')::text AS reviewer_email
FROM crawl_domain_requests r JOIN teams t ON t.id = r.team_id
LEFT JOIN users ru ON ru.id = r.requested_by
LEFT JOIN users rv ON rv.id = r.reviewed_by
WHERE r.team_id = $1
ORDER BY r.created_at DESC;

-- name: ListDomainRequests :many
SELECT r.*, t.slug AS team_slug, t.name AS team_name,
       coalesce(ru.display_name, '')::text AS requester_name, coalesce(ru.email::text, '')::text AS requester_email,
       coalesce(rv.display_name, '')::text AS reviewer_name, coalesce(rv.email::text, '')::text AS reviewer_email
FROM crawl_domain_requests r JOIN teams t ON t.id = r.team_id
LEFT JOIN users ru ON ru.id = r.requested_by
LEFT JOIN users rv ON rv.id = r.reviewed_by
WHERE (sqlc.narg(status)::text IS NULL OR r.status = sqlc.narg(status)::text)
ORDER BY (r.status = 'pending') DESC, r.created_at DESC
LIMIT 500;

-- name: GetDomainRequestView :one
SELECT r.*, t.slug AS team_slug, t.name AS team_name,
       coalesce(ru.display_name, '')::text AS requester_name, coalesce(ru.email::text, '')::text AS requester_email,
       coalesce(rv.display_name, '')::text AS reviewer_name, coalesce(rv.email::text, '')::text AS reviewer_email
FROM crawl_domain_requests r JOIN teams t ON t.id = r.team_id
LEFT JOIN users ru ON ru.id = r.requested_by
LEFT JOIN users rv ON rv.id = r.reviewed_by
WHERE r.id = $1;

-- name: LockDomainRequest :one
SELECT * FROM crawl_domain_requests WHERE id = $1 FOR UPDATE;

-- name: ReviewDomainRequest :one
UPDATE crawl_domain_requests
SET status = @status, reviewed_by = @reviewed_by, review_note = @review_note, reviewed_at = now()
WHERE id = @id
RETURNING *;

-- ---- crawls -------------------------------------------------------------------

-- name: InsertCrawl :one
INSERT INTO web_crawls (source_id, team_id, trigger, config, created_by, waiting_reason)
VALUES (@source_id, @team_id, @trigger, @config, @created_by, @waiting_reason)
RETURNING *;

-- name: GetCrawl :one
SELECT * FROM web_crawls WHERE id = $1;

-- name: LockCrawl :one
SELECT * FROM web_crawls WHERE id = $1 FOR UPDATE;

-- name: ActiveCrawl :one
SELECT * FROM web_crawls WHERE source_id = $1 AND status IN ('queued', 'running');

-- name: ActiveCrawlsForSources :many
SELECT * FROM web_crawls WHERE source_id = ANY(@source_ids::uuid[]) AND status IN ('queued', 'running');

-- name: ListSourceCrawls :many
SELECT * FROM web_crawls WHERE source_id = $1 ORDER BY created_at DESC LIMIT @page_size;

-- Only a queued run starts: a run cancelled (or finished) after the worker
-- read it must not be revived.
-- name: StartCrawl :execrows
UPDATE web_crawls SET status = 'running', started_at = coalesce(started_at, now()) WHERE id = $1 AND status = 'queued';

-- name: AddCrawlCounts :exec
UPDATE web_crawls
SET pages_discovered = pages_discovered + @discovered, pages_fetched = pages_fetched + @fetched,
    pages_changed = pages_changed + @changed, pages_unchanged = pages_unchanged + @unchanged,
    pages_skipped = pages_skipped + @skipped, pages_failed = pages_failed + @failed,
    truncated = truncated OR @truncated
WHERE id = @id;

-- name: SetCrawlWaiting :exec
UPDATE web_crawls SET waiting_reason = @waiting_reason, waiting_until = @waiting_until
WHERE id = @id AND status IN ('queued', 'running');

-- The first reason a run stopped early is kept.
-- name: MarkCrawlTruncated :exec
UPDATE web_crawls
SET truncated = true, truncated_reason = CASE WHEN truncated_reason = '' THEN @reason::text ELSE truncated_reason END
WHERE id = @id;

-- Runs waiting for a crawl slot, oldest first.
-- name: WaitingCrawls :many
SELECT * FROM web_crawls
WHERE team_id = @team_id AND status = 'queued' AND waiting_reason = 'concurrent_crawls'
ORDER BY created_at, id
LIMIT @page_size;

-- name: AdmitCrawl :execrows
UPDATE web_crawls SET waiting_reason = ''
WHERE id = $1 AND status = 'queued' AND waiting_reason = 'concurrent_crawls';

-- name: TeamsWithWaitingCrawls :many
SELECT DISTINCT team_id FROM web_crawls
WHERE status = 'queued' AND waiting_reason = 'concurrent_crawls' AND team_id IS NOT NULL
LIMIT 1000;

-- Only an active run can finish; a run cancelled meanwhile stays cancelled.
-- name: FinishCrawl :execrows
UPDATE web_crawls
SET status = @status, error = @error, documents_deleted = @documents_deleted, finished_at = now(),
    waiting_reason = '', waiting_until = NULL
WHERE id = @id AND status IN ('queued', 'running');

-- name: CountFrontier :one
SELECT count(*) FROM web_frontier WHERE crawl_id = $1;

-- name: PendingFrontierExists :one
SELECT EXISTS (SELECT 1 FROM web_frontier WHERE crawl_id = $1 AND status = 'pending');

-- name: InsertFrontier :execrows
INSERT INTO web_frontier (crawl_id, url, depth)
SELECT @crawl_id, u, @depth FROM unnest(@urls::text[]) AS u
ON CONFLICT DO NOTHING;

-- A redirect target fetched under another URL is recorded as done, so it
-- is not fetched again in the same run.
-- name: MarkFrontierFetched :exec
INSERT INTO web_frontier (crawl_id, url, depth, status)
VALUES (@crawl_id, @url, @depth, 'done')
ON CONFLICT (crawl_id, url) DO UPDATE SET status = 'done', updated_at = now()
WHERE web_frontier.status = 'pending';

-- name: NextFrontier :many
SELECT url, depth FROM web_frontier
WHERE crawl_id = @crawl_id AND status = 'pending'
ORDER BY depth, created_at, url
LIMIT @page_size
FOR UPDATE SKIP LOCKED;

-- name: MarkFrontier :exec
UPDATE web_frontier SET status = @status, reason = @reason, http_status = @http_status, updated_at = now()
WHERE crawl_id = @crawl_id AND url = @url;

-- ---- web documents ---------------------------------------------------------------

-- name: UpsertWebDocument :one
INSERT INTO documents (id, source_id, team_id, external_id, url, content_type, size_bytes, sha256, blob_key,
                       http_etag, http_last_modified, last_seen_crawl_id, tags)
VALUES (@id, @source_id, @team_id, @external_id, @url, @content_type, @size_bytes, @sha256, @blob_key,
        @http_etag, @http_last_modified, @crawl_id, @tags)
ON CONFLICT (source_id, external_id) DO UPDATE
SET url = EXCLUDED.url, tags = EXCLUDED.tags, content_type = EXCLUDED.content_type, size_bytes = EXCLUDED.size_bytes,
    sha256 = EXCLUDED.sha256, blob_key = EXCLUDED.blob_key, http_etag = EXCLUDED.http_etag,
    http_last_modified = EXCLUDED.http_last_modified, last_seen_crawl_id = EXCLUDED.last_seen_crawl_id,
    version = documents.version + 1, status = 'pending', error_code = '', error_message = '',
    attempts = 0, updated_at = now()
RETURNING *;

-- name: MarkDocumentSeen :exec
UPDATE documents SET last_seen_crawl_id = @crawl_id,
    http_etag = CASE WHEN @http_etag::text = '' THEN http_etag ELSE @http_etag::text END,
    http_last_modified = CASE WHEN @http_last_modified::text = '' THEN http_last_modified ELSE @http_last_modified::text END
WHERE id = @id;

-- Pages not seen by a completed, untruncated crawl no longer exist on the site.
-- name: DeleteUnseenDocuments :many
DELETE FROM documents
WHERE source_id = @source_id AND (last_seen_crawl_id IS NULL OR last_seen_crawl_id <> @crawl_id)
RETURNING id, blob_key, created_at;

-- ---- scheduling -------------------------------------------------------------------

-- name: DueWebSources :many
SELECT * FROM data_sources
WHERE type = 'web' AND status = 'active' AND next_sync_at IS NOT NULL AND next_sync_at <= now()
ORDER BY next_sync_at
LIMIT 100
FOR UPDATE SKIP LOCKED;

-- name: SetNextSync :exec
UPDATE data_sources SET next_sync_at = @next_sync_at, last_sync_at = coalesce(@last_sync_at, last_sync_at) WHERE id = @id;

-- Frontiers of finished earlier runs are only diagnostic; the latest is kept.
-- name: PruneFrontiers :exec
DELETE FROM web_frontier
WHERE crawl_id IN (SELECT id FROM web_crawls
                   WHERE source_id = @source_id AND id <> @keep_crawl_id AND status NOT IN ('queued', 'running'));

-- ---- first-run seed ----------------------------------------------------------

-- Returns 1 for the caller that records the step first, 0 afterwards.
-- name: InsertBootstrapState :execrows
INSERT INTO bootstrap_state (key, details) VALUES (@key, @details) ON CONFLICT DO NOTHING;

-- name: SeedAllowlist :one
INSERT INTO crawl_allowlist (pattern, note) VALUES (@pattern, @note)
ON CONFLICT (pattern) DO NOTHING
RETURNING *;

-- name: CountPendingDomainRequests :one
SELECT count(*) FROM crawl_domain_requests WHERE status = 'pending';
