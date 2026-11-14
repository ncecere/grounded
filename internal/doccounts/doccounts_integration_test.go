package doccounts_test

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/doccounts"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/migrations"
)

type fixture struct {
	t                    *testing.T
	ctx                  context.Context
	pool                 *pgxpool.Pool
	q                    *dbgen.Queries
	profile, team, other uuid.UUID
	upload, web, shared  uuid.UUID
	otherSource          uuid.UUID
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	f := &fixture{t: t, ctx: context.Background(), pool: pool, q: dbgen.New(pool)}
	f.setup()
	return f
}

func (f *fixture) setup() {
	conn, model := uuid.New(), uuid.New()
	f.exec(`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, conn)
	f.exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions)
		VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, model, conn)
	f.profile = f.id(`INSERT INTO embedding_profiles (key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap)
		VALUES ('p', 'P', $1, 4, 'halfvec', 512, 0) RETURNING id`, model)
	f.team = f.id(`INSERT INTO teams (slug, name, max_classification) VALUES ('registrar', 'Registrar', 'restricted') RETURNING id`)
	f.other = f.id(`INSERT INTO teams (slug, name, max_classification) VALUES ('library', 'Library', 'restricted') RETURNING id`)
	f.upload, f.web = f.source(f.team, "upload"), f.source(f.team, "web")
	f.otherSource, f.shared = f.source(f.other, "upload"), f.source(uuid.Nil, "upload")
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) id(sql string, args ...any) uuid.UUID {
	f.t.Helper()
	var id uuid.UUID
	if err := f.pool.QueryRow(f.ctx, sql, args...).Scan(&id); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (f *fixture) source(team uuid.UUID, typ string) uuid.UUID {
	f.t.Helper()
	var owner any
	if team != uuid.Nil {
		owner = team
	}
	return f.id(`INSERT INTO data_sources (team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, $3, 'open', $4) RETURNING id`,
		owner, typ+" "+uuid.NewString()[:8], typ, f.profile)
}

// teamOf is the team a source's documents carry (NULL for a platform-shared source).
func (f *fixture) teamOf(src uuid.UUID) uuid.NullUUID {
	switch src {
	case f.upload, f.web:
		return uuid.NullUUID{UUID: f.team, Valid: true}
	case f.otherSource:
		return uuid.NullUUID{UUID: f.other, Valid: true}
	}
	return uuid.NullUUID{}
}

// upsert stores an upload the way the upload path does: a new name inserts, an existing one replaces.
func (f *fixture) upsert(q *dbgen.Queries, src uuid.UUID, name string, size int64) dbgen.UpsertUploadedDocumentRow {
	f.t.Helper()
	row, err := q.UpsertUploadedDocument(f.ctx, dbgen.UpsertUploadedDocumentParams{
		ID: uuid.New(), SourceID: src, TeamID: f.teamOf(src), ExternalID: name, Filename: name,
		ContentType: "text/plain", SizeBytes: size, Sha256: "x", BlobKey: "k/" + name,
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return row
}

// exact fails unless every counter read (the usage check, the source and admin pages, the tag list) equals the
// aggregate over the documents, and reconcile finds nothing to correct.
func (f *fixture) exact(when string) {
	f.t.Helper()
	for _, team := range []uuid.UUID{f.team, f.other} {
		var docs, bytes int64
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*), coalesce(sum(size_bytes), 0)::bigint FROM documents WHERE team_id = $1`, team).
			Scan(&docs, &bytes); err != nil {
			f.t.Fatal(err)
		}
		u, err := f.q.TeamDocumentUsage(f.ctx, team)
		if err != nil {
			f.t.Fatal(err)
		}
		c, err := f.q.TeamCounts(f.ctx, team)
		if err != nil {
			f.t.Fatal(err)
		}
		if u.Documents != docs || u.StorageBytes != bytes || c.DocumentCount != docs || c.StorageBytes != bytes {
			f.t.Fatalf("%s: team %s holds %d documents, %d bytes; usage reads %d, %d; the team page %d, %d",
				when, team, docs, bytes, u.Documents, u.StorageBytes, c.DocumentCount, c.StorageBytes)
		}
	}
	f.sourcesExact(when)
	off, err := doccounts.Reconcile(f.ctx, f.q)
	if err != nil {
		f.t.Fatal(err)
	}
	if off["teams"]+off["sources"]+off["tags"] != 0 {
		f.t.Fatalf("%s: reconcile corrected %v", when, off)
	}
}

func (f *fixture) sourcesExact(when string) {
	f.t.Helper()
	ids := []uuid.UUID{f.upload, f.web, f.otherSource, f.shared}
	rows, err := f.pool.Query(f.ctx, `SELECT source_id, status, count(*)::bigint, coalesce(sum(size_bytes), 0)::bigint,
		coalesce(sum(chunk_count), 0)::bigint, count(*) FILTER (WHERE metadata->'pii'->>'state' IN ('flagged', 'held'))::bigint
		FROM documents WHERE source_id = ANY($1) GROUP BY 1, 2`, ids)
	if err != nil {
		f.t.Fatal(err)
	}
	want, err := pgx.CollectRows(rows, pgx.RowToStructByPos[dbgen.SourceDocumentStatsRow])
	if err != nil {
		f.t.Fatal(err)
	}
	got, err := f.q.SourceDocumentStats(f.ctx, ids)
	if err != nil {
		f.t.Fatal(err)
	}
	key := func(r []dbgen.SourceDocumentStatsRow) {
		sort.Slice(r, func(i, j int) bool { return r[i].SourceID.String()+r[i].Status < r[j].SourceID.String()+r[j].Status })
	}
	key(want)
	key(got)
	if !reflect.DeepEqual(want, got) {
		f.t.Fatalf("%s: source stats\n got  %+v\n want %+v", when, got, want)
	}
	for _, src := range ids {
		rows, err := f.pool.Query(f.ctx, `SELECT DISTINCT t FROM documents, unnest(tags) AS t WHERE source_id = $1 ORDER BY 1`, src)
		if err != nil {
			f.t.Fatal(err)
		}
		want, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			f.t.Fatal(err)
		}
		got, err := f.q.ListSourceTags(f.ctx, src)
		if err != nil {
			f.t.Fatal(err)
		}
		if !reflect.DeepEqual(want, got) {
			f.t.Fatalf("%s: tags of %s: got %v, want %v", when, src, got, want)
		}
	}
}

// The counters follow every kind of write to documents: an upload and its replacement, the status changes of
// processing, a personal-data flag, tags on one document and on a whole source, deletes (one document, a re-crawl's
// unseen pages), a source deleted with its documents, a team deleted with everything, and
// platform-shared sources, which count for no team.
func TestCountersFollowEveryWrite(t *testing.T) {
	f := newFixture(t)
	f.exact("empty")
	var docs []uuid.UUID
	for i, src := range []uuid.UUID{f.upload, f.upload, f.web, f.otherSource, f.shared} {
		docs = append(docs, f.upsert(f.q, src, fmt.Sprintf("file-%d.txt", i), int64(100*(i+1))).ID)
	}
	f.exact("uploads")
	if row := f.upsert(f.q, f.upload, "file-0.txt", 5000); row.Inserted {
		t.Fatal("the same name inserted a second document")
	}
	f.exact("a replacement with a different size")
	f.exec(`UPDATE documents SET status = 'queued' WHERE status = 'pending'`)
	f.exec(`UPDATE documents SET status = 'processing' WHERE id = ANY($1)`, docs[:3])
	f.exact("queued and claimed")
	f.exec(`UPDATE documents SET status = 'ready', chunk_count = 7, token_count = 100 WHERE id = $1`, docs[0])
	f.exec(`UPDATE documents SET status = 'failed', error_code = 'parse' WHERE id = $1`, docs[1])
	f.exec(`UPDATE documents SET metadata = jsonb_set(metadata, '{pii}', '{"state": "flagged"}') WHERE id = $1`, docs[0])
	f.exact("finished, failed, flagged")
	if _, err := f.q.SetDocumentTags(f.ctx, dbgen.SetDocumentTagsParams{ID: docs[0], Tags: []string{"policy", "2026"}}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.SetSourceDocumentTags(f.ctx, dbgen.SetSourceDocumentTagsParams{SourceID: f.web, Tags: []string{"web"}}); err != nil {
		t.Fatal(err)
	}
	f.exact("tagged")
	if _, err := f.q.SetDocumentTags(f.ctx, dbgen.SetDocumentTagsParams{ID: docs[0], Tags: []string{"policy"}}); err != nil {
		t.Fatal(err)
	}
	f.exec(`UPDATE documents SET metadata = jsonb_set(metadata, '{pii}', '{"state": "cleared"}') WHERE id = $1`, docs[0])
	f.exact("a tag removed, a review cleared")
	f.exec(`UPDATE documents SET attempts = attempts + 1`)
	f.exact("a change the counters do not count")
	if _, err := f.q.DeleteDocument(f.ctx, docs[1]); err != nil {
		t.Fatal(err)
	}
	f.exact("one document deleted")
	f.deletes()
	if err := f.q.DeleteSource(f.ctx, f.upload); err != nil {
		t.Fatal(err)
	}
	f.exact("a source deleted")
	f.exec(`DELETE FROM teams WHERE id = $1`, f.other)
	var left int
	if err := f.pool.QueryRow(f.ctx, `SELECT (SELECT count(*) FROM team_document_counts WHERE team_id = $1)
		+ (SELECT count(*) FROM source_document_counts WHERE source_id = $2)`, f.other, f.otherSource).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("%d counter rows of a deleted team are left", left)
	}
	f.other, f.otherSource = uuid.New(), uuid.New()
	f.exact("a team deleted")
}

// deletes removes documents the way a re-crawl does (the pages the crawl did not see).
func (f *fixture) deletes() {
	f.t.Helper()
	for i := range 4 {
		f.upsert(f.q, f.web, fmt.Sprintf("page-%d", i), 10)
	}
	crawl := f.id(`INSERT INTO web_crawls (source_id, team_id, status, trigger, config) VALUES ($1, $2, 'running', 'manual', '{}') RETURNING id`, f.web, f.team)
	f.exec(`UPDATE documents SET last_seen_crawl_id = $1 WHERE source_id = $2 AND external_id IN ('page-0', 'page-1')`, crawl, f.web)
	if _, err := f.q.DeleteUnseenDocuments(f.ctx, dbgen.DeleteUnseenDocumentsParams{SourceID: f.web, CrawlID: uuid.NullUUID{UUID: crawl, Valid: true}}); err != nil {
		f.t.Fatal(err)
	}
	f.exact("a re-crawl's unseen pages deleted")
}

// Workers storing and finishing documents of one source at the same time, each in its own transactions (claim, finish),
// leave the counters exact; so does a reconcile running meanwhile.
func TestCountersUnderConcurrentIngest(t *testing.T) {
	f := newFixture(t)
	const workers, per = 12, 25
	var wg sync.WaitGroup
	errs := make(chan error, workers+1)
	for w := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range per {
				if err := f.ingestOne(fmt.Sprintf("w%d-%d.txt", w, i), int64(w*100+i)); err != nil {
					errs <- err
					return
				}
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for range 5 {
			if _, err := doccounts.Reconcile(f.ctx, f.q); err != nil {
				errs <- err
				return
			}
		}
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM documents WHERE status = 'ready'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != workers*per {
		t.Fatalf("%d documents ready, want %d", n, workers*per)
	}
	f.exact("concurrent ingest")
}

// ingestOne stores a document under the team's usage lock (reading the usage, as the limit check does), then claims and
// finishes it in two more transactions, as the dispatcher and the processor do.
func (f *fixture) ingestOne(name string, size int64) error {
	var id uuid.UUID
	err := pgx.BeginFunc(f.ctx, f.pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if err := q.LockTeamUsage(f.ctx, f.team); err != nil {
			return err
		}
		if _, err := q.TeamDocumentUsage(f.ctx, f.team); err != nil {
			return err
		}
		row, err := q.UpsertUploadedDocument(f.ctx, dbgen.UpsertUploadedDocumentParams{
			ID: uuid.New(), SourceID: f.upload, TeamID: f.teamOf(f.upload), ExternalID: name, Filename: name, SizeBytes: size, BlobKey: name,
		})
		id = row.ID
		return err
	})
	if err != nil {
		return err
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET status = 'processing' WHERE id = $1`, id); err != nil {
		return err
	}
	_, err = f.pool.Exec(f.ctx, `UPDATE documents SET status = 'ready', chunk_count = 3, tags = ARRAY['t' || (size_bytes % 3)] WHERE id = $1`, id)
	return err
}

// Documents written before the counters existed (or while only the previous release's servers ran) are counted by the
// backfill migration; counters that are off (here: emptied by hand) are corrected by reconcile.
func TestBackfillAndReconcile(t *testing.T) {
	f := newFixture(t)
	db := stdlib.OpenDBFromPool(f.pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.DownTo(f.ctx, 71); err != nil {
		t.Fatalf("down to 71: %v", err)
	}
	for i, src := range []uuid.UUID{f.upload, f.web, f.otherSource, f.shared} {
		f.exec(`INSERT INTO documents (source_id, team_id, external_id, size_bytes, status, chunk_count, tags, metadata)
			SELECT $1, $2, 'd-' || i, i * 10, CASE WHEN i % 3 = 0 THEN 'ready' ELSE 'failed' END, i, ARRAY['tag-' || (i % 4)],
			       CASE WHEN i % 5 = 0 THEN '{"pii": {"state": "held"}}'::jsonb ELSE '{}'::jsonb END
			FROM generate_series(1, $3::int) AS i`, src, f.teamOf(src), 20+i)
	}
	if _, err := p.UpTo(f.ctx, 73); err != nil {
		t.Fatalf("up to 73: %v", err)
	}
	f.exact("after the backfill")
	f.exec(`DELETE FROM source_document_counts WHERE source_id = $1`, f.web)
	f.exec(`UPDATE team_document_counts SET documents = documents + 5`)
	f.exec(`DELETE FROM source_tag_counts`)
	off, err := doccounts.Reconcile(f.ctx, f.q)
	if err != nil {
		t.Fatal(err)
	}
	if off["teams"] != 2 || off["sources"] != 2 || off["tags"] != 16 {
		t.Fatalf("reconcile corrected %v, want 2 teams, 2 source statuses and 16 source tags", off)
	}
	f.exact("after reconcile")
}

// The daily job corrects counters that are off and says so in a warning; on exact counters it says nothing.
func TestWorkerWarnsWhenItCorrects(t *testing.T) {
	f := newFixture(t)
	f.upsert(f.q, f.upload, "a.txt", 10)
	var logs bytes.Buffer
	w := &doccounts.Worker{Q: f.q, Log: slog.New(slog.NewTextHandler(&logs, nil))}
	if err := w.Work(f.ctx, &river.Job[doccounts.ReconcileArgs]{}); err != nil {
		t.Fatal(err)
	}
	if logs.Len() != 0 {
		t.Fatalf("exact counters logged %q", logs.String())
	}
	f.exec(`DELETE FROM team_document_counts`)
	if err := w.Work(f.ctx, &river.Job[doccounts.ReconcileArgs]{}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(logs.String(), "level=WARN") || !strings.Contains(logs.String(), "teams=1") {
		t.Fatalf("a correction logged %q", logs.String())
	}
	f.exact("after the job")
}
