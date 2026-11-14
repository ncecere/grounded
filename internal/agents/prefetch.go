// The searches of one model turn run together (#251). The model may ask for several searches in one message; they
// are numbered in the order it asked (a source keeps the first number it got), so search_knowledge is a sequential
// tool. The slow part of a search, fetching (the query embedding, the knowledge bases, reranking), judging and
// expanding parents, doesn't depend on the other searches: it now starts for every search of the message at once
// (agentloop's Prefetch), and only the numbering runs in call order. The model reads the same sources with the same
// numbers as when the searches ran one after another; identical queries still embed once (kbs.EmbedCache).

package agents

import (
	"context"
	"encoding/json"
	"strings"
)

// prefetched are the searches of the current model turn being prepared, by tool call ID.
type prefetched struct {
	m map[string]chan judgedSearch
}

// prefetchSearch starts a search_knowledge call's preparation (agentloop.Tool.Prefetch).
func (ru *run) prefetchSearch(ctx context.Context, id string, params json.RawMessage) {
	var args searchArgs
	if json.Unmarshal(params, &args) != nil {
		return // Execute reports it
	}
	ch := make(chan judgedSearch, 1)
	ru.retr.mu.Lock()
	if ru.searches.m == nil {
		ru.searches.m = map[string]chan judgedSearch{}
	}
	ru.searches.m[id] = ch
	ru.retr.mu.Unlock()
	go func() { ch <- ru.retr.prepare(ctx, strings.TrimSpace(args.Query), args.MaxResults) }()
}

// searchCall runs a search_knowledge call: its prepared search when Prefetch started one, else the whole search.
func (ru *run) searchCall(ctx context.Context, id, query string, maxResults int) ([]numberedHit, *searchJudging, error) {
	ru.retr.mu.Lock()
	ch, ok := ru.searches.m[id]
	delete(ru.searches.m, id)
	ru.retr.mu.Unlock()
	if !ok {
		return ru.retr.search(ctx, query, maxResults)
	}
	return ru.retr.number(<-ch)
}
