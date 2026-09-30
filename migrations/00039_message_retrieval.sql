-- The search an answer ran before the model (retrieval mode always): its
-- query, how many passages it found and, with SystemOne passage judging,
-- the judged counts ({"query", "hitCount", "judging"}). The chat shows it as
-- the answer's "Searched the knowledge base for …" step, live and after a
-- reload. NULL for answers that didn't search first (tool mode, refusals
-- before retrieval) and for answers stored before v0.3.0.
--
-- A new nullable column only (expand/contract, ADR-0013): the previous
-- release never reads or writes it.

-- +goose Up
ALTER TABLE messages ADD COLUMN retrieval jsonb;

-- +goose Down
ALTER TABLE messages DROP COLUMN retrieval;
