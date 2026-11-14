// Hybrid search over one KB: vector and full-text candidates merged with
// weighted reciprocal rank fusion (see fusion.go).

package kbs

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel/attribute"
	"golang.org/x/sync/errgroup"

	"github.com/ncecere/grounded/internal/access"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/tracing"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// LexicalSQL ranks chunks by full-text match within the KB's sources.
// Natural-language questions rarely have every word in the answer, so the
// query ORs the question's stemmed, stopword-free lexemes and ranks by how
// often they match (ts_rank, normalised by 1 + log(document length)),
// rather than requiring all of them. ts_rank beat ts_rank_cd (cover
// density) on both evaluation sets and is twice as fast; ranking chunks that
// match every term first (websearch_to_tsquery) did not help measurably
// (docs/benchmarks/scale-10k.md, "Fusion tuning").
// Only the KB's profile's chunks count ($4): during a profile migration a
// document also has chunks for the other profile (ADR-0007). Metadata
// filters join documents (the second %s is the document condition); the first
// %s is that join, left out when nothing filters on documents so that every
// matching chunk is not looked up in documents before the sort.
const lexicalSQL = `
WITH q AS (
    SELECT to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) AS query
    FROM unnest(to_tsvector('english', $1))
)
SELECT c.id FROM chunks c%s, q
WHERE q.query IS NOT NULL AND c.source_id = ANY($2::uuid[]) AND c.profile_id = $4 AND c.content_tsv @@ q.query AND %s
ORDER BY ts_rank(c.content_tsv, q.query, 1) DESC, c.id
LIMIT $3`

// LexicalSQL is the full-text query for a document condition over documents d
// ("true": no condition, and no join). Its parameters are the question, the
// source IDs, the limit and the profile ID, then the condition's own.
func LexicalSQL(docSQL string) string {
	join := " JOIN documents d ON d.id = c.document_id"
	if docSQL == "true" {
		join = ""
	}
	return fmt.Sprintf(lexicalSQL, join, docSQL)
}

// EmbedCache reuses query embeddings within one request (several KBs may
// share a profile). The zero value is ready to use; it is safe for
// concurrent use. Searches running at once for the same text embed it once
// (claim): an answer's searches of one model turn run concurrently (#251), and
// they embed, and count tokens for, what the same searches one after another
// would.
type EmbedCache struct {
	mu       sync.Mutex
	vectors  map[string][]float32
	inflight map[string]chan struct{}
}

// claim returns the cached vector (ok), or makes the caller the one to embed the text (wait nil: it must call
// done), or returns a channel closed when the caller embedding it now is done (then claim again).
func (c *EmbedCache) claim(key string) (vec []float32, ok bool, wait <-chan struct{}) {
	if c == nil {
		return nil, false, nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if v, found := c.vectors[key]; found {
		return v, true, nil
	}
	if ch, busy := c.inflight[key]; busy {
		return nil, false, ch
	}
	if c.inflight == nil {
		c.inflight = map[string]chan struct{}{}
	}
	c.inflight[key] = make(chan struct{})
	return nil, false, nil
}

// done ends a claim: the vector is stored (nil: embedding failed, and the next claim tries again) and waiters wake.
func (c *EmbedCache) done(key string, v []float32) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if v != nil {
		if c.vectors == nil {
			c.vectors = map[string][]float32{}
		}
		c.vectors[key] = v
	}
	if ch, ok := c.inflight[key]; ok {
		close(ch)
		delete(c.inflight, key)
	}
}

func (c *EmbedCache) get(key string) ([]float32, bool) {
	if c == nil {
		return nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.vectors[key]
	return v, ok
}

// Lookup returns the query vector a search of this request already computed
// for the text in a profile, without embedding anything (the gap report
// reuses it, docs/v0.4.0.md §2).
func (c *EmbedCache) Lookup(profileID uuid.UUID, text string) ([]float32, bool) {
	return c.get(profileID.String() + "\x00" + text)
}

// SearchParams is one internal search of one KB.
type SearchParams struct {
	Text   string
	TopK   int            // results to return (1-50)
	Filter MetadataFilter // already normalized
	User   string         // gateway usage tag
	Cache  *EmbedCache    // optional
	// CollapseParents merges the hits that share a parent (profiles with parents, docs/parent-child-retrieval.md) into the best-ranked one
	// before the best TopK are kept, and sets each hit's Parent. Agents set it; retrieval for people and callers returns passages as before.
	CollapseParents bool
	// Caller is whose document permissions apply (docs/specs/document-acls/DESIGN.md). Required: a search with an undecided
	// caller fails (access.ErrNoCaller), so a new call site must choose access.Anyone() or a person's caller.
	Caller access.Caller
}

// SearchResult is an internal search result. EmbedTokens is 0 when the query
// vector came from the cache or no embedding was needed.
type SearchResult struct {
	Hits         []Hit
	EmbedTokens  int
	EmbedModelID uuid.UUID
}

// Search runs hybrid search over one resolved KB: vector and full-text
// candidates within the KB's sources (narrowed by the filter), merged with
// weighted reciprocal rank fusion (the KB's weights, else its profile's,
// else the platform's). It checks no permissions and writes no usage: the
// caller (Retrieve, or an agent, which is the grant) does both.
func (s *Service) Search(ctx context.Context, kb KB, p SearchParams) (res SearchResult, err error) {
	ctx, span := tracing.Start(ctx, "retrieval.search", attribute.String("grounded.kb_id", kb.ID.String()),
		attribute.String("grounded.team_id", kb.TeamID.String()), attribute.Int("grounded.retrieval.top_k", p.TopK))
	defer func(start time.Time) {
		observability.ObserveRetrieval(time.Since(start), err)
		span.SetAttributes(attribute.Int("grounded.retrieval.results", len(res.Hits)), attribute.Int("grounded.retrieval.embed_tokens", res.EmbedTokens))
		tracing.End(span, err)
	}(time.Now())
	return s.search(ctx, kb, p)
}

func (s *Service) search(ctx context.Context, kb KB, p SearchParams) (SearchResult, error) {
	var res SearchResult
	if !p.Caller.Set() {
		return res, access.ErrNoCaller
	}
	sourceIDs := searchSources(kb, p.Filter)
	if len(sourceIDs) == 0 {
		res.Hits = []Hit{}
		return res, nil
	}
	k := max(1, min(p.TopK, 50))
	target, err := s.Catalog.QueryEmbedTarget(ctx, kb.EmbeddingProfileID) // cached briefly (internal/catalog/rowcache.go)
	if err != nil {
		return res, err
	}
	res.EmbedModelID = target.Model.ID
	candidates := max(k*4, 20)
	prof := vectorstore.Profile{ID: target.Profile.ID, Dimensions: int(target.Profile.Dimensions), StorageType: target.Profile.StorageType}
	docs := p.Filter.docs()
	// Candidates skip documents the caller may not read only where some exist, so an install that restricts nothing keeps
	// its plans; loadHits checks permissions on every read of passage text regardless.
	restricted, err := s.SourcesHaveRestricted(ctx, sourceIDs)
	if err != nil {
		return res, err
	}
	if restricted {
		docs.Restricted, docs.Principals = true, p.Caller.Principals()
	}
	// The profile's default weights as loaded with the target, so a change
	// applies at once.
	kb.ProfileWeights = storedWeights(target.Profile.DefaultVectorWeight, target.Profile.DefaultKeywordWeight)
	weights, _ := kb.Weights(s.Weights)
	// The two searches run together (DESIGN.md §6): the full-text one needs
	// only the question, so it does not wait for the embedding call.
	var (
		vec     []float32
		vhits   []vectorstore.Hit
		lexical []uuid.UUID
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() (err error) {
		if vec, res.EmbedTokens, err = queryVector(gctx, target, kb.EmbeddingProfileID, p); err != nil {
			return err
		}
		estimated, err := s.vectorCount(gctx, kb.ID, sourceIDs)
		if err != nil {
			return err
		}
		vhits, err = s.vectorSearch(gctx, prof, vec, vectorstore.Filter{SourceIDs: sourceIDs, Estimated: estimated, Docs: docs}, candidates)
		return err
	})
	if weights.Keyword > 0 {
		g.Go(func() (err error) {
			lexical, err = s.lexicalSearch(gctx, p.Text, sourceIDs, prof.ID, candidates, docs)
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return res, err
	}
	collapse := p.CollapseParents && target.Profile.ParentTokens > 0 && !s.ParentExpansionOff
	keep := k
	if collapse {
		keep = len(vhits) + len(lexical) // every candidate: siblings are merged before the cut, so they do not crowd out other matches
	}
	ranked := fuse(ctx, kb.ID, vhits, lexical, weights, keep)
	if collapse {
		if ranked, err = s.collapseParents(ctx, prof.ID, target.Profile.ParentTokens, sourceIDs, ranked, k); err != nil {
			return res, err
		}
	}
	if err := s.fillDistances(ctx, prof, vec, ranked); err != nil {
		return res, err
	}
	res.Hits, err = s.loadHits(ctx, ranked, p.Caller)
	return res, err
}

// searchSources lists the KB's sources that the filter keeps.
func searchSources(kb KB, f MetadataFilter) []uuid.UUID {
	sourceIDs := make([]uuid.UUID, 0, len(kb.Sources))
	allowed := map[uuid.UUID]bool{}
	for _, id := range f.SourceIDs {
		allowed[id] = true
	}
	for _, src := range kb.Sources {
		if len(allowed) == 0 || allowed[src.ID] {
			sourceIDs = append(sourceIDs, src.ID)
		}
	}
	return sourceIDs
}

// EmbedQuery embeds a query in a profile as a search would (or takes it
// from the cache) and leaves it in the cache, so the request's searches
// reuse it (the answer cache's near-identical lookup, docs/answer-cache.md).
// tokens is 0 for a cached vector; modelID is the profile's model.
func (s *Service) EmbedQuery(ctx context.Context, profileID uuid.UUID, text, user string, cache *EmbedCache) (vec []float32, tokens int, modelID uuid.UUID, err error) {
	target, err := s.Catalog.QueryEmbedTarget(ctx, profileID)
	if err != nil {
		return nil, 0, uuid.Nil, err
	}
	vec, tokens, err = queryVector(ctx, target, profileID, SearchParams{Text: text, User: user, Cache: cache})
	return vec, tokens, target.Model.ID, err
}

// queryVector embeds the query text (or takes it from the cache). tokens is
// 0 for a cached vector. Gateway failures become ErrModelUnavailable, with
// Retry-After under backpressure.
func queryVector(ctx context.Context, target catalog.EmbedTarget, profileID uuid.UUID, p SearchParams) (vec []float32, tokens int, err error) {
	cacheKey := profileID.String() + "\x00" + p.Text
	for {
		vec, ok, wait := p.Cache.claim(cacheKey)
		if ok {
			return vec, 0, nil
		}
		if wait == nil {
			break
		}
		select { // another search of this request is embedding the same text
		case <-wait:
		case <-ctx.Done():
			return nil, 0, ctx.Err()
		}
	}
	emb, err := target.Embed(ctx, []string{target.Profile.QueryPrefix + p.Text}, p.User)
	if err != nil {
		p.Cache.done(cacheKey, nil)
		var ge *gateway.Error
		if errors.As(err, &ge) {
			if ge.Backpressure() {
				e := *ErrModelUnavailable
				e.RetryAfter = max(ge.RetryAfter, time.Second)
				return nil, 0, &e
			}
			return nil, 0, ErrModelUnavailable
		}
		return nil, 0, err
	}
	vec = emb.Vectors[0]
	p.Cache.done(cacheKey, vec)
	return vec, max(emb.Usage.TotalTokens, 1), nil
}

// vectorSearch returns vector candidates.
func (s *Service) vectorSearch(ctx context.Context, prof vectorstore.Profile, vec []float32, f vectorstore.Filter, candidates int) (hits []vectorstore.Hit, err error) {
	ctx, span := tracing.Start(ctx, "retrieval.vector", attribute.Int("grounded.retrieval.candidates", candidates),
		attribute.Int("grounded.retrieval.sources", len(f.SourceIDs)), attribute.Bool("grounded.retrieval.filtered", !f.Docs.IsZero()))
	defer func() {
		span.SetAttributes(attribute.Int("grounded.retrieval.results", len(hits)))
		tracing.End(span, err)
	}()
	return s.Vectors.Search(ctx, prof, vec, f, candidates)
}

// lexicalSearch returns full-text candidates (LexicalSQL).
func (s *Service) lexicalSearch(ctx context.Context, text string, sourceIDs []uuid.UUID, profileID uuid.UUID, candidates int,
	docs vectorstore.DocFilter) (ids []uuid.UUID, err error) {
	ctx, span := tracing.Start(ctx, "retrieval.lexical", attribute.Int("grounded.retrieval.candidates", candidates))
	defer func() {
		span.SetAttributes(attribute.Int("grounded.retrieval.results", len(ids)))
		tracing.End(span, err)
	}()
	docSQL, docArgs := docs.SQL("d", 5)
	rows, err := s.Pool.Query(ctx, LexicalSQL(docSQL), append([]any{text, sourceIDs, candidates, profileID}, docArgs...)...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// fuse merges vector and full-text candidates (Fuse) and keeps the best k.
func fuse(ctx context.Context, kbID uuid.UUID, vhits []vectorstore.Hit, lexical []uuid.UUID, weights Weights, k int) []*Hit {
	_, span := tracing.Start(ctx, "retrieval.fusion", attribute.Int("grounded.retrieval.vector_candidates", len(vhits)),
		attribute.Int("grounded.retrieval.lexical_candidates", len(lexical)),
		attribute.Float64("grounded.retrieval.vector_weight", weights.Vector), attribute.Float64("grounded.retrieval.keyword_weight", weights.Keyword))
	defer span.End()
	ranked := Fuse(vhits, lexical, weights)
	for _, h := range ranked {
		h.KBID = kbID
	}
	if len(ranked) > k {
		ranked = ranked[:k]
	}
	span.SetAttributes(attribute.Int("grounded.retrieval.results", len(ranked)))
	return ranked
}

// fillDistances gives keyword-only hits their vector distance too, so
// similarity thresholds apply to every hit.
func (s *Service) fillDistances(ctx context.Context, prof vectorstore.Profile, vec []float32, ranked []*Hit) error {
	var missing []uuid.UUID
	for _, h := range ranked {
		if h.Distance < 0 {
			missing = append(missing, h.ChunkID)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	dist, err := s.Vectors.Distances(ctx, prof, vec, missing)
	if err != nil {
		return err
	}
	for _, h := range ranked {
		if d, ok := dist[h.ChunkID]; ok && h.Distance < 0 {
			h.Distance = d
		}
	}
	return nil
}

// loadHits adds the chunks' content and document details, in rank order.
// Chunks deleted since the search are dropped.
func (s *Service) loadHits(ctx context.Context, ranked []*Hit, caller access.Caller) ([]Hit, error) {
	ids := make([]uuid.UUID, len(ranked))
	for i, h := range ranked {
		ids[i] = h.ChunkID
	}
	chunks, err := s.q.LoadChunks(ctx, dbgen.LoadChunksParams{Ids: ids, Principals: caller.Principals()})
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]dbgen.LoadChunksRow, len(chunks))
	for _, c := range chunks {
		byID[c.ID] = c
	}
	hits := make([]Hit, 0, len(ranked))
	for _, h := range ranked {
		c, ok := byID[h.ChunkID]
		if !ok {
			continue // deleted between search and load, or not readable by the caller
		}
		h.DocumentID, h.SourceID, h.Content, h.HeadingPath = c.DocumentID, c.SourceID, c.Content, c.HeadingPath
		h.PageStart, h.PageEnd, h.Title, h.Filename, h.URL = c.PageStart, c.PageEnd, c.Title, c.Filename, c.URL
		if h.Title == "" {
			h.Title = c.Filename
		}
		if h.Title == "" {
			h.Title = c.URL
		}
		hits = append(hits, *h)
	}
	return hits, nil
}
