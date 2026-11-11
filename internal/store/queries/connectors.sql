-- The connector runtime (ADR-0035, #258; internal/sourcesync).

-- ---- a connector source ---------------------------------------------------------------

-- name: InsertSourceConnector :one
INSERT INTO source_connectors (id, schedule) VALUES (@id, @schedule) RETURNING *;

-- name: GetSourceConnector :one
SELECT * FROM source_connectors WHERE id = @id;

-- name: SourceConnectorsByIDs :many
SELECT * FROM source_connectors WHERE id = ANY(@ids::uuid[]);

-- name: SetSourceCredentials :one
UPDATE source_connectors SET credentials_cipher = @credentials_cipher, credentials_set_at = now(), credentials_set_by = @set_by
WHERE id = @id RETURNING *;

-- name: SetSourceSchedule :one
UPDATE source_connectors SET schedule = @schedule WHERE id = @id RETURNING *;

-- name: SetSourceCursor :exec
-- complete: the sync that produced the cursor listed everything.
UPDATE source_connectors SET cursor = sqlc.narg(cursor)::jsonb, cursor_at = now(),
    last_complete_at = CASE WHEN @complete::boolean THEN now() ELSE last_complete_at END
WHERE id = @id;

-- name: ClearSourceCursor :exec
-- The settings or credentials changed what the source selects: the next sync lists everything.
UPDATE source_connectors SET cursor = NULL, cursor_at = NULL WHERE id = @id;

-- name: DueConnectorSources :many
SELECT ds.* FROM data_sources ds JOIN source_connectors c ON c.id = ds.id
WHERE ds.status = 'active' AND ds.next_sync_at IS NOT NULL AND ds.next_sync_at <= now()
ORDER BY ds.next_sync_at
LIMIT 100
FOR UPDATE OF ds SKIP LOCKED;

-- ---- sync runs ------------------------------------------------------------------------

-- name: InsertSourceSync :one
INSERT INTO source_syncs (source_id, team_id, trigger, full_listing, created_by)
VALUES (@source_id, @team_id, @trigger, @full_listing, @created_by) RETURNING *;

-- name: GetSourceSync :one
SELECT * FROM source_syncs WHERE id = @id;

-- name: LockSourceSync :one
SELECT * FROM source_syncs WHERE id = @id FOR UPDATE;

-- name: ActiveSourceSync :one
SELECT * FROM source_syncs WHERE source_id = @source_id AND status IN ('queued', 'running');

-- name: ActiveSourceSyncs :many
SELECT * FROM source_syncs WHERE source_id = ANY(@source_ids::uuid[]) AND status IN ('queued', 'running');

-- name: ListSourceSyncs :many
SELECT * FROM source_syncs WHERE source_id = @source_id ORDER BY created_at DESC, id DESC LIMIT @page_size;

-- name: HeldSourceSyncs :many
-- Syncs whose removals wait for an editor, by source.
SELECT * FROM source_syncs WHERE source_id = ANY(@source_ids::uuid[]) AND removals = 'pending' ORDER BY created_at DESC;

-- name: StartSourceSync :one
UPDATE source_syncs SET status = 'running', started_at = COALESCE(started_at, now())
WHERE id = @id AND status IN ('queued', 'running') RETURNING *;

-- name: AddSourceSyncCounts :exec
UPDATE source_syncs SET items_added = items_added + @added, items_changed = items_changed + @changed,
    items_unchanged = items_unchanged + @unchanged, items_skipped = items_skipped + @skipped,
    permissions_changed = permissions_changed + @permissions_changed
WHERE id = @id;

-- name: SetSourceSyncCheckpoint :exec
UPDATE source_syncs SET checkpoint = @checkpoint::jsonb WHERE id = @id;

-- name: AddSourceSyncProblem :exec
UPDATE source_syncs SET problems = problems || jsonb_build_array(@problem::jsonb)
WHERE id = @id AND jsonb_array_length(problems) < 50;

-- name: FinishSourceSync :one
UPDATE source_syncs SET status = @status, error = @error, complete = @complete, items_removed = @items_removed,
    removals = @removals, removals_pending = @removals_pending, removals_reason = @removals_reason,
    stopped_reason = @stopped_reason, finished_at = now()
WHERE id = @id RETURNING *;

-- name: DecideSourceSyncRemovals :one
UPDATE source_syncs SET removals = @removals, removals_pending = 0, items_removed = items_removed + @removed
WHERE id = @id AND removals = 'pending' RETURNING *;

-- name: SupersedeHeldRemovals :exec
-- A new sync starts: what an earlier one held is decided again by the new listing.
WITH held AS (
    UPDATE source_syncs SET removals = 'superseded', removals_pending = 0
    WHERE source_id = @source_id AND removals = 'pending' RETURNING id
)
DELETE FROM source_sync_removals r USING held WHERE r.sync_id = held.id;

-- ---- documents ------------------------------------------------------------------------

-- name: UpsertConnectorDocument :one
-- Adds an item or replaces its content (a new version, processed again). set_acl: the connector reports permissions,
-- and principals NULL then means unrestricted. Without it a new document takes its source's hand-set restriction (the
-- insert trigger) and an existing one keeps what it has.
INSERT INTO documents (id, source_id, team_id, external_id, title, filename, url, content_type, size_bytes, sha256, blob_key,
                       external_version, http_last_modified, last_seen_sync_id, acl_principals, acl)
VALUES (@id, @source_id, @team_id, @external_id, @title, @filename, @url, @content_type, @size_bytes, @sha256, @blob_key,
        @external_version, @modified, @sync_id,
        CASE WHEN @set_acl::boolean THEN sqlc.narg(principals)::text[] END, CASE WHEN @set_acl::boolean THEN sqlc.narg(acl)::jsonb END)
ON CONFLICT (source_id, external_id) DO UPDATE
SET title = EXCLUDED.title, filename = EXCLUDED.filename, url = EXCLUDED.url, content_type = EXCLUDED.content_type,
    size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256, blob_key = EXCLUDED.blob_key,
    external_version = EXCLUDED.external_version, http_last_modified = EXCLUDED.http_last_modified,
    last_seen_sync_id = EXCLUDED.last_seen_sync_id,
    acl_principals = CASE WHEN @set_acl::boolean THEN EXCLUDED.acl_principals ELSE documents.acl_principals END,
    acl = CASE WHEN @set_acl::boolean THEN EXCLUDED.acl ELSE documents.acl END,
    version = documents.version + 1, status = 'pending', error_code = '', error_message = '',
    attempts = 0, waiting_until = NULL, updated_at = now()
RETURNING id, (xmax = 0) AS inserted;

-- name: TouchConnectorDocument :exec
-- An item whose content did not change: it was seen, and its name, address and version are kept current.
UPDATE documents SET last_seen_sync_id = @sync_id, title = @title, filename = @filename, url = @url,
    external_version = @external_version, http_last_modified = @modified
WHERE id = @id;

-- name: SetDocumentPermissions :execrows
-- A connector's permissions for one document (principals NULL: unrestricted). No row when nothing changes.
UPDATE documents SET acl_principals = sqlc.narg(principals)::text[], acl = sqlc.narg(acl)::jsonb, updated_at = now()
WHERE id = @id AND (acl_principals IS DISTINCT FROM sqlc.narg(principals)::text[] OR acl IS DISTINCT FROM sqlc.narg(acl)::jsonb);

-- name: CountSourceDocuments :one
SELECT count(*) FROM documents WHERE source_id = @source_id;

-- name: AddSyncRemoval :exec
INSERT INTO source_sync_removals (sync_id, document_id)
SELECT @sync_id, d.id FROM documents d WHERE d.source_id = @source_id AND d.external_id = @external_id
ON CONFLICT DO NOTHING;

-- name: DropSyncRemoval :exec
-- The item came back later in the same sync.
DELETE FROM source_sync_removals WHERE sync_id = @sync_id AND document_id = @document_id;

-- name: AddUnseenSyncRemovals :exec
-- What a complete listing did not mention is gone from the provider.
INSERT INTO source_sync_removals (sync_id, document_id)
SELECT @sync_id, d.id FROM documents d
WHERE d.source_id = @source_id AND d.last_seen_sync_id IS DISTINCT FROM @sync_id::uuid
ON CONFLICT DO NOTHING;

-- name: CountSyncRemovals :one
SELECT count(*) FROM source_sync_removals WHERE sync_id = @sync_id;

-- name: SyncRemovalSample :many
-- The first documents a sync would remove, for the editor deciding.
SELECT d.id, d.title, d.filename, d.url FROM source_sync_removals r JOIN documents d ON d.id = r.document_id
WHERE r.sync_id = @sync_id ORDER BY d.title, d.filename, d.id LIMIT @page_size;

-- name: DeleteSyncRemovals :many
DELETE FROM documents d USING source_sync_removals r
WHERE r.sync_id = @sync_id AND d.id = r.document_id
RETURNING d.id, d.created_at;

-- name: ClearSyncRemovals :exec
DELETE FROM source_sync_removals WHERE sync_id = @sync_id;

-- ---- a connector's own groups -----------------------------------------------------------

-- name: DeleteSourceGroup :exec
DELETE FROM source_group_members WHERE source_id = @source_id AND group_id = @group_id;

-- name: InsertSourceGroupMembers :exec
INSERT INTO source_group_members (source_id, group_id, principal)
SELECT @source_id, @group_id, p FROM unnest(@principals::text[]) AS p
ON CONFLICT DO NOTHING;

-- name: DeleteSourceGroupsExcept :execrows
-- After a complete sync: the groups it did not set no longer exist in the provider.
DELETE FROM source_group_members WHERE source_id = @source_id AND NOT (group_id = ANY(@keep::text[]));

-- name: CountSourceGroups :one
SELECT count(DISTINCT group_id) FROM source_group_members WHERE source_id = @source_id;

-- name: SetSourceConfig :one
-- A connector source's settings changed (its credentials or schedule alone still make a new revision, so an editor's
-- If-Match is refused after any change).
UPDATE data_sources SET config = @config, revision = revision + 1, updated_at = now() WHERE id = @id RETURNING *;
