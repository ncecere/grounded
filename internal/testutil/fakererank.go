package testutil

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"
)

// FakeRerankModel is the fake's rerank model (POST /v1/rerank).
const FakeRerankModel = "fake-reranker"

// Markers that pin a passage's rerank score, so tests can check the order
// reranking gives: FakeRerankTop scores 1, FakeRerankBottom 0.
const (
	FakeRerankTop    = "FAKE-RERANK-TOP"
	FakeRerankBottom = "FAKE-RERANK-BOTTOM"
)

// FakeRerankRequest is a /rerank request the fake received.
type FakeRerankRequest struct {
	Model     string   `json:"model"`
	Query     string   `json:"query"`
	Documents []string `json:"documents"`
	Texts     []string `json:"texts"`
	TopN      *int     `json:"top_n"`
}

// SetRerankDelay pauses before answering a /rerank request (0 = none),
// so tests can pass the rerank time limit.
func (p *FakeProxy) SetRerankDelay(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rerankDelay = d
}

// FailRerankWith makes /rerank answer status (0 restores normal
// behaviour).
func (p *FakeProxy) FailRerankWith(status int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rerankFail = status
}

// RerankRequests returns the /rerank requests so far.
func (p *FakeProxy) RerankRequests() []FakeRerankRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]FakeRerankRequest(nil), p.rerankReqs...)
}

// FakeRerankScore is the fake's relevance score of a passage: the share of
// the query's words (3 letters or more) it contains, or 1 and 0 for the
// markers.
func FakeRerankScore(query, doc string) float64 {
	switch {
	case strings.Contains(doc, FakeRerankTop):
		return 1
	case strings.Contains(doc, FakeRerankBottom):
		return 0
	}
	words := func(s string) []string {
		var out []string
		for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
			if len(w) >= 3 {
				out = append(out, w)
			}
		}
		return out
	}
	have := map[string]bool{}
	for _, w := range words(doc) {
		have[w] = true
	}
	q := words(query)
	if len(q) == 0 {
		return 0
	}
	n := 0
	for _, w := range q {
		if have[w] {
			n++
		}
	}
	return 0.01 + 0.98*float64(n)/float64(len(q))
}

// rerank serves POST /v1/rerank in the Cohere and Jina shape (documents)
// or the text embeddings inference shape (texts), best first, cut to top_n.
func (p *FakeProxy) rerank(w http.ResponseWriter, r *http.Request) {
	var in FakeRerankRequest
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	p.log(r, in.Model)
	p.mu.Lock()
	p.rerankReqs = append(p.rerankReqs, in)
	fail, delay := p.rerankFail, p.rerankDelay
	p.mu.Unlock()
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return
		}
	}
	if fail != 0 {
		writeErr(w, fail, "injected rerank failure")
		return
	}
	if in.Model != FakeRerankModel {
		writeErr(w, 404, "model not found")
		return
	}
	docs := in.Documents
	if len(docs) == 0 {
		docs = in.Texts
	}
	type result struct {
		Index int     `json:"index"`
		Score float64 `json:"relevance_score"`
	}
	results := make([]result, len(docs))
	tokens := 0
	for i, d := range docs {
		results[i] = result{i, FakeRerankScore(in.Query, d)}
		tokens += len(strings.Fields(in.Query)) + len(strings.Fields(d))
	}
	sort.SliceStable(results, func(i, j int) bool { return results[i].Score > results[j].Score })
	if in.TopN != nil && *in.TopN >= 0 && *in.TopN < len(results) {
		results = results[:*in.TopN]
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"id": "rerank-fake", "results": results,
		"usage": map[string]int{"total_tokens": tokens}})
}
