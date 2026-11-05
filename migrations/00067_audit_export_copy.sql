-- +goose Up
-- External copies of the signed daily audit exports (E5, #36; docs/signed-daily-audit-export.md, "External copy"). Expand only:
-- each completed export records when its payload and envelope were copied to the operator's bucket, and the last failure.
ALTER TABLE audit_exports ADD COLUMN copied_at timestamptz;
ALTER TABLE audit_exports ADD COLUMN copy_error_class text NOT NULL DEFAULT '' CHECK (char_length(copy_error_class) <= 32);
ALTER TABLE audit_exports ADD COLUMN copy_failures integer NOT NULL DEFAULT 0;
ALTER TABLE audit_exports ADD COLUMN copy_next_at timestamptz;

-- +goose Down
ALTER TABLE audit_exports DROP COLUMN copy_next_at;
ALTER TABLE audit_exports DROP COLUMN copy_failures;
ALTER TABLE audit_exports DROP COLUMN copy_error_class;
ALTER TABLE audit_exports DROP COLUMN copied_at;
