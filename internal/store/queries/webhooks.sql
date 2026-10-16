-- Webhooks (v0.6.0, F3).

-- name: GetWebhookSettings :one
SELECT * FROM webhook_settings;

-- name: LockWebhookSettings :one
SELECT * FROM webhook_settings FOR UPDATE;

-- name: SetWebhookSettings :one
UPDATE webhook_settings SET enabled = $1, revision = revision + 1, updated_by = $2, updated_at = now() RETURNING *;

-- name: ListWebhookDestinations :many
SELECT * FROM webhook_destinations ORDER BY pattern;

-- name: InsertWebhookDestination :one
INSERT INTO webhook_destinations (pattern, note, created_by) VALUES ($1, $2, $3)
ON CONFLICT (pattern) DO NOTHING
RETURNING *;

-- name: DeleteWebhookDestination :one
DELETE FROM webhook_destinations WHERE id = $1 RETURNING *;

-- name: InsertWebhook :one
INSERT INTO webhooks (id, team_id, url, description, events, secret_cipher, secret_hint, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetWebhook :one
SELECT * FROM webhooks WHERE id = $1;

-- name: LockWebhook :one
SELECT * FROM webhooks WHERE id = $1 FOR UPDATE;

-- A team's webhooks (team_id set) or the platform's (NULL), oldest first.
-- name: ListWebhooks :many
SELECT * FROM webhooks WHERE team_id IS NOT DISTINCT FROM sqlc.narg(team_id)::uuid ORDER BY created_at, id;

-- name: CountWebhooks :one
SELECT count(*) FROM webhooks WHERE team_id IS NOT DISTINCT FROM sqlc.narg(team_id)::uuid;

-- The webhooks an event reaches: enabled, of the event's scope (its team, or the platform), subscribed to its type.
-- name: MatchingWebhooks :many
SELECT * FROM webhooks
WHERE enabled AND team_id IS NOT DISTINCT FROM sqlc.narg(team_id)::uuid AND @event_type::text = ANY (events)
ORDER BY created_at, id;

-- Turning a webhook on again clears what paused it and the count of deliveries that gave up.
-- name: UpdateWebhook :one
UPDATE webhooks
SET url = $2, description = $3, events = $4, enabled = $5,
    paused_reason = CASE WHEN $5 THEN '' ELSE paused_reason END,
    consecutive_failures = CASE WHEN $5 AND NOT enabled THEN 0 ELSE consecutive_failures END,
    revision = revision + 1, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetWebhookSecret :one
UPDATE webhooks SET secret_cipher = $2, secret_hint = $3, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteWebhook :one
DELETE FROM webhooks WHERE id = $1 RETURNING *;

-- A delivery succeeded: the count of deliveries that gave up starts again.
-- name: ResetWebhookFailures :exec
UPDATE webhooks SET consecutive_failures = 0 WHERE id = $1 AND consecutive_failures <> 0;

-- A delivery gave up; the webhook pauses at the limit, and the count says whether it just did.
-- name: RecordWebhookFailure :one
UPDATE webhooks
SET consecutive_failures = consecutive_failures + 1,
    enabled = CASE WHEN enabled AND consecutive_failures + 1 >= @pause_after::int THEN false ELSE enabled END,
    paused_reason = CASE WHEN enabled AND consecutive_failures + 1 >= @pause_after::int THEN 'failing' ELSE paused_reason END,
    updated_at = now()
WHERE id = @id
RETURNING *;

-- The receiver said it is gone (410): pause it.
-- name: PauseWebhookGone :one
UPDATE webhooks SET enabled = false, paused_reason = 'gone', updated_at = now() WHERE id = $1 RETURNING *;

-- name: InsertWebhookDelivery :one
INSERT INTO webhook_deliveries (webhook_id, event_id, event_type, payload) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: GetWebhookDelivery :one
SELECT * FROM webhook_deliveries WHERE id = $1;

-- A webhook's deliveries, newest first.
-- name: ListWebhookDeliveries :many
SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2;

-- name: RecordWebhookAttempt :exec
UPDATE webhook_deliveries
SET attempts = attempts + 1, last_status = $2, last_error = $3, last_attempt_at = now()
WHERE id = $1;

-- name: MarkWebhookDelivered :exec
UPDATE webhook_deliveries SET status = 'delivered', delivered_at = now() WHERE id = $1;

-- name: MarkWebhookDeliveryFailed :exec
UPDATE webhook_deliveries SET status = 'failed' WHERE id = $1;

-- name: PruneWebhookDeliveries :execrows
DELETE FROM webhook_deliveries WHERE created_at < $1;
