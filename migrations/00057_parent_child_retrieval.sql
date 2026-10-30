-- Parent/child retrieval (A5, #20; docs/parent-child-retrieval.md, ADR-0026).
--
--   * embedding_profiles.parent_tokens: the profile's parent size in tokens; 0 (every existing profile) = no parents. Immutable like the other
--     chunking settings (ADR-0007): changing it is a new profile.
--   * chunks.parent_first, chunks.parent_last: the ordinals, in the same document and profile, of the first and last passage of this passage's
--     parent. NULL for a profile without parents. A parent is a range of passages, not stored text, so it cannot outlive its passages.
--
-- Expand only (ADR-0013): a column with a default and two nullable columns, so the previous release, which neither writes nor reads them,
-- keeps working on this schema (it searches passages only). No rows are rewritten.
-- The range check deliberately does not reference ordinal: older rechunk workers temporarily move kept rows to negative ordinals and
-- may reorder them without knowing these columns. Consumers validate membership, completeness and agreement before using a parent;
-- stale ranges fall back to a child. NOT VALID alone would NOT exempt updates by those older workers.

-- +goose Up
ALTER TABLE embedding_profiles ADD COLUMN parent_tokens integer NOT NULL DEFAULT 0
    CONSTRAINT embedding_profiles_parent_tokens_check CHECK (parent_tokens = 0 OR parent_tokens BETWEEN 128 AND 8192);

ALTER TABLE chunks ADD COLUMN parent_first integer, ADD COLUMN parent_last integer;
ALTER TABLE chunks ADD CONSTRAINT chunks_parent_range_check CHECK (
    (parent_first IS NULL AND parent_last IS NULL)
    OR (parent_first IS NOT NULL AND parent_last IS NOT NULL AND parent_first >= 0 AND parent_last >= parent_first
        AND parent_last - parent_first < 64)) NOT VALID;

-- +goose Down
ALTER TABLE chunks DROP CONSTRAINT chunks_parent_range_check;
ALTER TABLE chunks DROP COLUMN parent_last, DROP COLUMN parent_first;
ALTER TABLE embedding_profiles DROP COLUMN parent_tokens;
