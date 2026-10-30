-- Near-duplicate boilerplate matching, opt-in (DESIGN.md §5.5, #23). Additive: older code ignores the columns and
-- tables, and with the switch off nothing here is written.
--   * source_boilerplate.fuzzy: a source's override of the platform default (NULL = inherit).
--   * document_blocks.fuzzy_hashes / sketches / sketch_version: the eligible blocks of a document (the hashes that
--     also are in `hashes`) and their MinHash sketches, 32 bytes each, in the same order. sketch_version 0 = not
--     recorded yet (the refresh's backfill reads the parsed text); 1 = the sketches of internal/boilerplate/fuzzy.go.
--   * source_boilerplate_blocks.variants / member_of: a near-duplicate cluster is stored as one row per variant, all
--     with the cluster's document count and canonical document; the cluster's first block has `variants` set and
--     the others `member_of` it, so lists show a cluster once.
--   * embedding_profiles.boilerplate_fuzzy: set on an index preview's candidate that asks to judge with
--     near-duplicate matching on, whatever the sources' settings are.
--   * set_boilerplate / set_boilerplate_blocks: the classification such a candidate cuts a source's documents with
--     (a snapshot taken when the set starts), removed with the set.

-- +goose Up
ALTER TABLE source_boilerplate ADD COLUMN fuzzy boolean;

ALTER TABLE document_blocks
    ADD COLUMN sketch_version smallint NOT NULL DEFAULT 0,
    ADD COLUMN fuzzy_hashes   bigint[] NOT NULL DEFAULT '{}',
    ADD COLUMN sketches       bytea    NOT NULL DEFAULT '';

ALTER TABLE source_boilerplate_blocks
    ADD COLUMN variants integer NOT NULL DEFAULT 1 CHECK (variants >= 1),
    ADD COLUMN member_of bigint;

ALTER TABLE embedding_profiles ADD COLUMN boilerplate_fuzzy boolean NOT NULL DEFAULT false;

CREATE TABLE set_boilerplate (
    source_id     uuid        NOT NULL,
    profile_id    uuid        NOT NULL,
    classified_at timestamptz NOT NULL DEFAULT now(),
    documents     integer     NOT NULL DEFAULT 0, -- documents counted
    threshold     integer     NOT NULL DEFAULT 0, -- documents a block needed
    PRIMARY KEY (source_id, profile_id),
    FOREIGN KEY (source_id, profile_id) REFERENCES source_embedding_sets (source_id, profile_id) ON DELETE CASCADE
);

CREATE TABLE set_boilerplate_blocks (
    source_id             uuid   NOT NULL,
    profile_id            uuid   NOT NULL,
    block_hash            bigint NOT NULL,
    canonical_document_id uuid   REFERENCES documents (id) ON DELETE SET NULL,
    PRIMARY KEY (source_id, profile_id, block_hash),
    FOREIGN KEY (source_id, profile_id) REFERENCES set_boilerplate (source_id, profile_id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE set_boilerplate_blocks;
DROP TABLE set_boilerplate;
ALTER TABLE embedding_profiles DROP COLUMN boilerplate_fuzzy;
ALTER TABLE source_boilerplate_blocks DROP COLUMN member_of, DROP COLUMN variants;
ALTER TABLE document_blocks DROP COLUMN sketches, DROP COLUMN fuzzy_hashes, DROP COLUMN sketch_version;
ALTER TABLE source_boilerplate DROP COLUMN fuzzy;
