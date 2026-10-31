package contextual

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Same source text/heading/title, cut into three larger or nine smaller
// passages. The eight-passage unit bound gives one versus two context units.
func profilePlanChunks(t *testing.T) ([]chunk.Chunk, []chunk.Chunk) {
	t.Helper()
	counter := counter(t)
	var paragraphs []string
	for i := range 9 {
		paragraphs = append(paragraphs, fmt.Sprintf("Library rule %d. %s", i,
			strings.Repeat("Students may borrow books from the university library and should renew loans before the stated due date. ", 2)))
	}
	makeChunks := func(width int) []chunk.Chunk {
		var out []chunk.Chunk
		for i := 0; i < len(paragraphs); i += width {
			text := strings.Join(paragraphs[i:min(i+width, len(paragraphs))], "\n\n")
			out = append(out, chunk.Chunk{Ordinal: len(out), HeadingPath: []string{"Library"}, Content: text, Tokens: counter.Count(text)})
		}
		return out
	}
	return makeChunks(3), makeChunks(1)
}

func exerciseActiveProfileCache(t *testing.T, e *genEnv, req Request, otherProfile uuid.UUID) {
	t.Helper()
	large, small := profilePlanChunks(t)
	req.Chunks = large
	first, err := e.g.Contextualize(t.Context(), req)
	if err != nil || first.Calls != 1 {
		t.Fatalf("first plan = %+v err=%v", first, err)
	}
	other := req
	other.ProfileID, other.Chunks = otherProfile, small
	second, err := e.g.Contextualize(t.Context(), other)
	if err != nil || second.Calls != 2 {
		t.Fatalf("second plan = %+v err=%v", second, err)
	}
	before := len(e.proxy.ContextCalls())
	replay, err := e.g.Contextualize(t.Context(), req)
	if err != nil || replay.Calls != 0 || replay.Cached != 1 || len(e.proxy.ContextCalls()) != before {
		t.Errorf("active profile lost its cached plan: result=%+v err=%v callsBefore=%d callsAfter=%d", replay, err, before, len(e.proxy.ContextCalls()))
	}
}

func TestActiveProfileCacheSurvivesAnotherPassagePlan(t *testing.T) {
	e := newGen(t)
	exerciseActiveProfileCache(t, e, e.req(nil), uuid.New())
}

func TestIdenticalProfilePlansStillShareArtifacts(t *testing.T) {
	e := newGen(t)
	req := e.req(sections(1))
	if _, err := e.g.Contextualize(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	req.ProfileID = uuid.New()
	res, err := e.g.Contextualize(t.Context(), req)
	if err != nil || res.Calls != 0 || res.Cached != 1 || len(e.proxy.ContextCalls()) != 1 {
		t.Fatalf("identical profile plan did not share artifact: result=%+v err=%v calls=%d", res, err, len(e.proxy.ContextCalls()))
	}
}

func TestPGActiveProfileCacheSurvivesAnotherPassagePlan(t *testing.T) {
	e, req, other := newPGProfileCacheEnv(t)
	exerciseActiveProfileCache(t, e, req, other)
}

func newPGProfileCacheEnv(t *testing.T) (*genEnv, Request, uuid.UUID) {
	t.Helper()
	f := newSettlementFixture(t)
	e := newGen(t)
	otherProfile := anotherAdmissionProfile(t, f)
	_, err := f.pool.Exec(t.Context(), `UPDATE models SET upstream_model = 'ctx-writer', context_window = 32000 WHERE id = $1`, f.res.ModelID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.pool.Exec(t.Context(), `UPDATE embedding_profiles SET contextual = true WHERE id = $1 OR id = $2`, f.res.ProfileID, otherProfile)
	if err != nil {
		t.Fatal(err)
	}
	for _, profile := range []uuid.UUID{f.res.ProfileID, otherProfile} {
		_, err = f.pool.Exec(t.Context(), `INSERT INTO set_contextual (source_id, profile_id, model_id, failure_policy, prompt_version)
			VALUES ($1, $2, $3, 'fail', $4) ON CONFLICT (source_id, profile_id) DO NOTHING`, f.res.SourceID, profile, f.res.ModelID, PromptVersion)
		if err != nil {
			t.Fatal(err)
		}
	}
	m, err := dbgen.New(f.pool).GetModel(t.Context(), f.res.ModelID)
	if err != nil {
		t.Fatal(err)
	}
	client := e.g.Catalog.(fixedResolver).target.Client
	e.g.Catalog = fixedResolver{catalog.ChatTarget{Model: m, Client: client}}
	e.g.Store = f.store
	req := e.req(nil)
	req.SourceID, req.ProfileID, req.DocumentID, req.Model = f.res.SourceID, f.res.ProfileID, f.res.DocumentID, f.res.ModelID
	req.Team = f.usage.Team
	return e, req, otherProfile
}
