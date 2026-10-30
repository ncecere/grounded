-- Agent template names are unique ignoring case for every script, not only ASCII (#140).
--
-- The index of 00049 is on lower(name), and lower() follows the database's character classes: in a cluster created with --locale=C it
-- changes ASCII letters only, so "qa über" and "QA ÜBER" (or é and É) were two templates, and the picker showed two that look alike. The
-- ICU root collation's lower() does not depend on the cluster's locale, so the new index uses it; the service compares names the same way.
--
-- Expand/contract (ADR-0013): this release only adds an index. The old one stays, so the previous release's code still gets its
-- unique-violation (agent_templates_name_key) for a name it can see is taken, and the new code answers for both. A later release drops
-- agent_templates_name_key when nothing older runs.
--
-- Existing duplicates are not deleted: each one after the first (oldest first) is renamed "Name (2)", "Name (3)" ..., cut so the name stays
-- within 80 characters, so every template keeps its id, configuration and the agents made from it.

-- +goose Up
-- +goose StatementBegin
DO $$
DECLARE
    dup  record;
    n    integer;
    cand text;
BEGIN
    -- No template is added or renamed between finding the duplicates and creating the index.
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

CREATE UNIQUE INDEX agent_templates_name_fold_key ON agent_templates (lower(name COLLATE "und-x-icu"));

-- +goose Down
DROP INDEX agent_templates_name_fold_key;
