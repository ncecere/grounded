-- name: GetSystemOneSettings :one
SELECT * FROM systemone_settings WHERE singleton;

-- name: LockSystemOneSettings :one
SELECT * FROM systemone_settings WHERE singleton FOR UPDATE;

-- name: InsertSystemOneSettings :one
INSERT INTO systemone_settings (model_id, settings, updated_by)
VALUES (@model_id, @settings, @updated_by)
ON CONFLICT (singleton) DO NOTHING
RETURNING *;

-- name: UpdateSystemOneSettings :one
UPDATE systemone_settings
SET model_id = @model_id, settings = @settings, updated_by = @updated_by,
    revision = revision + 1, updated_at = now()
WHERE singleton
RETURNING *;
