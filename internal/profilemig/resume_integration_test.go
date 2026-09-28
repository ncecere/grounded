package profilemig_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/profilemig"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// resumeEnv is a KB of docs ready documents on profile "from", with a
// target "to" that has the same chunk settings (passages are copied), and
// a set worker run by hand (no River).
type resumeEnv struct {
	svc      *profilemig.Service
	worker   *profilemig.SetWorker
	proxy    *testutil.FakeProxy
	kb, src  uuid.UUID
	from, to uuid.UUID
	scalar   func(sql string, args ...any) int64
}

func newResumeEnv(t *testing.T, docs int) *resumeEnv {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	env := &resumeEnv{proxy: testutil.NewFakeProxy(t), kb: uuid.New(), src: uuid.New(), from: uuid.New(), to: uuid.New()}
	env.scalar = func(sql string, args ...any) int64 {
		t.Helper()
		var n int64
		if err := pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}
	env.proxy.AddEmbeddingModel("e8", 8)
	env.proxy.AddEmbeddingModel("e16", 16)
	key, _ := secrets.ParseKey("MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=")
	box, err := secrets.New(key)
	if err != nil {
		t.Fatal(err)
	}
	cat := catalog.NewService(pool, box)
	admin := authz.Actor{PlatformRole: authz.PlatformAdmin, UserID: uuid.New()}
	exec(`INSERT INTO users (id, oidc_issuer, oidc_subject, email, platform_role) VALUES ($1, 'dev', 'admin', 'admin@example.edu', 'platform_admin')`, admin.UserID)
	conn, err := cat.CreateConnection(ctx, admin, catalog.ConnectionInput{Name: "Proxy", BaseURL: env.proxy.BaseURL(), APIKey: env.proxy.APIKey, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []struct {
		id    uuid.UUID
		model string
		dims  int
	}{{env.from, "e8", 8}, {env.to, "e16", 16}} {
		model := uuid.New()
		exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions)
			VALUES ($1, $2, $3, $3, $3, 'embedding', 'restricted', $4)`, model, conn.ID, p.model, p.dims)
		exec(`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap)
			VALUES ($1, $2, $2, $3, $4, 'halfvec', 512, 0)`, p.id, "p-"+p.model, model, p.dims)
	}
	team := uuid.New()
	exec(`INSERT INTO teams (id, slug, name, max_classification) VALUES ($1, 'registrar', 'Registrar', 'sensitive')`, team)
	exec(`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, 'Pages', 'upload', 'open', $3)`, env.src, team, env.from)
	exec(`INSERT INTO knowledge_bases (id, team_id, name, embedding_profile_id) VALUES ($1, $2, 'Pages', $3)`, env.kb, team, env.from)
	exec(`INSERT INTO kb_sources (kb_id, source_id) VALUES ($1, $2)`, env.kb, env.src)
	for i := 0; i < docs; i++ {
		doc := uuid.New()
		exec(`INSERT INTO documents (id, source_id, team_id, external_id, title, status, chunk_count, token_count) VALUES ($1, $2, $3, $4, $4, 'ready', 1, 5)`,
			doc, env.src, team, fmt.Sprintf("doc-%02d.md", i))
		exec(`INSERT INTO chunks (id, document_id, source_id, profile_id, ordinal, content, token_count, content_tsv)
			VALUES (gen_random_uuid(), $1, $2, $3, 0, $4, 5, to_tsvector('english', $4))`, doc, env.src, env.from, fmt.Sprintf("Passage number %d about enrollment.", i))
	}
	counter, err := chunk.NewTokenCounter()
	if err != nil {
		t.Fatal(err)
	}
	log := testutil.Logger()
	env.svc = profilemig.New(pool, cat, teams.NewService(pool), nil, nil, profilemig.Options{GraceDays: 7}, log)
	proc := &ingest.Processor{Pool: pool, Catalog: cat, Counter: counter, Vectors: &vectorstore.PGVector{Pool: pool}, EmbedBatch: 64, Log: log}
	env.worker = &profilemig.SetWorker{S: env.svc, P: proc, Parallel: 1}
	m, err := env.svc.Start(ctx, admin, profilemig.StartInput{KBID: env.kb, TargetProfileID: env.to})
	if err != nil {
		t.Fatal(err)
	}
	if m.ProfileMigration.Status != profilemig.StatusRunning {
		t.Fatalf("started = %s", m.ProfileMigration.Status)
	}
	return env
}

func (env *resumeEnv) run(ctx context.Context) error {
	return env.worker.Work(ctx, &river.Job[ingest.SetArgs]{JobRow: &rivertype.JobRow{}, Args: ingest.SetArgs{SourceID: env.src, ProfileID: env.to}})
}

func (env *resumeEnv) done() int64 {
	return env.scalar(`SELECT count(DISTINCT document_id) FROM chunks WHERE source_id = $1 AND profile_id = $2`, env.src, env.to)
}

// switched reports whether the KB uses the target profile.
func (env *resumeEnv) switched() bool {
	return env.scalar(`SELECT count(*) FROM knowledge_bases WHERE id = $1 AND embedding_profile_id = $2`, env.kb, env.to) == 1
}

// The job works in bounded steps: out of budget, it stops (snoozes) and
// the next run continues with the documents left; an interrupted run
// records no failures and loses nothing; the last run switches the KB.
// Documents already done are never embedded again.
func TestSetJobResumes(t *testing.T) {
	const docs = 40
	env := newResumeEnv(t, docs)
	ctx := context.Background()

	// A tiny budget: one step (32 documents), then it yields.
	env.worker.Budget = time.Nanosecond
	var snooze *rivertype.JobSnoozeError
	if err := env.run(ctx); !errors.As(err, &snooze) {
		t.Fatalf("first run = %v, want a snooze", err)
	}
	if n := env.done(); n != 32 {
		t.Fatalf("after one step: %d documents done", n)
	}
	if env.switched() {
		t.Fatal("switched before every document was done")
	}

	// Interrupted mid-way (the worker shut down): nothing is recorded as
	// failed.
	env.proxy.SetEmbedLatency(300 * time.Millisecond)
	ictx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	_ = env.run(ictx)
	cancel()
	env.proxy.SetEmbedLatency(0)
	if n := env.scalar(`SELECT count(*) FROM embedding_set_failures`); n != 0 {
		t.Fatalf("failures after an interruption = %d", n)
	}

	env.worker.Budget = time.Minute
	if err := env.run(ctx); err != nil {
		t.Fatalf("last run = %v", err)
	}
	if n := env.done(); n != docs {
		t.Fatalf("done = %d", n)
	}
	if !env.switched() {
		t.Fatal("the KB switched once every document was done")
	}
	// Each document was embedded once, plus at most the one in flight when
	// the run was interrupted.
	inputs := 0
	for _, n := range env.proxy.EmbedBatches() {
		inputs += n
	}
	if inputs < docs || inputs > docs+1 {
		t.Errorf("inputs embedded = %d for %d documents", inputs, docs)
	}
	// Running again changes nothing.
	if err := env.run(ctx); err != nil || env.done() != docs {
		t.Fatalf("idempotent rerun = %v, %d", err, env.done())
	}
}

// A second job for the same set waits while one runs.
func TestSetJobOnePerSet(t *testing.T) {
	env := newResumeEnv(t, 3)
	env.proxy.SetEmbedLatency(500 * time.Millisecond)
	first := make(chan error, 1)
	go func() { first <- env.run(context.Background()) }()
	time.Sleep(150 * time.Millisecond)
	var snooze *rivertype.JobSnoozeError
	if err := env.run(context.Background()); !errors.As(err, &snooze) || snooze.Duration <= 0 {
		t.Fatalf("second job = %v, want a snooze while the first runs", err)
	}
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	if env.done() != 3 {
		t.Fatalf("done = %d", env.done())
	}
}
