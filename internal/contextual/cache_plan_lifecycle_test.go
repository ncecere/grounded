package contextual

import (
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

func otherCachePlan(t *testing.T, f settlementFixture, keys ...[32]byte) CachePlan {
	t.Helper()
	id := anotherAdmissionProfile(t, f)
	if _, err := f.pool.Exec(t.Context(), `INSERT INTO set_contextual (source_id, profile_id, model_id, failure_policy, prompt_version)
		VALUES ($1, $2, $3, 'fail', $4)`, f.res.SourceID, id, f.res.ModelID, PromptVersion); err != nil {
		t.Fatal(err)
	}
	return CachePlan{DocumentID: f.res.DocumentID, SourceID: f.res.SourceID, ProfileID: id, Version: 1, Keys: keys}
}

func TestPGCacheProfileMustMatchAdmittedWork(t *testing.T) {
	f := newSettlementFixture(t)
	entry := f.cacheEntry(t, 10, "A description of the registration section.")
	other := otherCachePlan(t, f, entry.Key)
	if err := f.store.RetainCachePlan(t.Context(), other); err != nil {
		t.Fatal(err)
	}
	id, err := f.store.Reserve(t.Context(), f.res)
	if err != nil {
		t.Fatal(err)
	}
	entry.ProfileID = other.ProfileID
	err = f.store.Settle(t.Context(), Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage, Cache: &entry})
	rows, _ := f.ledger(t)
	if err == nil || rows != 0 {
		t.Errorf("cache profile did not match admitted work: err=%v ledgerRows=%d", err, rows)
	}
}

func TestTooLargeReplacementDropsObsoleteCachePlan(t *testing.T) {
	e := newGen(t)
	req := e.req(sections(1))
	if _, err := e.g.Contextualize(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	req.Version++
	req.Chunks = sections(MaxUnitsPerDocument + 1)
	res, err := e.g.Contextualize(t.Context(), req)
	if err != nil || res.State != StateTooLarge || len(e.store.cache) != 0 || len(e.proxy.ContextCalls()) != 1 {
		t.Errorf("too-large replacement retained obsolete cache: result=%+v err=%v artifacts=%d calls=%d", res, err, len(e.store.cache), len(e.proxy.ContextCalls()))
	}
}

func TestPGCachePlanRejectsInvalidOrStaleIdentity(t *testing.T) {
	for _, name := range []string{"stale version", "other source", "missing snapshot", "too many keys", "deleted document"} {
		t.Run(name, func(t *testing.T) {
			f := newSettlementFixture(t)
			entry := f.cacheEntry(t, 11, "A retained registration description.")
			p := CachePlan{DocumentID: entry.DocumentID, SourceID: entry.SourceID, ProfileID: entry.ProfileID, Version: 1, Keys: [][32]byte{entry.Key}}
			wantPlans := 1
			switch name {
			case "stale version":
				p.Version++
			case "other source":
				p.SourceID = uuid.New()
			case "missing snapshot":
				p.ProfileID = uuid.New()
			case "too many keys":
				p.Keys = make([][32]byte, MaxUnitsPerDocument+1)
			case "deleted document":
				wantPlans = 0 // real deletion cascades the prior plan
				if _, err := f.pool.Exec(t.Context(), `DELETE FROM documents WHERE id = $1`, entry.DocumentID); err != nil {
					t.Fatal(err)
				}
			}
			if err := f.store.RetainCachePlan(t.Context(), p); err == nil {
				t.Fatal("invalid/stale plan was accepted")
			}
			var count int
			if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM contextual_cache_plans WHERE document_id = $1 AND profile_id = $2 AND version = 1`, entry.DocumentID, entry.ProfileID).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != wantPlans {
				t.Fatalf("rejected plan changed existing references: got %d want %d", count, wantPlans)
			}
		})
	}
}

func TestPGStaleCachePlanCannotRestoreOldVersion(t *testing.T) {
	f := newSettlementFixture(t)
	old := f.cacheEntry(t, 12, "Old registration description.")
	if err := f.store.PutCache(t.Context(), old); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE documents SET version = 2 WHERE id = $1`, old.DocumentID); err != nil {
		t.Fatal(err)
	}
	current := old
	current.Version, current.Key, current.Text = 2, [32]byte{13}, "Current registration description."
	p := CachePlan{DocumentID: current.DocumentID, SourceID: current.SourceID, ProfileID: current.ProfileID, Version: 2, Keys: [][32]byte{current.Key}}
	if err := f.store.RetainCachePlan(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	if err := f.store.PutCache(t.Context(), current); err != nil {
		t.Fatal(err)
	}
	p.Version, p.Keys = 1, [][32]byte{old.Key}
	if err := f.store.RetainCachePlan(t.Context(), p); err == nil {
		t.Fatal("old version restored a plan")
	}
	cached, err := f.store.CacheFor(t.Context(), old.DocumentID, [][32]byte{old.Key, current.Key})
	if err != nil || len(cached) != 1 || cached[current.Key] != current.Text {
		t.Fatalf("stale plan evicted/replaced current artifact: %v %v", cached, err)
	}
}

func TestPGPaidReplyForDiscardedOrStalePlanKeepsUsageOnly(t *testing.T) {
	for _, name := range []string{"discarded", "new document version"} {
		t.Run(name, func(t *testing.T) {
			f := newSettlementFixture(t)
			entry := f.cacheEntry(t, 14, "A paid registration description.")
			id, err := f.store.Reserve(t.Context(), f.res)
			if err != nil {
				t.Fatal(err)
			}
			if name == "discarded" {
				err = dbgen.New(f.pool).DeleteSetContextual(t.Context(), dbgen.DeleteSetContextualParams{SourceID: entry.SourceID, ProfileID: entry.ProfileID})
			} else {
				_, err = f.pool.Exec(t.Context(), `UPDATE documents SET version = 2 WHERE id = $1`, entry.DocumentID)
			}
			if err != nil {
				t.Fatal(err)
			}
			err = f.store.Settle(t.Context(), Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage, Cache: &entry})
			var stopped *StopError
			if !errors.As(err, &stopped) {
				t.Fatalf("discarded/stale plan did not stop publication: %v", err)
			}
			if rows, tokens := f.ledger(t); rows != 2 || tokens != 10 {
				t.Fatalf("paid usage was lost: %d/%d", rows, tokens)
			}
			cached, err := f.store.CacheFor(t.Context(), entry.DocumentID, [][32]byte{entry.Key})
			if err != nil || len(cached) != 0 {
				t.Fatalf("discarded/stale work published cached text: %v %v", cached, err)
			}
			var outcome string
			if err := f.pool.QueryRow(t.Context(), `SELECT outcome FROM contextual_calls WHERE id = $1`, id).Scan(&outcome); err != nil {
				t.Fatal(err)
			}
			if outcome != OutcomeOK {
				t.Fatalf("real successful call outcome = %s", outcome)
			}
		})
	}
}

func TestPGSnapshotRemovalPrunesOnlyUnreferencedArtifacts(t *testing.T) {
	f := newSettlementFixture(t)
	shared, own, otherKey := [32]byte{15}, [32]byte{16}, [32]byte{17}
	p := CachePlan{DocumentID: f.res.DocumentID, SourceID: f.res.SourceID, ProfileID: f.res.ProfileID, Version: 1, Keys: [][32]byte{shared, own}}
	other := otherCachePlan(t, f, shared, otherKey)
	for _, plan := range []CachePlan{p, other} {
		if err := f.store.RetainCachePlan(t.Context(), plan); err != nil {
			t.Fatal(err)
		}
	}
	for _, key := range [][32]byte{shared, own, otherKey} {
		if err := f.store.PutCache(t.Context(), CacheEntry{DocumentID: p.DocumentID, SourceID: p.SourceID, Key: key, Text: "A retained context description."}); err != nil {
			t.Fatal(err)
		}
	}
	q := dbgen.New(f.pool)
	if err := q.DeleteSetContextual(t.Context(), dbgen.DeleteSetContextualParams{SourceID: p.SourceID, ProfileID: p.ProfileID}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.PruneSourceContextualCache(t.Context(), p.SourceID); err != nil {
		t.Fatal(err)
	}
	cached, err := f.store.CacheFor(t.Context(), p.DocumentID, [][32]byte{shared, own, otherKey})
	if err != nil || len(cached) != 2 || cached[shared] == "" || cached[otherKey] == "" {
		t.Fatalf("removed profile lost another profile's shared/artifacts: %v %v", cached, err)
	}
	if err := q.DeleteSetContextual(t.Context(), dbgen.DeleteSetContextualParams{SourceID: p.SourceID, ProfileID: other.ProfileID}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.PruneSourceContextualCache(t.Context(), p.SourceID); err != nil {
		t.Fatal(err)
	}
	if n, err := q.CountSourceContextualCache(t.Context(), p.SourceID); err != nil || n != 0 {
		t.Fatalf("last profile left cache: %d %v", n, err)
	}
}

func TestPGDocumentAndSourceDeletionCascadeCachePlans(t *testing.T) {
	for _, name := range []string{"document", "source"} {
		t.Run(name, func(t *testing.T) {
			f := newSettlementFixture(t)
			entry := f.cacheEntry(t, 18, "A retained context description.")
			if err := f.store.PutCache(t.Context(), entry); err != nil {
				t.Fatal(err)
			}
			sql, id := `DELETE FROM documents WHERE id = $1`, entry.DocumentID
			if name == "source" {
				sql, id = `DELETE FROM data_sources WHERE id = $1`, entry.SourceID
			}
			if _, err := f.pool.Exec(t.Context(), sql, id); err != nil {
				t.Fatal(err)
			}
			var remaining int
			if err := f.pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM contextual_cache) + (SELECT count(*) FROM contextual_cache_plans)`).Scan(&remaining); err != nil {
				t.Fatal(err)
			}
			if remaining != 0 {
				t.Fatalf("%s deletion left %d cache/plan rows", name, remaining)
			}
		})
	}
}

func TestConcurrentProfilePlansPreserveBothArtifacts(t *testing.T) {
	e := newGen(t)
	exerciseConcurrentPlans(t, e, e.req(nil), uuid.New())
}

func TestPGConcurrentProfilePlansPreserveBothArtifacts(t *testing.T) {
	e, req, other := newPGProfileCacheEnv(t)
	exerciseConcurrentPlans(t, e, req, other)
}

func exerciseConcurrentPlans(t *testing.T, e *genEnv, a Request, other uuid.UUID) {
	t.Helper()
	large, small := profilePlanChunks(t)
	a.Chunks = large
	b := a
	b.ProfileID, b.Chunks = other, small
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, req := range []Request{a, b} {
		wg.Go(func() {
			<-start
			if _, err := e.g.Contextualize(t.Context(), req); err != nil {
				t.Error(err)
			}
		})
	}
	close(start)
	wg.Wait()
	if t.Failed() {
		return
	}
	if len(e.proxy.ContextCalls()) != 3 {
		t.Fatalf("concurrent plans made %d calls", len(e.proxy.ContextCalls()))
	}
	for _, req := range []Request{a, b} {
		res, err := e.g.Contextualize(t.Context(), req)
		if err != nil || res.Calls != 0 {
			t.Fatalf("concurrent profile lost cache: %+v %v", res, err)
		}
	}
}
