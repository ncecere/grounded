-- Stored health (docs/v0.3.0.md §5, roadmap E11): the result of every
-- connection and model test, whether an admin pressed Test (manual) or the
-- health job re-tested it (scheduled), so the admin pages show the last
-- result and how long a subject has been failing.
--
-- A subject is a kind and an ID. There is no foreign key: a subject can be
-- a connection, a model, and (v0.3 M3) an MCP server, so adding a kind is a
-- new value in health_checks_subject_kind and a new branch in the
-- health_subjects view. Rows of deleted subjects are removed by the health
-- job's pruning, and every read joins health_subjects, so they never show.
--
-- status_since is when the subject's current status began (the checked_at
-- of the first check of the current streak), copied forward by each insert,
-- so "failing since" survives pruning.
--
-- History: the health job keeps 7 days of checks per subject, and always a
-- subject's latest check however old (docs/operations/health.md).

-- +goose Up
CREATE TABLE health_checks (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject_kind text        NOT NULL CONSTRAINT health_checks_subject_kind CHECK (subject_kind IN ('connection', 'model')),
    subject_id   uuid        NOT NULL,
    status       text        NOT NULL CHECK (status IN ('healthy', 'failing')),
    latency_ms   integer     NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
    -- The probe's error class (internal/gateway: unavailable, auth,
    -- not_found, rate_limited, bad_request, bad_response); NULL when healthy.
    error_class  text        CHECK (char_length(error_class) BETWEEN 1 AND 40),
    -- The HTTP status the gateway answered with, when it answered.
    http_status  integer     CHECK (http_status BETWEEN 100 AND 599),
    -- A short message safe to show admins: the gateway's error message
    -- (never a key or a raw body), or empty when healthy.
    message      text        NOT NULL DEFAULT '' CHECK (char_length(message) <= 500),
    trigger      text        NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
    -- Who pressed Test (manual checks; NULL for scheduled ones).
    triggered_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    checked_at   timestamptz NOT NULL DEFAULT now(),
    status_since timestamptz NOT NULL,
    CONSTRAINT health_checks_error_class CHECK ((status = 'healthy') = (error_class IS NULL)),
    CONSTRAINT health_checks_scheduled_by CHECK (trigger = 'manual' OR triggered_by IS NULL)
);
CREATE INDEX health_checks_subject_idx ON health_checks (subject_kind, subject_id, checked_at DESC, id DESC);
CREATE INDEX health_checks_checked_idx ON health_checks (checked_at);

-- Every subject that has a health status, with whether it is enabled: a
-- model counts as enabled only while its connection is too. Only enabled
-- subjects are re-tested, counted as failing on the admin Overview and in
-- grounded_health_failing.
CREATE VIEW health_subjects AS
SELECT 'connection'::text AS subject_kind, c.id AS subject_id, c.name AS name, c.enabled AS enabled
FROM model_connections c
UNION ALL
SELECT 'model'::text, m.id, m.display_name, m.enabled AND c.enabled
FROM models m
JOIN model_connections c ON c.id = m.connection_id;

-- +goose Down
DROP VIEW health_subjects;
DROP TABLE health_checks;
