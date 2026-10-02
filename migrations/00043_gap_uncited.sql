-- An uncited sentence is not a failure (owner decision, 2026-10-01;
-- docs/v0.4.0.md §2): the gap report's signals are no context, refused,
-- judged out, out of scope, unsupported or contradicted claims and a
-- thumbs-down. New answers no longer record `uncited`; questions captured
-- before keep their other signals, and those kept only for uncited
-- sentences go (the topics job prunes topics left with no questions).
-- Data only: the previous code reads the same columns.

-- +goose Up
UPDATE gap_questions SET signals = array_remove(signals, 'uncited'), updated_at = now() WHERE 'uncited' = ANY(signals);
DELETE FROM gap_questions WHERE signals = '{}';

-- +goose Down
-- Nothing to undo: the removed signal can't be told apart again.
SELECT 1;
