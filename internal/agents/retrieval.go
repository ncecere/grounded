package agents

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agentloop"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/systemone"
)

// numberedHit is a retrieved chunk with its source number within one answer.
type numberedHit struct {
	kbs.Hit
	N int
	// Conflicting: judging found that it contradicts the question's
	// premise; it goes in the <conflicting_sources> block.
	Conflicting bool
}

// estimateTokens is the budget estimate: characters / 4.
func estimateTokens(s string) int { return (utf8.RuneCountInString(s) + 3) / 4 }

// hitCost is a hit's share of the context budget (content plus markup).
func hitCost(h kbs.Hit) int { return estimateTokens(h.Content) + estimateTokens(h.Title) + 20 }

// retriever searches an agent's KBs for one answer. Source numbers continue
// across searches (tool mode), and a chunk found again keeps its number.
type retriever struct {
	svc    *kbs.Service
	kbs    []kbs.KB
	refs   map[uuid.UUID]KBRef
	filter kbs.MetadataFilter
	minSim float64
	user   string
	cache  kbs.EmbedCache

	mu          sync.Mutex
	budget      int // remaining context tokens
	byChunk     map[uuid.UUID]*numberedHit
	all         []*numberedHit
	embedTokens map[uuid.UUID]int // by embedding model
	topSim      float64
	searches    int
	hitSearches int // searches that returned hits

	// judge is passage judging (nil: off); judging records it.
	judge   *systemone.JudgePlan
	judging *JudgingRecord
}

func newRetriever(svc *kbs.Service, resolved []kbs.KB, c Config, user string) *retriever {
	r := &retriever{svc: svc, kbs: resolved, refs: map[uuid.UUID]KBRef{}, minSim: c.MinSimilarity, user: user,
		budget: c.ContextTokenBudget, byChunk: map[uuid.UUID]*numberedHit{}, embedTokens: map[uuid.UUID]int{}}
	if c.Filters != nil {
		r.filter = *c.Filters
	}
	for _, ref := range c.KBs {
		r.refs[ref.KBID] = ref
	}
	return r
}

// search runs one query over every KB (each with its own profile and top-k),
// merges the per-KB rankings with reciprocal rank fusion, drops hits below
// the similarity threshold, deduplicates by chunk and trims to the remaining
// token budget. maxResults (0 = the sum of the KBs' top-k) caps the result.
// With judging, the top candidates are judged first: evidence is re-ranked
// by relevance, dropped passages are left out and conflicting ones follow
// (marked). sj is nil when nothing was judged.
func (r *retriever) search(ctx context.Context, query string, maxResults int) (out []numberedHit, sj *searchJudging, err error) {
	results, total := r.searchKBs(ctx, query)
	if maxResults <= 0 || maxResults > total {
		maxResults = total
	}
	r.mu.Lock()
	merged, err := r.fuse(results)
	r.mu.Unlock()
	if err != nil {
		return nil, nil, err
	}
	var conflicting []*fusedHit
	if r.judge != nil && len(merged) > 0 {
		var js []systemone.Judgment
		merged, conflicting, js = r.judgeCandidates(ctx, query, merged)
		sj = &searchJudging{judged: len(js), dropped: countDropped(js)}
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	r.searches++
	out = r.number(merged, maxResults)
	for _, h := range r.number(conflicting, min(maxConflicting, maxResults)) {
		h.Conflicting = true
		out = append(out, h)
	}
	if sj != nil {
		sj.kept = len(out)
	}
	if len(out) > 0 {
		r.hitSearches++
	}
	return out, sj, nil
}

// kbResult is one KB's search result.
type kbResult struct {
	res kbs.SearchResult
	err error
}

// searchKBs searches every KB concurrently. total is the sum of the KBs' top-k.
func (r *retriever) searchKBs(ctx context.Context, query string) ([]kbResult, int) {
	results := make([]kbResult, len(r.kbs))
	var wg sync.WaitGroup
	total := 0
	for i, kb := range r.kbs {
		topK := r.refs[kb.ID].TopK
		if topK <= 0 {
			topK = DefaultTopK
		}
		total += topK
		if r.judge != nil { // judging looks at more candidates than it keeps
			topK = max(topK, r.judge.Candidates)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := r.svc.Search(ctx, kb, kbs.SearchParams{Text: query, TopK: topK, Filter: r.filter, User: r.user, Cache: &r.cache})
			results[i] = kbResult{res, err}
		}()
	}
	wg.Wait()
	return results, total
}

// fusedHit is a chunk's reciprocal-rank-fusion score over the KBs.
type fusedHit struct {
	hit   kbs.Hit
	score float64
	best  int // best per-KB rank, for ties
}

// fuse merges the per-KB rankings (reciprocal rank fusion, k = 60), best
// first, and counts embedding tokens. r.mu must be held.
func (r *retriever) fuse(results []kbResult) ([]*fusedHit, error) {
	fused := map[uuid.UUID]*fusedHit{}
	for _, res := range results {
		if res.err != nil {
			return nil, res.err
		}
		if res.res.EmbedTokens > 0 {
			r.embedTokens[res.res.EmbedModelID] += res.res.EmbedTokens
		}
		for rank, h := range res.res.Hits {
			if r.minSim > 0 && h.Similarity() < r.minSim {
				continue
			}
			f, ok := fused[h.ChunkID]
			if !ok {
				f = &fusedHit{hit: h, best: rank + 1}
				fused[h.ChunkID] = f
			} else if h.Distance >= 0 && (f.hit.Distance < 0 || h.Distance < f.hit.Distance) {
				f.hit.Distance = h.Distance
			}
			f.score += 1.0 / float64(60+rank+1)
			f.best = min(f.best, rank+1)
		}
	}
	merged := make([]*fusedHit, 0, len(fused))
	for _, f := range fused {
		merged = append(merged, f)
	}
	sort.Slice(merged, func(i, j int) bool {
		a, b := merged[i], merged[j]
		switch {
		case a.score != b.score:
			return a.score > b.score
		case a.best != b.best:
			return a.best < b.best
		case a.hit.Similarity() != b.hit.Similarity():
			return a.hit.Similarity() > b.hit.Similarity()
		}
		return a.hit.ChunkID.String() < b.hit.ChunkID.String()
	})
	return merged, nil
}

// number gives the fused hits their source numbers (a chunk found again
// keeps its number) until maxResults or the token budget is reached.
// r.mu must be held.
func (r *retriever) number(merged []*fusedHit, maxResults int) []numberedHit {
	var out []numberedHit
	for _, f := range merged {
		if len(out) >= maxResults {
			break
		}
		if prev, ok := r.byChunk[f.hit.ChunkID]; ok {
			out = append(out, *prev) // already numbered and paid for
			continue
		}
		cost := hitCost(f.hit)
		if cost > r.budget {
			if len(r.all) > 0 || r.budget < 100 {
				break
			}
			// The first hit alone exceeds the budget: keep a trimmed copy.
			f.hit.Content = truncateRunes(f.hit.Content, max(r.budget-40, 50)*4)
			cost = r.budget
		}
		r.budget -= cost
		n := &numberedHit{Hit: f.hit, N: len(r.all) + 1}
		r.all = append(r.all, n)
		r.byChunk[f.hit.ChunkID] = n
		r.topSim = max(r.topSim, f.hit.Similarity())
		out = append(out, *n)
	}
	return out
}

// numbered returns every source given to the model in this answer.
func (r *retriever) numbered() []numberedHit {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]numberedHit, len(r.all))
	for i, h := range r.all {
		out[i] = *h
	}
	return out
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n])) + "…"
}

func (ru *run) retrievalHits(hits []numberedHit) []RetrievalHit {
	out := make([]RetrievalHit, len(hits))
	for i, h := range hits {
		out[i] = RetrievalHit{N: h.N, Title: h.Title, Snippet: snippet(h.Content), Conflicting: h.Conflicting}
		if ru.cfg.CitationMode == CitationSnippetLink && isWebURL(h.URL) {
			out[i].URL = h.URL
		}
	}
	return out
}

type searchArgs struct {
	Query      string `json:"query"`
	MaxResults int    `json:"maxResults"`
}

// toolDetails is the application-side result of search_knowledge.
type toolDetails struct {
	Query   string            `json:"query"`
	Hits    []RetrievalHit    `json:"hits"`
	Error   string            `json:"error,omitempty"`
	Judging *RetrievalJudging `json:"judging,omitempty"`
}

func (ru *run) searchTool() agentloop.Tool {
	return agentloop.Tool{
		Name: "search_knowledge", Label: "Search knowledge", Description: searchToolDescription,
		Parameters: searchToolSchema, Mode: agentloop.Sequential,
		Execute: func(ctx context.Context, _ string, params json.RawMessage, _ func(agentloop.ToolResult)) (agentloop.ToolResult, error) {
			var args searchArgs
			if err := json.Unmarshal(params, &args); err != nil {
				return agentloop.ToolResult{}, err
			}
			q := strings.TrimSpace(args.Query)
			hits, sj, err := ru.retr.search(ctx, q, args.MaxResults)
			if err != nil {
				ru.s.Log.Warn("search_knowledge failed", "err", err, "agent", ru.agent.ID)
				return agentloop.ToolResult{Content: "The search failed. Try again later.", IsError: true,
					Details: toolDetails{Query: q, Hits: []RetrievalHit{}, Error: "retrieval_failed"}}, nil
			}
			d := toolDetails{Query: q, Hits: ru.retrievalHits(hits), Judging: sj.event()}
			if len(hits) == 0 {
				return agentloop.ToolResult{Content: toolNoResults, Details: d}, nil
			}
			return agentloop.ToolResult{Content: formatSources(hits), Details: d}, nil
		},
	}
}
