-- name: InsertKB :one
INSERT INTO knowledge_bases (team_id, name, description, embedding_profile_id, top_k, vector_weight, keyword_weight, created_by)
VALUES (@team_id, @name, @description, @embedding_profile_id, @top_k, @vector_weight, @keyword_weight, @created_by)
RETURNING *;

-- name: GetKB :one
SELECT * FROM knowledge_bases WHERE id = $1;

-- name: LockKB :one
SELECT * FROM knowledge_bases WHERE id = $1 FOR UPDATE;

-- name: ListTeamKBs :many
SELECT * FROM knowledge_bases WHERE team_id = $1 ORDER BY lower(name), id;

-- name: UpdateKB :one
UPDATE knowledge_bases
SET name = @name, description = @description, top_k = @top_k,
    vector_weight = @vector_weight, keyword_weight = @keyword_weight, revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: DeleteKB :exec
DELETE FROM knowledge_bases WHERE id = $1;

-- name: KBSources :many
SELECT s.* FROM kb_sources ks JOIN data_sources s ON s.id = ks.source_id
WHERE ks.kb_id = $1 ORDER BY lower(s.name);

-- name: KBSourceRows :many
SELECT ks.kb_id, s.id, s.name, s.classification, cl.rank, (s.team_id IS NULL)::bool AS shared
FROM kb_sources ks
JOIN data_sources s ON s.id = ks.source_id
JOIN classification_levels cl ON cl.key = s.classification
WHERE ks.kb_id = ANY(@kb_ids::uuid[])
ORDER BY lower(s.name);

-- The default fusion weights of the KBs' embedding profiles (DESIGN.md §6).
-- name: KBProfileWeights :many
SELECT kb.id, p.default_vector_weight, p.default_keyword_weight
FROM knowledge_bases kb
JOIN embedding_profiles p ON p.id = kb.embedding_profile_id
WHERE kb.id = ANY(@kb_ids::uuid[]);

-- name: AttachSource :execrows
INSERT INTO kb_sources (kb_id, source_id, added_by) VALUES (@kb_id, @source_id, @added_by)
ON CONFLICT DO NOTHING;

-- name: DetachSource :execrows
DELETE FROM kb_sources WHERE kb_id = @kb_id AND source_id = @source_id;

-- name: LoadChunks :many
SELECT c.id, c.document_id, c.source_id, c.ordinal, c.content, c.heading_path, c.page_start, c.page_end,
       d.title, d.filename, d.url, d.external_id
FROM chunks c JOIN documents d ON d.id = c.document_id
WHERE c.id = ANY(@ids::uuid[]);
