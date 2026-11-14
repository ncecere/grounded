-- +goose NO TRANSACTION
-- Fills the counters of migration 00072 (#249, ADR-0036) with what the documents held before its triggers existed.
--
-- Each statement runs on its own: it reads the documents and the counters in one snapshot and adds the difference, so
-- writes go on meanwhile (no lock on documents; the previous release's servers keep writing, and the triggers count
-- what they write). Running it again, after an interruption or later, adds nothing to a counter that is already right.
-- It reads every document once per statement: on an install of a million documents, a few seconds each.

-- +goose Up
SELECT reconcile_document_counts('teams');
SELECT reconcile_document_counts('sources');
SELECT reconcile_document_counts('tags');

-- +goose Down
-- Nothing: 00072's down removes the counters.
SELECT 1;
