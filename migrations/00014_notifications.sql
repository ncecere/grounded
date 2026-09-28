-- Notifications (docs/phase4-publishing.md §8, DESIGN.md §12): an event is
-- recorded in the same transaction as the change that caused it, with one
-- in-app item per recipient and one email delivery per address; a River job
-- sends each email after commit. Per-user settings choose the channels.

-- +goose Up
CREATE TABLE notification_events (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    type       text        NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.]{1,63}$'),
    team_id    uuid        REFERENCES teams (id) ON DELETE CASCADE,
    actor_id   uuid        REFERENCES users (id) ON DELETE SET NULL,
    -- Rendered when the event is recorded; email templates add the instance
    -- name and absolute links. link is an app path such as /teams/registrar.
    title      text        NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
    body       text        NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
    link       text        NOT NULL DEFAULT '' CHECK (link = '' OR link ~ '^/([^/\\]|$)'),
    data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- Events that must happen once (a daily limit per team and day, an
    -- invite's expiry notice) carry a key; recording it again is a no-op.
    dedupe_key text        UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id   uuid        NOT NULL REFERENCES notification_events (id) ON DELETE CASCADE,
    type       text        NOT NULL,
    user_id    uuid        REFERENCES users (id) ON DELETE CASCADE,
    -- Set instead of user_id for people who have never signed in (invites);
    -- the item moves to the user when they first sign in with this address.
    email      citext,
    read_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (user_id IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id DESC) WHERE user_id IS NOT NULL;
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_email_idx ON notifications (email) WHERE user_id IS NULL;
CREATE INDEX notifications_event_idx ON notifications (event_id);

CREATE TABLE notification_emails (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id   uuid        NOT NULL REFERENCES notification_events (id) ON DELETE CASCADE,
    user_id    uuid        REFERENCES users (id) ON DELETE SET NULL,
    to_address citext      NOT NULL,
    status     text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts   integer     NOT NULL DEFAULT 0,
    last_error text        NOT NULL DEFAULT '',
    sent_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_emails_event_idx ON notification_emails (event_id);
CREATE INDEX notification_emails_pending_idx ON notification_emails (created_at) WHERE status = 'pending';

-- A row exists only for events whose defaults the user changed.
CREATE TABLE notification_settings (
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type       text        NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.]{1,63}$'),
    in_app     boolean     NOT NULL,
    email      boolean     NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, type)
);

-- +goose Down
DROP TABLE notification_settings;
DROP TABLE notification_emails;
DROP TABLE notifications;
DROP TABLE notification_events;
