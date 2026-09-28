package catalog

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

func norm(v []float32) float64 {
	var s float64
	for _, x := range v {
		s += float64(x) * float64(x)
	}
	return math.Sqrt(s)
}

func TestTruncate(t *testing.T) {
	v := []float32{3, 4, 12}
	got := Truncate(v, 2)
	if len(got) != 2 || math.Abs(float64(got[0])-0.6) > 1e-6 || math.Abs(float64(got[1])-0.8) > 1e-6 {
		t.Fatalf("Truncate = %v", got)
	}
	if v[0] != 3 {
		t.Error("Truncate changed its input")
	}
	if z := Truncate([]float32{0, 0, 1}, 2); z[0] != 0 || z[1] != 0 {
		t.Errorf("zero prefix = %v", z)
	}
}

// embedTarget is a profile of dims output dimensions on a native-2560 fake
// model; dimsParam sets the model's supportsDimensionsParam flag.
func embedTarget(p *testutil.FakeProxy, model string, dims int32, dimsParam bool) EmbedTarget {
	native := int32(2560)
	compat, _ := json.Marshal(Compat{SupportsDimensionsParam: &dimsParam})
	return EmbedTarget{
		Profile: dbgen.EmbeddingProfile{Dimensions: dims},
		Model:   dbgen.Model{UpstreamModel: model, Dimensions: &native, Compat: compat},
		Client:  gateway.New(p.BaseURL(), p.APIKey, 5*time.Second),
	}
}

func TestEmbedTargetOutputDimensions(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	p.AddEmbeddingModel("plain-2560", 2560)         // rejects "dimensions", like vLLM without Matryoshka
	p.AddMatryoshkaEmbeddingModel("mrl-2560", 2560) // accepts it
	ctx := context.Background()
	texts := []string{"Drop/add ends on the fifth day of classes.", "Parking permits"}
	want := func(text string) []float32 { return Truncate(testutil.FakeEmbedding(text, 2560), 768) }
	check := func(name string, res gateway.EmbedResult) {
		t.Helper()
		for i, v := range res.Vectors {
			if len(v) != 768 || math.Abs(norm(v)-1) > 1e-5 {
				t.Fatalf("%s: vector %d has %d dims, norm %f", name, i, len(v), norm(v))
			}
			for j, x := range want(texts[i]) {
				if math.Abs(float64(x-v[j])) > 1e-6 {
					t.Fatalf("%s: vector %d differs at %d", name, i, j)
				}
			}
		}
	}

	// Client-side truncation: no "dimensions" sent.
	res, err := embedTarget(p, "plain-2560", 768, false).Embed(ctx, texts, "u")
	if err != nil {
		t.Fatal(err)
	}
	check("client-side", res)
	// Server-side: "dimensions" sent, and the server's vectors are used.
	res, err = embedTarget(p, "mrl-2560", 768, true).Embed(ctx, texts, "u")
	if err != nil {
		t.Fatal(err)
	}
	check("server-side", res)
	// The flag on a server that rejects the parameter surfaces its error.
	_, err = embedTarget(p, "plain-2560", 768, true).Embed(ctx, texts, "u")
	if ge, ok := err.(*gateway.Error); !ok || ge.Kind != gateway.KindBadRequest {
		t.Fatalf("rejected dimensions: %v", err)
	}
	// Full dimensions: nothing sent, nothing changed.
	res, err = embedTarget(p, "plain-2560", 2560, true).Embed(ctx, texts[:1], "u")
	if err != nil || len(res.Vectors[0]) != 2560 {
		t.Fatalf("native: %v", err)
	}
	if got := p.EmbedDimensions(); len(got) != 4 || got[0] != 0 || got[1] != 768 || got[2] != 768 || got[3] != 0 {
		t.Fatalf("dimensions sent = %v", got)
	}
}

func TestProfileDimensions(t *testing.T) {
	dims := func(n int32) dbgen.Model { return dbgen.Model{Dimensions: &n} }
	out := func(n int32) *int32 { return &n }
	cases := []struct {
		model   dbgen.Model
		out     *int32
		storage string
		want    int32
		code    string
	}{
		{dims(768), nil, "halfvec", 768, ""},
		{dims(2560), out(768), "halfvec", 768, ""},
		{dims(2560), out(2560), "halfvec", 2560, ""},
		{dims(2560), out(2560), "vector", 0, "dimensions_too_large"},
		{dims(2560), out(1024), "vector", 1024, ""},
		{dims(4096), nil, "halfvec", 0, "dimensions_too_large"},
		{dims(4096), out(1024), "halfvec", 1024, ""},
		{dims(768), out(1024), "halfvec", 0, "invalid_output_dimensions"},
		{dims(768), out(0), "halfvec", 0, "invalid_output_dimensions"},
	}
	for i, c := range cases {
		got, err := profileDimensions(c.model, c.out, c.storage, maxDimensions[c.storage])
		if c.code != "" {
			if ae, ok := err.(*apperr.Error); !ok || ae.Code != c.code {
				t.Errorf("case %d: err = %v, want %s", i, err, c.code)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("case %d: %d, %v", i, got, err)
		}
	}
}

func TestProfileWeightsUpdate(t *testing.T) {
	v, k := 1.0, 0.02
	cur := dbgen.EmbeddingProfile{Name: "p", Status: ProfileActive, DefaultVectorWeight: &v, DefaultKeywordWeight: &k}
	p, err := profileUpdate(cur, ProfileUpdate{})
	if err != nil || *p.DefaultKeywordWeight != 0.02 {
		t.Fatalf("unchanged: %+v %v", p, err)
	}
	p, err = profileUpdate(cur, ProfileUpdate{PlatformWeights: true})
	if err != nil || p.DefaultVectorWeight != nil || p.DefaultKeywordWeight != nil {
		t.Fatalf("platform: %+v %v", p, err)
	}
	p, err = profileUpdate(cur, ProfileUpdate{DefaultWeights: &FusionWeights{Vector: 0.8, Keyword: 0}})
	if err != nil || *p.DefaultVectorWeight != 0.8 || *p.DefaultKeywordWeight != 0 {
		t.Fatalf("set: %+v %v", p, err)
	}
	for _, in := range []ProfileUpdate{
		{DefaultWeights: &FusionWeights{}},
		{DefaultWeights: &FusionWeights{Vector: 2}},
		{DefaultWeights: &FusionWeights{Vector: 1}, PlatformWeights: true},
	} {
		if _, err := profileUpdate(cur, in); err == nil || !strings.Contains(err.Error(), "invalid_fusion_weights") {
			t.Errorf("%+v: err = %v", in, err)
		}
	}
}
