-- Document counters (v0.10.0, #249, ADR-0036): per team (documents, bytes), per source and status (documents, bytes,
-- chunks, documents waiting for a personal-data review) and per source and tag (documents), so the usage check under a
-- team's usage lock, the source pages, the documents table's tag list and the admin team pages read a few rows instead
-- of aggregating every document.
--
-- Triggers keep them, not the application: every write to documents is counted, whichever code makes it (an upload, a
-- crawl, a connector sync, retention, a cascade from a deleted source or team, a test fixture) and whichever release
-- runs it, so the previous release's servers keep them exact during a rolling update and after a rollback. The
-- triggers are statement-level with transition tables: a statement adds one aggregated delta per key, so deleting a
-- source of a million documents writes a few rows, not a million.
--
-- Contention: a row would be held from the statement that changes it until its transaction commits, so every counter
-- has 16 slots and a transaction writes the slot of its backend (pg_backend_pid() % 16). Concurrent ingest workers
-- finishing documents of one source then rarely wait for each other; a read sums the slots. A slot may hold a negative
-- count (a document queued in one slot and finished in another); only the sum means anything.
--
-- The counters start at zero; migration 00073 adds what the documents already held (reconcile_document_counts).
-- Expand only (ADR-0013): new tables, types and functions, and triggers that write only the new tables.

-- +goose Up
CREATE TABLE team_document_counts (
    team_id   uuid     NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    slot      smallint NOT NULL,
    documents bigint   NOT NULL DEFAULT 0,
    bytes     bigint   NOT NULL DEFAULT 0,
    PRIMARY KEY (team_id, slot)
);

CREATE TABLE source_document_counts (
    source_id  uuid     NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    status     text     NOT NULL,
    slot       smallint NOT NULL,
    documents  bigint   NOT NULL DEFAULT 0,
    bytes      bigint   NOT NULL DEFAULT 0,
    chunks     bigint   NOT NULL DEFAULT 0,
    pii_review bigint   NOT NULL DEFAULT 0,
    PRIMARY KEY (source_id, status, slot)
);

CREATE TABLE source_tag_counts (
    source_id uuid     NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    tag       text     NOT NULL,
    slot      smallint NOT NULL,
    documents bigint   NOT NULL DEFAULT 0,
    PRIMARY KEY (source_id, tag, slot)
);

-- One statement's change to the documents of a source with one status (a team's change is the sum over its sources),
-- and to the documents of a source with one tag.
CREATE TYPE document_count_delta AS (source_id uuid, team_id uuid, status text, documents bigint, bytes bigint, chunks bigint, pii_review bigint);
CREATE TYPE document_tag_delta AS (source_id uuid, tag text, documents bigint);

-- Adds deltas to this backend's slot. Keys are written in order (sources and statuses, then teams, then tags), so two
-- statements touching the same keys lock them in the same order. A source or team that no longer exists (deleted in
-- this transaction: its documents go by cascade) is skipped; its counter rows go by their own cascade.
-- +goose StatementBegin
CREATE FUNCTION apply_document_count_deltas(count_deltas document_count_delta[], tag_deltas document_tag_delta[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    my_slot smallint := (pg_backend_pid() % 16)::smallint;
BEGIN
    INSERT INTO source_document_counts AS c (source_id, status, slot, documents, bytes, chunks, pii_review)
    SELECT d.source_id, d.status, my_slot, sum(d.documents), sum(d.bytes), sum(d.chunks), sum(d.pii_review)
    FROM unnest(count_deltas) AS d
    WHERE EXISTS (SELECT 1 FROM data_sources s WHERE s.id = d.source_id)
    GROUP BY d.source_id, d.status
    HAVING sum(d.documents) <> 0 OR sum(d.bytes) <> 0 OR sum(d.chunks) <> 0 OR sum(d.pii_review) <> 0
    ORDER BY d.source_id, d.status
    ON CONFLICT (source_id, status, slot) DO UPDATE
    SET documents = c.documents + EXCLUDED.documents, bytes = c.bytes + EXCLUDED.bytes,
        chunks = c.chunks + EXCLUDED.chunks, pii_review = c.pii_review + EXCLUDED.pii_review;

    INSERT INTO team_document_counts AS c (team_id, slot, documents, bytes)
    SELECT d.team_id, my_slot, sum(d.documents), sum(d.bytes)
    FROM unnest(count_deltas) AS d
    WHERE d.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM teams t WHERE t.id = d.team_id)
    GROUP BY d.team_id
    HAVING sum(d.documents) <> 0 OR sum(d.bytes) <> 0
    ORDER BY d.team_id
    ON CONFLICT (team_id, slot) DO UPDATE
    SET documents = c.documents + EXCLUDED.documents, bytes = c.bytes + EXCLUDED.bytes;

    INSERT INTO source_tag_counts AS c (source_id, tag, slot, documents)
    SELECT d.source_id, d.tag, my_slot, sum(d.documents)
    FROM unnest(tag_deltas) AS d
    WHERE EXISTS (SELECT 1 FROM data_sources s WHERE s.id = d.source_id)
    GROUP BY d.source_id, d.tag
    HAVING sum(d.documents) <> 0
    ORDER BY d.source_id, d.tag
    ON CONFLICT (source_id, tag, slot) DO UPDATE SET documents = c.documents + EXCLUDED.documents;
END $$;
-- +goose StatementEnd

-- The trigger: the rows a statement inserted count +1 each, the rows it deleted -1, and an update is both (its new rows
-- +1, its old rows -1, so a status change moves a document from one status to the other and an unchanged one nets to
-- nothing). Transition tables cannot serve a trigger with several events, so there are three triggers on one function;
-- each branch names only the tables its event has.
-- +goose StatementBegin
CREATE FUNCTION documents_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    count_deltas document_count_delta[];
    tag_deltas   document_tag_delta[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        count_deltas := ARRAY(
            SELECT ROW(source_id, team_id, status, count(*), sum(size_bytes)::bigint, sum(chunk_count)::bigint,
                       count(*) FILTER (WHERE metadata->'pii'->>'state' IN ('flagged', 'held')))::document_count_delta
            FROM new_rows GROUP BY source_id, team_id, status);
        tag_deltas := ARRAY(
            SELECT ROW(source_id, tag, count(*))::document_tag_delta
            FROM new_rows, unnest(tags) AS tag GROUP BY source_id, tag);
    ELSIF TG_OP = 'DELETE' THEN
        count_deltas := ARRAY(
            SELECT ROW(source_id, team_id, status, -count(*), -sum(size_bytes)::bigint, -sum(chunk_count)::bigint,
                       -count(*) FILTER (WHERE metadata->'pii'->>'state' IN ('flagged', 'held')))::document_count_delta
            FROM old_rows GROUP BY source_id, team_id, status);
        tag_deltas := ARRAY(
            SELECT ROW(source_id, tag, -count(*))::document_tag_delta
            FROM old_rows, unnest(tags) AS tag GROUP BY source_id, tag);
    ELSE
        count_deltas := ARRAY(
            SELECT ROW(source_id, team_id, status, sum(n), sum(b)::bigint, sum(c)::bigint, sum(p))::document_count_delta
            FROM (SELECT source_id, team_id, status, 1 AS n, size_bytes AS b, chunk_count AS c,
                         coalesce((metadata->'pii'->>'state' IN ('flagged', 'held'))::int, 0) AS p FROM new_rows
                  UNION ALL
                  SELECT source_id, team_id, status, -1, -size_bytes, -chunk_count,
                         -coalesce((metadata->'pii'->>'state' IN ('flagged', 'held'))::int, 0) FROM old_rows) AS d
            GROUP BY source_id, team_id, status);
        tag_deltas := ARRAY(
            SELECT ROW(source_id, tag, sum(n))::document_tag_delta
            FROM (SELECT source_id, tag, 1 AS n FROM new_rows, unnest(tags) AS tag
                  UNION ALL
                  SELECT source_id, tag, -1 FROM old_rows, unnest(tags) AS tag) AS d
            GROUP BY source_id, tag);
    END IF;
    PERFORM apply_document_count_deltas(count_deltas, tag_deltas);
    RETURN NULL;
END $$;
-- +goose StatementEnd

CREATE TRIGGER documents_count_insert AFTER INSERT ON documents
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION documents_count();
CREATE TRIGGER documents_count_update AFTER UPDATE ON documents
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION documents_count();
CREATE TRIGGER documents_count_delete AFTER DELETE ON documents
    REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION documents_count();

-- Makes one kind of counter ('teams', 'sources' or 'tags') equal to the documents, and returns how many keys were off;
-- then removes rows that hold nothing (a tag no document has any more, a slot whose changes cancelled out).
-- The difference between the documents and the counters is taken in one statement, so in one snapshot: a change
-- committed in between is in both or in neither, because the triggers write it in the same transaction. Adding that
-- difference (to slot 0) is therefore right whatever writes run meanwhile, with no lock on documents. Runs are
-- serialised (a second would see the first's result and add nothing), and a source or team deleted between the
-- snapshot and the write (a foreign key error) makes the statement run again.
-- +goose StatementBegin
CREATE FUNCTION reconcile_document_counts(kind text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
    fixed bigint := 0;
    tries int := 0;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('reconcile_document_counts', 7303));
    LOOP
        BEGIN
            IF kind = 'teams' THEN
                INSERT INTO team_document_counts AS c (team_id, slot, documents, bytes)
                SELECT coalesce(a.team_id, k.team_id), 0, coalesce(a.documents, 0) - coalesce(k.documents, 0),
                       coalesce(a.bytes, 0) - coalesce(k.bytes, 0)
                FROM (SELECT team_id, count(*) AS documents, coalesce(sum(size_bytes), 0)::bigint AS bytes
                      FROM documents WHERE team_id IS NOT NULL GROUP BY team_id) AS a
                FULL JOIN (SELECT team_id, sum(documents)::bigint AS documents, sum(bytes)::bigint AS bytes
                           FROM team_document_counts GROUP BY team_id) AS k ON k.team_id = a.team_id
                WHERE (coalesce(a.documents, 0), coalesce(a.bytes, 0)) <> (coalesce(k.documents, 0), coalesce(k.bytes, 0))
                  AND EXISTS (SELECT 1 FROM teams t WHERE t.id = coalesce(a.team_id, k.team_id))
                ORDER BY 1
                ON CONFLICT (team_id, slot) DO UPDATE
                SET documents = c.documents + EXCLUDED.documents, bytes = c.bytes + EXCLUDED.bytes;
                GET DIAGNOSTICS fixed = ROW_COUNT;
                DELETE FROM team_document_counts WHERE documents = 0 AND bytes = 0;
            ELSIF kind = 'sources' THEN
                INSERT INTO source_document_counts AS c (source_id, status, slot, documents, bytes, chunks, pii_review)
                SELECT coalesce(a.source_id, k.source_id), coalesce(a.status, k.status), 0,
                       coalesce(a.documents, 0) - coalesce(k.documents, 0), coalesce(a.bytes, 0) - coalesce(k.bytes, 0),
                       coalesce(a.chunks, 0) - coalesce(k.chunks, 0), coalesce(a.pii_review, 0) - coalesce(k.pii_review, 0)
                FROM (SELECT source_id, status, count(*) AS documents, coalesce(sum(size_bytes), 0)::bigint AS bytes,
                             coalesce(sum(chunk_count), 0)::bigint AS chunks,
                             count(*) FILTER (WHERE metadata->'pii'->>'state' IN ('flagged', 'held')) AS pii_review
                      FROM documents GROUP BY source_id, status) AS a
                FULL JOIN (SELECT source_id, status, sum(documents)::bigint AS documents, sum(bytes)::bigint AS bytes,
                                  sum(chunks)::bigint AS chunks, sum(pii_review)::bigint AS pii_review
                           FROM source_document_counts GROUP BY source_id, status) AS k
                     ON k.source_id = a.source_id AND k.status = a.status
                WHERE (coalesce(a.documents, 0), coalesce(a.bytes, 0), coalesce(a.chunks, 0), coalesce(a.pii_review, 0))
                   <> (coalesce(k.documents, 0), coalesce(k.bytes, 0), coalesce(k.chunks, 0), coalesce(k.pii_review, 0))
                  AND EXISTS (SELECT 1 FROM data_sources s WHERE s.id = coalesce(a.source_id, k.source_id))
                ORDER BY 1, 2
                ON CONFLICT (source_id, status, slot) DO UPDATE
                SET documents = c.documents + EXCLUDED.documents, bytes = c.bytes + EXCLUDED.bytes,
                    chunks = c.chunks + EXCLUDED.chunks, pii_review = c.pii_review + EXCLUDED.pii_review;
                GET DIAGNOSTICS fixed = ROW_COUNT;
                DELETE FROM source_document_counts WHERE documents = 0 AND bytes = 0 AND chunks = 0 AND pii_review = 0;
            ELSIF kind = 'tags' THEN
                INSERT INTO source_tag_counts AS c (source_id, tag, slot, documents)
                SELECT coalesce(a.source_id, k.source_id), coalesce(a.tag, k.tag), 0,
                       coalesce(a.documents, 0) - coalesce(k.documents, 0)
                FROM (SELECT source_id, tag, count(*) AS documents FROM documents, unnest(tags) AS tag GROUP BY source_id, tag) AS a
                FULL JOIN (SELECT source_id, tag, sum(documents)::bigint AS documents FROM source_tag_counts GROUP BY source_id, tag) AS k
                     ON k.source_id = a.source_id AND k.tag = a.tag
                WHERE coalesce(a.documents, 0) <> coalesce(k.documents, 0)
                  AND EXISTS (SELECT 1 FROM data_sources s WHERE s.id = coalesce(a.source_id, k.source_id))
                ORDER BY 1, 2
                ON CONFLICT (source_id, tag, slot) DO UPDATE SET documents = c.documents + EXCLUDED.documents;
                GET DIAGNOSTICS fixed = ROW_COUNT;
                DELETE FROM source_tag_counts WHERE documents = 0;
            ELSE
                RAISE EXCEPTION 'reconcile_document_counts: unknown kind %', kind;
            END IF;
            RETURN fixed;
        EXCEPTION WHEN foreign_key_violation THEN
            tries := tries + 1;
            IF tries >= 5 THEN
                RAISE;
            END IF;
        END;
    END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER documents_count_delete ON documents;
DROP TRIGGER documents_count_update ON documents;
DROP TRIGGER documents_count_insert ON documents;
DROP FUNCTION reconcile_document_counts(text);
DROP FUNCTION documents_count();
DROP FUNCTION apply_document_count_deltas(document_count_delta[], document_tag_delta[]);
DROP TYPE document_tag_delta;
DROP TYPE document_count_delta;
DROP TABLE source_tag_counts;
DROP TABLE source_document_counts;
DROP TABLE team_document_counts;
