-- Expand-only: older binaries neither read nor write this singleton. No existing
-- table or deployment data changes. Defaults publish no new contact/link.
-- +goose Up
CREATE TABLE accessibility_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 contact_url text NOT NULL DEFAULT '',
 institution_url text NOT NULL DEFAULT '',
 revision bigint NOT NULL DEFAULT 1,
 updated_by uuid REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO accessibility_settings DEFAULT VALUES;
