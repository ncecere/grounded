-- Key rotation (docs/phase5-deploy.md E10, docs/operations/rotate-keys.md).

-- name: RehashAPIKey :execrows
-- Moves a key's digest to the current pepper, or records the pepper of a
-- digest from before pepper ids. The old digest guards against a
-- concurrent change.
UPDATE api_keys SET secret_hash = @secret_hash, pepper_id = @pepper_id
WHERE id = @id AND secret_hash = @old_hash;

-- name: RehashPublishableKey :execrows
UPDATE publishable_keys SET secret_hash = @secret_hash, pepper_id = @pepper_id
WHERE id = @id AND secret_hash = @old_hash;

-- name: LabelLegacyAPIKeys :execrows
-- Records the pepper of digests from before pepper ids (NULL): during a
-- rotation that is the previous pepper (docs/operations/rotate-keys.md).
UPDATE api_keys SET pepper_id = @pepper_id WHERE pepper_id IS NULL;

-- name: LabelLegacyPublishableKeys :execrows
UPDATE publishable_keys SET pepper_id = @pepper_id WHERE pepper_id IS NULL;

-- name: KeysNotOnPepper :many
-- Usable API keys (not revoked or expired) and widget keys (not revoked, on
-- a live agent) whose digest is not recorded as made with the given pepper.
SELECT 'api_key'::text AS kind, k.id, k.name, k.pepper_id, t.slug AS team_slug, t.name AS team_name,
       ''::text AS agent_name, k.last_used_at, k.created_at
FROM api_keys k JOIN teams t ON t.id = k.team_id
WHERE k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
  AND k.pepper_id IS DISTINCT FROM @pepper_id::bytea
UNION ALL
SELECT 'publishable_key'::text, p.id, p.name, p.pepper_id, t.slug, t.name, a.name, p.last_used_at, p.created_at
FROM publishable_keys p JOIN teams t ON t.id = p.team_id JOIN agents a ON a.id = p.agent_id
WHERE p.revoked_at IS NULL AND a.deleted_at IS NULL
  AND p.pepper_id IS DISTINCT FROM @pepper_id::bytea
ORDER BY team_slug, kind, name, id;
