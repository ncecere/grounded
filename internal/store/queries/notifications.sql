-- Notifications (docs/phase4-publishing.md §8).

-- Records an event. With a dedupe key already used it returns no row.
-- name: InsertNotificationEvent :one
INSERT INTO notification_events (type, team_id, actor_id, title, body, link, data, dedupe_key)
VALUES (@type, @team_id, @actor_id, @title, @body, @link, @data, sqlc.narg(dedupe_key))
ON CONFLICT (dedupe_key) DO NOTHING
RETURNING id;

-- Active members of a team with one of the given roles.
-- name: NotificationTeamRecipients :many
SELECT u.id, u.email, m.role
FROM team_members m
JOIN users u ON u.id = m.user_id
WHERE m.team_id = @team_id AND m.role = ANY(@roles::text[]) AND u.status = 'active'
ORDER BY u.id;

-- name: NotificationUsers :many
SELECT id, email, status FROM users WHERE id = ANY(@ids::uuid[]);

-- name: NotificationUsersByEmail :many
SELECT id, email, status FROM users WHERE email = @email;

-- name: NotificationSettingsFor :many
SELECT user_id, in_app, email
FROM notification_settings
WHERE type = @type AND user_id = ANY(@user_ids::uuid[]);

-- name: InsertNotification :one
INSERT INTO notifications (event_id, type, user_id, email)
VALUES (@event_id, @type, @user_id, sqlc.narg(email)::text)
RETURNING id;

-- name: InsertNotificationEmail :one
INSERT INTO notification_emails (event_id, user_id, to_address)
VALUES (@event_id, @user_id, @to_address)
RETURNING id;

-- A page of a user's notifications, newest first, after an optional
-- (created_at, id) cursor.
-- name: ListNotifications :many
SELECT n.id, n.type, n.read_at, n.created_at, e.team_id, e.title, e.body, e.link
FROM notifications n
JOIN notification_events e ON e.id = n.event_id
WHERE n.user_id = @user_id
  AND (NOT @unread_only::boolean OR n.read_at IS NULL)
  AND (sqlc.narg(type)::text IS NULL OR n.type = sqlc.narg(type)::text)
  AND (sqlc.narg(after_created)::timestamptz IS NULL
       OR (n.created_at, n.id) < (sqlc.narg(after_created)::timestamptz, sqlc.narg(after_id)::uuid))
ORDER BY n.created_at DESC, n.id DESC
LIMIT @page_size;

-- name: CountUnreadNotifications :one
SELECT count(*) FROM notifications WHERE user_id = @user_id AND read_at IS NULL;

-- name: GetNotification :one
SELECT n.id, n.type, n.read_at, n.created_at, e.team_id, e.title, e.body, e.link
FROM notifications n
JOIN notification_events e ON e.id = n.event_id
WHERE n.id = @id AND n.user_id = @user_id;

-- name: SetNotificationRead :execrows
UPDATE notifications
SET read_at = CASE WHEN @read::boolean THEN coalesce(read_at, now()) ELSE NULL END
WHERE id = @id AND user_id = @user_id;

-- name: MarkAllNotificationsRead :execrows
UPDATE notifications
SET read_at = now()
WHERE user_id = @user_id AND read_at IS NULL
  AND (sqlc.narg(type)::text IS NULL OR type = sqlc.narg(type)::text);

-- Moves items addressed to an email (people who had not signed in yet) to
-- the user who signed in with it.
-- name: ClaimNotificationsForEmail :execrows
UPDATE notifications SET user_id = @user_id, email = NULL
WHERE user_id IS NULL AND email = @email::citext;

-- name: ListNotificationSettings :many
SELECT type, in_app, email FROM notification_settings WHERE user_id = @user_id;

-- name: UpsertNotificationSetting :exec
INSERT INTO notification_settings (user_id, type, in_app, email)
VALUES (@user_id, @type, @in_app, @email)
ON CONFLICT (user_id, type) DO UPDATE
SET in_app = EXCLUDED.in_app, email = EXCLUDED.email, updated_at = now();

-- name: GetNotificationEmail :one
SELECT d.id, d.to_address, d.status, d.attempts, e.type, e.title, e.body, e.link, e.data
FROM notification_emails d
JOIN notification_events e ON e.id = d.event_id
WHERE d.id = @id;

-- name: MarkNotificationEmailSent :exec
UPDATE notification_emails
SET status = 'sent', attempts = attempts + 1, last_error = '', sent_at = now()
WHERE id = @id;

-- name: RecordNotificationEmailError :exec
UPDATE notification_emails
SET attempts = attempts + 1, last_error = @last_error,
    status = CASE WHEN @final::boolean THEN 'failed' ELSE status END
WHERE id = @id;

-- Open invites of active teams expiring before @before.
-- name: ExpiringInvites :many
SELECT i.id, i.email, i.role, i.expires_at, i.team_id, t.slug AS team_slug, t.name AS team_name
FROM team_invites i
JOIN teams t ON t.id = i.team_id
WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL AND t.status = 'active'
  AND i.expires_at > now() AND i.expires_at <= @before
ORDER BY i.expires_at;

-- Marks everyone's unread notifications of one kind about one object read,
-- once the object is dealt with (a domain request someone decided).
-- name: MarkNotificationsReadFor :exec
UPDATE notifications n SET read_at = now()
FROM notification_events e
WHERE n.event_id = e.id AND n.read_at IS NULL
  AND e.type = @type::text AND e.data ->> @data_key::text = @data_value::text;
