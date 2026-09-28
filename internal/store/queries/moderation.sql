-- name: GetModerationPolicy :one
SELECT * FROM moderation_policies WHERE audience = $1;

-- name: LockModerationPolicy :one
SELECT * FROM moderation_policies WHERE audience = $1 FOR UPDATE;

-- name: InsertModerationPolicy :one
INSERT INTO moderation_policies (audience, model_id, policy, updated_by)
VALUES (@audience, @model_id, @policy, @updated_by)
ON CONFLICT (audience) DO NOTHING
RETURNING *;

-- name: UpdateModerationPolicy :one
UPDATE moderation_policies
SET model_id = @model_id, policy = @policy, updated_by = @updated_by,
    revision = revision + 1, updated_at = now()
WHERE audience = @audience
RETURNING *;
