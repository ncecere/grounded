-- Reading the audit log names each entry's target; for a target that no
-- longer exists it uses the last name the log recorded for the same target
-- (DESIGN.md §13), which this index serves.

-- +goose Up
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id, id DESC);

-- +goose Down
DROP INDEX audit_log_target_idx;
