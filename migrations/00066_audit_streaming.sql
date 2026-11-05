-- +goose NO TRANSACTION
-- Audit streaming to a SIEM (E5, #36; docs/specs/audit-streaming/DESIGN.md). Expand only.
--
-- audit_log.txid is the transaction that wrote an entry. A stream sends entries whose transaction is older than every
-- transaction still running (txid < pg_snapshot_xmin), in (txid, id) order: an ID does not commit in ID order, so a cursor
-- on IDs alone would skip an entry committed late. The column has no default (adding it is metadata-only); an insert trigger
-- fills it, for the previous release's inserts too. Older entries keep NULL and are never streamed (a stream starts with new
-- entries). The index is built concurrently so a large log stays writable; this file runs outside a transaction for that.

-- +goose Up
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS txid xid8;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION audit_log_set_txid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.txid := pg_current_xact_id();
    RETURN NEW;
END
$$;
-- +goose StatementEnd

DROP TRIGGER IF EXISTS audit_log_txid ON audit_log;
CREATE TRIGGER audit_log_txid BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_set_txid();

-- An interrupted concurrent build leaves an invalid index of this name, which IF NOT EXISTS would keep for good; this file runs
-- again after such a failure, so drop an invalid one first (a valid one is kept). The drop is brief: the index has no data.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('audit_log_txid_idx') AND NOT indisvalid) THEN
        DROP INDEX audit_log_txid_idx;
    END IF;
END
$$;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_txid_idx ON audit_log (txid, id) WHERE txid IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_stream_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled    boolean     NOT NULL DEFAULT false,
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO audit_stream_settings DEFAULT VALUES ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_stream_destinations (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    kind             text        NOT NULL CHECK (kind IN ('https', 'syslog')),
    format           text        NOT NULL CHECK (format IN ('splunk_hec', 'ndjson', 'rfc5424')),
    -- https: the URL; syslog: host:port.
    address          text        NOT NULL CHECK (char_length(address) BETWEEN 1 AND 2048),
    -- The Authorization header value, encrypted (internal/secrets; key rotation).
    auth_header      bytea,
    ca_pem           text        NOT NULL DEFAULT '' CHECK (char_length(ca_pem) <= 65536),
    enabled          boolean     NOT NULL DEFAULT false,
    -- Where the stream is: the last entry sent, by (txid, id); NULL until first switched on.
    cursor_txid      xid8,
    cursor_id        bigint,
    sent_total       bigint      NOT NULL DEFAULT 0,
    last_sent_at     timestamptz,
    last_error_class text        NOT NULL DEFAULT '' CHECK (char_length(last_error_class) <= 32),
    failing_since    timestamptz,
    failures         integer     NOT NULL DEFAULT 0,
    next_attempt_at  timestamptz,
    revision         bigint      NOT NULL DEFAULT 1,
    created_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS audit_stream_destinations;
DROP TABLE IF EXISTS audit_stream_settings;
DROP INDEX CONCURRENTLY IF EXISTS audit_log_txid_idx;
DROP TRIGGER IF EXISTS audit_log_txid ON audit_log;
DROP FUNCTION IF EXISTS audit_log_set_txid();
ALTER TABLE audit_log DROP COLUMN IF EXISTS txid;
