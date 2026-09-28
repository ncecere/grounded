-- OCR for scanned documents (B4, docs/ocr.md): the platform's parsing
-- settings, the vision model kind, the per-source OCR switch and documents
-- waiting for the team's daily OCR page limit.
--
-- Expand only (ADR-0013): new columns have defaults or are nullable, and the
-- previous release never writes the new kind or values. Its dispatcher
-- doesn't know waiting_until, so during a rolling upgrade it may queue a
-- waiting document early; the new worker parks it again.

-- +goose Up
-- A vision model transcribes page images (the OCR backend "vision").
ALTER TABLE models DROP CONSTRAINT IF EXISTS models_kind_check;
ALTER TABLE models ADD CONSTRAINT models_kind_check
    CHECK (kind IN ('chat', 'embedding', 'rerank', 'moderation', 'systemone', 'vision'));

-- One row: Admin -> Parsing (internal/ocr). No row means OCR off. The
-- per-document page cap and concurrency are configuration
-- (OCR_MAX_PAGES_PER_DOCUMENT, OCR_CONCURRENCY), shown on the page.
CREATE TABLE parsing_settings (
    singleton       boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    ocr_enabled     boolean     NOT NULL DEFAULT false,
    ocr_backend     text        NOT NULL DEFAULT 'tesseract' CHECK (ocr_backend IN ('tesseract', 'tika', 'vision')),
    -- The vision backend's model; a model in use cannot be deleted.
    vision_model_id uuid        REFERENCES models (id) ON DELETE RESTRICT,
    -- Tesseract language codes joined with "+", e.g. eng or eng+spa.
    languages       text        NOT NULL DEFAULT 'eng' CHECK (languages ~ '^[a-z_]{3,16}(\+[a-z_]{3,16}){0,9}$'),
    revision        bigint      NOT NULL DEFAULT 2,
    updated_by      uuid        REFERENCES users (id),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A team can keep OCR off for a source whose scanned pages are noise.
ALTER TABLE data_sources ADD COLUMN ocr_enabled boolean NOT NULL DEFAULT true;

-- A pending document waiting for the team's daily OCR page limit
-- (error_code ocr_daily_limit) until this time, or until the limit is
-- raised. NULL for every other document. The dispatcher only picks pending
-- documents that aren't waiting, from their own partial index, so waiting
-- documents cost nothing; the old index serves the previous release during
-- a rollout and is dropped in the next one.
ALTER TABLE documents ADD COLUMN waiting_until timestamptz;
CREATE INDEX documents_pending_ready_idx ON documents (team_id, updated_at, id)
    WHERE status = 'pending' AND waiting_until IS NULL;
CREATE INDEX documents_waiting_idx ON documents (waiting_until, team_id)
    WHERE status = 'pending' AND waiting_until IS NOT NULL;
-- Admin -> Parsing counts the documents each team could retry with OCR.
CREATE INDEX documents_needs_ocr_idx ON documents (team_id) WHERE error_code = 'needs_ocr';

-- +goose Down
DROP INDEX documents_needs_ocr_idx;
DROP INDEX documents_waiting_idx;
DROP INDEX documents_pending_ready_idx;
ALTER TABLE documents DROP COLUMN waiting_until;
ALTER TABLE data_sources DROP COLUMN ocr_enabled;
DROP TABLE parsing_settings;
DELETE FROM models WHERE kind = 'vision';
ALTER TABLE models DROP CONSTRAINT models_kind_check;
ALTER TABLE models ADD CONSTRAINT models_kind_check
    CHECK (kind IN ('chat', 'embedding', 'rerank', 'moderation', 'systemone'));
