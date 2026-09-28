package kbs

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/vectorstore"
)

func ids(n int) []uuid.UUID {
	out := make([]uuid.UUID, n)
	for i := range out {
		out[i] = uuid.New()
	}
	return out
}

func vhits(ids ...uuid.UUID) []vectorstore.Hit {
	out := make([]vectorstore.Hit, len(ids))
	for i, id := range ids {
		out[i] = vectorstore.Hit{ChunkID: id, Distance: float64(i) / 10}
	}
	return out
}

func order(hits []*Hit) []uuid.UUID {
	out := make([]uuid.UUID, len(hits))
	for i, h := range hits {
		out[i] = h.ChunkID
	}
	return out
}

func TestFuseWeights(t *testing.T) {
	c := ids(4)
	a, b, x, y := c[0], c[1], c[2], c[3]

	// Equal weights: a (1+2) and b (2+1) tie and break on the vector rank.
	got := Fuse(vhits(a, b, x), []uuid.UUID{b, a, y}, Weights{Vector: 1, Keyword: 1})
	if o := order(got); o[0] != a || o[1] != b {
		t.Errorf("tie should break on the vector rank: %v", o)
	}
	if got[0].VectorRank != 1 || got[0].LexicalRank != 2 || got[0].Distance != 0 {
		t.Errorf("ranks = %+v", got[0])
	}

	// A heavy keyword weight lets the keyword ranking lead.
	got = Fuse(vhits(a, b, x), []uuid.UUID{b, a, y}, Weights{Vector: 0.2, Keyword: 1})
	if order(got)[0] != b {
		t.Errorf("keyword-weighted order = %v", order(got))
	}

	// Keyword weight 0: vector order; keyword-only hits come last, with
	// their keyword rank but no score.
	got = Fuse(vhits(a, b, x), []uuid.UUID{y, x}, Weights{Vector: 1})
	if o := order(got); o[0] != a || o[1] != b || o[2] != x || o[3] != y {
		t.Errorf("vector-only order = %v", o)
	}
	if got[3].Score != 0 || got[3].LexicalRank != 1 || got[3].Distance != -1 {
		t.Errorf("keyword-only hit = %+v", got[3])
	}

	// Small keyword weights re-order near neighbours only: at 0.1, keyword
	// rank 1 lifts vector rank 8 to 2nd, but not over vector rank 1.
	v := ids(10)
	got = Fuse(vhits(v...), []uuid.UUID{v[7]}, Weights{Vector: 1, Keyword: 0.1})
	if o := order(got); o[0] != v[0] || o[1] != v[7] || o[2] != v[1] {
		t.Errorf("wk=0.1 order = %v", o[:4])
	}
}

func TestKBWeights(t *testing.T) {
	platform := Weights{Vector: 1, Keyword: 0.3}
	one, zero, two := 1.0, 0.0, 2.0
	profile := &Weights{Vector: 1, Keyword: 0.02}
	cases := []struct {
		v, k       *float64
		profile    *Weights
		want       Weights
		wantSource string
	}{
		{nil, nil, nil, platform, WeightsFromPlatform},
		{&one, &zero, nil, Weights{Vector: 1}, WeightsFromKB},
		{&one, nil, nil, platform, WeightsFromPlatform},    // incomplete override
		{&two, &zero, nil, platform, WeightsFromPlatform},  // invalid override
		{&zero, &zero, nil, platform, WeightsFromPlatform}, // both zero
		// KB override → profile default → platform default.
		{nil, nil, profile, *profile, WeightsFromProfile},
		{&one, &zero, profile, Weights{Vector: 1}, WeightsFromKB},
		{&two, &zero, profile, *profile, WeightsFromProfile},
		{nil, nil, &Weights{}, platform, WeightsFromPlatform}, // invalid profile default
	}
	for _, c := range cases {
		kb := KB{KnowledgeBase: dbgen.KnowledgeBase{VectorWeight: c.v, KeywordWeight: c.k}, ProfileWeights: c.profile}
		if got, src := kb.Weights(platform); got != c.want || src != c.wantSource {
			t.Errorf("%v/%v/%v: %+v from %s", c.v, c.k, c.profile, got, src)
		}
	}
	if got, src := (KB{}).Weights(Weights{}); got != DefaultWeights || src != WeightsFromPlatform {
		t.Errorf("unset platform weights = %+v from %s", got, src)
	}
	if w := storedWeights(&one, &two); w != nil {
		t.Errorf("invalid stored weights = %+v", w)
	}
}
