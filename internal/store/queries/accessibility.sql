-- name: GetAccessibilitySettings :one
SELECT * FROM accessibility_settings;
-- name: LockAccessibilitySettings :one
SELECT * FROM accessibility_settings FOR UPDATE;
-- name: UpdateAccessibilitySettings :one
UPDATE accessibility_settings SET contact_url=$1, institution_url=$2,
 revision=revision+1, updated_by=$3, updated_at=now() RETURNING *;
