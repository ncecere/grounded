-- Embedding profile settings for self-hosted models (DESIGN.md §6, §10;
-- docs/benchmarks/spark-models.md):
--   * output_dimensions: the profile stores fewer dimensions than the
--     model's native size (Matryoshka truncation). NULL = the model's
--     dimensions. dimensions (the vector column) equals it when set.
--     Immutable, like the other vector settings (ADR-0007).
--   * default_vector_weight / default_keyword_weight: the fusion weights of
--     knowledge bases on this profile that don't set their own. NULL = the
--     platform default. Both set or both NULL.
-- Additive: older code ignores the columns.

-- +goose Up
ALTER TABLE embedding_profiles
    ADD COLUMN output_dimensions      integer CHECK (output_dimensions >= 1),
    ADD COLUMN default_vector_weight  double precision CHECK (default_vector_weight BETWEEN 0 AND 1),
    ADD COLUMN default_keyword_weight double precision CHECK (default_keyword_weight BETWEEN 0 AND 1),
    ADD CONSTRAINT embedding_profiles_output_dimensions CHECK (
        output_dimensions IS NULL OR output_dimensions = dimensions),
    ADD CONSTRAINT embedding_profiles_default_weights CHECK (
        (default_vector_weight IS NULL AND default_keyword_weight IS NULL) OR
        (default_vector_weight IS NOT NULL AND default_keyword_weight IS NOT NULL
         AND default_vector_weight + default_keyword_weight > 0));

-- +goose Down
ALTER TABLE embedding_profiles
    DROP CONSTRAINT embedding_profiles_default_weights,
    DROP CONSTRAINT embedding_profiles_output_dimensions,
    DROP COLUMN default_keyword_weight,
    DROP COLUMN default_vector_weight,
    DROP COLUMN output_dimensions;
