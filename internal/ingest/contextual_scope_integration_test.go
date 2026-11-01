package ingest

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/contextual"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

type contextualScopeFixture struct {
	p                              *Processor
	pool                           *pgxpool.Pool
	sc                             ctxScope
	target                         catalog.EmbedTarget
	chat, connection, otherProfile uuid.UUID
}

// Metadata only. No gateway/client is configured and no remote request runs.
func newContextualScopeFixture(t *testing.T) contextualScopeFixture {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(t.Context(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	conn, embed, chat, profile, other, source := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://example.test/v1')`, conn)
	exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions)
		VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, embed, conn)
	exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, context_window)
		VALUES ($1, $2, 'c', 'c', 'C', 'chat', 'open', 32000)`, chat, conn)
	for _, id := range []uuid.UUID{profile, other} {
		exec(`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap, contextual)
			VALUES ($1, $2, 'Contextual', $3, 4, 'halfvec', 128, 0, true)`, id, id.String(), embed)
	}
	exec(`INSERT INTO data_sources (id, name, type, classification, embedding_profile_id) VALUES ($1, 'Source', 'web', 'open', $2)`, source, profile)
	exec(`INSERT INTO source_contextual (source_id, enabled, model_id, max_tokens, max_tokens_per_day, max_amount, max_amount_per_day, currency)
		VALUES ($1, true, $2, 100000, 100000, 1, 1, 'USD')`, source, chat)
	exec(`INSERT INTO set_contextual (source_id, profile_id, model_id, failure_policy, prompt_version)
		VALUES ($1, $2, $3, 'fail', $4)`, source, profile, chat, contextual.PromptVersion)
	q := dbgen.New(pool)
	src, err := q.GetSource(t.Context(), source)
	if err != nil {
		t.Fatal(err)
	}
	return contextualScopeFixture{p: &Processor{Pool: pool, Contextual: &contextual.Generator{}}, pool: pool,
		sc: ctxScope{src: src, own: true}, target: catalog.EmbedTarget{Profile: dbgen.EmbeddingProfile{ID: profile, Contextual: true}},
		chat: chat, connection: conn, otherProfile: other}
}

func TestContextualCheckpointStopsReplacedOwnProfile(t *testing.T) {
	f := newContextualScopeFixture(t)
	check := f.p.checkpoint(f.sc, f.target, f.chat)
	if err := check(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE data_sources SET embedding_profile_id = $2 WHERE id = $1`, f.sc.src.ID, f.otherProfile); err != nil {
		t.Fatal(err)
	}
	if err := check(t.Context()); err == nil {
		t.Fatal("old own-profile checkpoint remained eligible after source profile replacement")
	}
}

func TestContextualSnapshotRejectsUnsupportedPromptVersion(t *testing.T) {
	for _, version := range []int{contextual.PromptVersion - 1, contextual.PromptVersion + 1} {
		f := newContextualScopeFixture(t)
		supported, err := f.p.snapshot(t.Context(), dbgen.New(f.pool), f.sc.src.ID, f.target)
		if err != nil || supported == nil || supported.PromptVersion != contextual.PromptVersion {
			t.Fatalf("current private snapshot unsupported: %+v %v", supported, err)
		}
		if _, err := f.pool.Exec(t.Context(), `UPDATE set_contextual SET prompt_version = $2 WHERE source_id = $1`, f.sc.src.ID, version); err != nil {
			t.Fatal(err)
		}
		snapshot, err := f.p.snapshot(t.Context(), dbgen.New(f.pool), f.sc.src.ID, f.target)
		if err == nil || snapshot != nil {
			t.Fatalf("worker accepted unsupported prompt version %d", version)
		}
	}
}

func TestContextualCheckpointChecksCurrentConnection(t *testing.T) {
	f := newContextualScopeFixture(t)
	check := f.p.checkpoint(f.sc, f.target, f.chat)
	if err := check(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE model_connections SET enabled = false WHERE id = $1`, f.connection); err != nil {
		t.Fatal(err)
	}
	if err := check(t.Context()); err == nil {
		t.Fatal("checkpoint accepted a disabled context-model connection")
	}
}

func TestContextualCheckpointChecksCurrentModelWindow(t *testing.T) {
	f := newContextualScopeFixture(t)
	check := f.p.checkpoint(f.sc, f.target, f.chat)
	if err := check(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE models SET context_window = 128 WHERE id = $1`, f.chat); err != nil {
		t.Fatal(err)
	}
	if err := check(t.Context()); err == nil {
		t.Fatal("checkpoint accepted a context window too small for the bounded prompt")
	}
}

func TestContextualCheckpointChecksUnknownModelWindow(t *testing.T) {
	f := newContextualScopeFixture(t)
	check := f.p.checkpoint(f.sc, f.target, f.chat)
	if err := check(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE models SET context_window = NULL WHERE id = $1`, f.chat); err != nil {
		t.Fatal(err)
	}
	err := check(t.Context())
	var failure *contextual.Failure
	if !errors.As(err, &failure) || failure.Code != contextual.CodeModelError || !failure.Permanent {
		t.Fatalf("checkpoint did not stop unknown model window as a permanent configuration error: %v", err)
	}
}

func TestContextualCheckpointStillStopsDeletingExtraSet(t *testing.T) {
	f := newContextualScopeFixture(t)
	f.sc.own = false
	f.target.Profile.ID = f.otherProfile
	if _, err := f.pool.Exec(t.Context(), `INSERT INTO source_embedding_sets (source_id, profile_id, status) VALUES ($1, $2, 'building')`, f.sc.src.ID, f.otherProfile); err != nil {
		t.Fatal(err)
	}
	check := f.p.checkpoint(f.sc, f.target, f.chat)
	if err := check(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE source_embedding_sets SET status = 'deleting' WHERE source_id = $1 AND profile_id = $2`, f.sc.src.ID, f.otherProfile); err != nil {
		t.Fatal(err)
	}
	if err := check(t.Context()); err == nil {
		t.Fatal("deleting extra-set checkpoint remained eligible")
	}
}
