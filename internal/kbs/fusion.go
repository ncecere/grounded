package kbs

import (
	"sort"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/vectorstore"
)

// rrfK is the reciprocal rank fusion constant (standard value).
const rrfK = 60

// Weights are the reciprocal rank fusion weights of the two retrievers
// (DESIGN.md §6). Each is in [0, 1] and at least one is positive. A zero
// keyword weight skips the full-text query: retrieval is vector-only.
type Weights struct {
	Vector  float64
	Keyword float64
}

// Valid reports whether the weights are usable.
func (w Weights) Valid() bool {
	return w.Vector >= 0 && w.Vector <= 1 && w.Keyword >= 0 && w.Keyword <= 1 && w.Vector+w.Keyword > 0
}

// DefaultWeights are used when neither the configuration nor the KB sets
// weights. They were chosen on BEIR FiQA and a university registrar evaluation
// set (docs/benchmarks/scale-10k.md, "Fusion tuning").
var DefaultWeights = Weights{Vector: 1, Keyword: 0.1}

// Where a KB's effective fusion weights come from (the API's
// fusionWeightsSource).
const (
	WeightsFromKB       = "knowledge_base"
	WeightsFromProfile  = "profile"
	WeightsFromPlatform = "platform"
)

// storedWeights reads a pair of weight columns; nil unless both are set
// and usable.
func storedWeights(vector, keyword *float64) *Weights {
	if vector == nil || keyword == nil {
		return nil
	}
	w := Weights{Vector: *vector, Keyword: *keyword}
	if !w.Valid() {
		return nil
	}
	return &w
}

// Weights returns the KB's fusion weights and where they come from: its own
// when it sets them, else its embedding profile's default, else the
// platform default (DESIGN.md §6). Agents search through their KBs, so
// they inherit them.
func (kb KB) Weights(platform Weights) (Weights, string) {
	if w := storedWeights(kb.VectorWeight, kb.KeywordWeight); w != nil {
		return *w, WeightsFromKB
	}
	if kb.ProfileWeights != nil && kb.ProfileWeights.Valid() {
		return *kb.ProfileWeights, WeightsFromProfile
	}
	if !platform.Valid() {
		return DefaultWeights, WeightsFromPlatform
	}
	return platform, WeightsFromPlatform
}

// Fuse merges vector hits (nearest first) and keyword chunk IDs (best
// first) with weighted reciprocal rank fusion:
//
//	score = wv/(k+rank_vector) + wk/(k+rank_keyword)
//
// A list with weight 0 contributes no score but still records ranks. The
// result is sorted by SortHits and not truncated.
func Fuse(vector []vectorstore.Hit, keyword []uuid.UUID, w Weights) []*Hit {
	fused := make(map[uuid.UUID]*Hit, len(vector)+len(keyword))
	get := func(id uuid.UUID) *Hit {
		if h, ok := fused[id]; ok {
			return h
		}
		h := &Hit{ChunkID: id, Distance: -1}
		fused[id] = h
		return h
	}
	for i, vh := range vector {
		h := get(vh.ChunkID)
		if h.VectorRank != 0 {
			continue
		}
		h.VectorRank, h.Distance = i+1, vh.Distance
		h.Score += w.Vector / float64(rrfK+i+1)
	}
	for i, id := range keyword {
		h := get(id)
		if h.LexicalRank != 0 {
			continue
		}
		h.LexicalRank = i + 1
		h.Score += w.Keyword / float64(rrfK+i+1)
	}
	ranked := make([]*Hit, 0, len(fused))
	for _, h := range fused {
		ranked = append(ranked, h)
	}
	SortHits(ranked)
	return ranked
}

// SortHits orders fused hits by score. Ties are common (ranks 1+2 against
// 2+1, or equal weights): they break on the vector rank first (the stronger
// retriever on every set measured), then the keyword rank, then the chunk ID
// for determinism. A missing rank sorts after every present one.
func SortHits(ranked []*Hit) {
	rankOrLast := func(r int) int {
		if r == 0 {
			return 1 << 30
		}
		return r
	}
	sort.Slice(ranked, func(i, j int) bool {
		a, b := ranked[i], ranked[j]
		switch {
		case a.Score != b.Score:
			return a.Score > b.Score
		case a.VectorRank != b.VectorRank:
			return rankOrLast(a.VectorRank) < rankOrLast(b.VectorRank)
		case a.LexicalRank != b.LexicalRank:
			return rankOrLast(a.LexicalRank) < rankOrLast(b.LexicalRank)
		}
		return a.ChunkID.String() < b.ChunkID.String()
	})
}
