-- Per-knowledge-base hybrid fusion weights (DESIGN.md §6). NULL = the
-- platform default (RETRIEVAL_VECTOR_WEIGHT / RETRIEVAL_KEYWORD_WEIGHT).
-- Both are set or both are NULL. Additive: older code ignores them.

-- +goose Up
ALTER TABLE knowledge_bases
    ADD COLUMN vector_weight  double precision CHECK (vector_weight BETWEEN 0 AND 1),
    ADD COLUMN keyword_weight double precision CHECK (keyword_weight BETWEEN 0 AND 1),
    ADD CONSTRAINT knowledge_bases_weights CHECK (
        (vector_weight IS NULL AND keyword_weight IS NULL) OR
        (vector_weight IS NOT NULL AND keyword_weight IS NOT NULL AND vector_weight + keyword_weight > 0));

-- +goose Down
ALTER TABLE knowledge_bases
    DROP CONSTRAINT knowledge_bases_weights,
    DROP COLUMN keyword_weight,
    DROP COLUMN vector_weight;
