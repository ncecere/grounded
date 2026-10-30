-- Agent template names are unique ignoring case for every script, not only ASCII (#140, #195).
--
-- The index of 00049 is on lower(name), and lower() follows the database's character classes: in a cluster created with --locale=C it
-- changes ASCII letters only, so "qa über" and "QA ÜBER" (or é and É) were two templates, and the picker showed two that look alike. The
-- ICU root collation's lower() does not depend on the cluster's locale, so the service now compares names with it.
--
-- Expand/contract (ADR-0013), staged over three releases. A tighter constraint on existing data ships one release AFTER the code that
-- writes valid data, because the previous release's pods run during a rollout (and after a rollback) and know only the constraint
-- agent_templates_name_key: a unique violation of a new index would be an unrecognised error, a 500 for an admin saving a name.
--   This release (v0.6.3): this migration renames today's duplicates and adds a plain, NON-unique lookup index on the folded name. The
--     service takes a transaction-level advisory lock and checks the folded name before it saves or renames a template
--     (agents.claimTemplateName). No stricter constraint exists, so a v0.6.2 pod still saving next to this release gets, at worst, a
--     twin that its own index cannot see (a cluster with --locale=C), never a 500.
--   A later release: once nothing older than v0.6.3 runs, it renames any twin saved by an old pod the same way, then creates the UNIQUE index
--     agent_templates_name_fold_key on lower(name COLLATE "und-x-icu") (CREATE INDEX CONCURRENTLY), and drops the lookup index.
--   The release after that: drops the old index agent_templates_name_key, which the folded one makes redundant.
-- docs/operations/upgrades.md ("Staged constraints") records both steps. The service already answers for both unique indexes by name.
--
-- ICU: the folded name needs PostgreSQL built with ICU and the "und-x-icu" collation, as the official and CloudNativePG images are. It is
-- checked first, with a message that says what to do, before anything is changed. An ICU update (a new libicu with a new Unicode version)
-- can change how an index on the folded name is ordered: docs/operations/upgrades.md says to REINDEX it afterwards.
--
-- Existing duplicates are not deleted: each one after the first (oldest first) is renamed "Name (2)", "Name (3)" ..., cut so the name stays
-- within 80 characters, so every template keeps its id, configuration and the agents made from it. The table holds the templates a platform
-- admin saved from an agent (a handful), so the lock and the plain index build below are brief.

-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu') THEN
        RAISE EXCEPTION 'migration 00054 needs the ICU collation "und-x-icu", and this PostgreSQL has none (it was built without ICU, or the collations were not imported)'
            USING HINT = 'Use a PostgreSQL built with ICU (the official postgres and pgvector images and CloudNativePG are), or ask the provider to enable ICU collations; see docs/operations/upgrades.md, "Staged constraints".';
    END IF;
    BEGIN
        -- Not only present but working: this is the folding the service relies on, whatever the cluster's locale.
        IF lower('ÜÉÖ' COLLATE "und-x-icu") IS DISTINCT FROM 'üéö' THEN
            RAISE EXCEPTION 'the ICU collation "und-x-icu" does not fold case as expected (lower(''ÜÉÖ'') is %)', lower('ÜÉÖ' COLLATE "und-x-icu");
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'migration 00054 cannot use the ICU collation "und-x-icu": %', SQLERRM
            USING HINT = 'Check the PostgreSQL build and its ICU library (libicu); see docs/operations/upgrades.md, "Staged constraints".';
    END;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
DECLARE
    dup  record;
    n    integer;
    cand text;
BEGIN
    -- No template is added or renamed between finding the duplicates and the index below.
    LOCK TABLE agent_templates IN SHARE ROW EXCLUSIVE MODE;
    FOR dup IN
        SELECT id, name FROM (
            SELECT id, name, row_number() OVER (PARTITION BY lower(name COLLATE "und-x-icu") ORDER BY created_at, id) AS rn
            FROM agent_templates
        ) ranked WHERE rn > 1
        ORDER BY name, id
    LOOP
        n := 2;
        LOOP
            cand := left(dup.name, 80 - length(' (' || n || ')')) || ' (' || n || ')';
            EXIT WHEN NOT EXISTS (SELECT 1 FROM agent_templates WHERE lower(name COLLATE "und-x-icu") = lower(cand COLLATE "und-x-icu"));
            n := n + 1;
        END LOOP;
        UPDATE agent_templates SET name = cand, updated_at = now() WHERE id = dup.id;
    END LOOP;
END
$$;
-- +goose StatementEnd

-- Not unique (see above): the lookup of agents.claimTemplateName, and the index a later release's unique one replaces.
CREATE INDEX agent_templates_name_fold_idx ON agent_templates (lower(name COLLATE "und-x-icu"));

-- +goose Down
DROP INDEX agent_templates_name_fold_idx;
