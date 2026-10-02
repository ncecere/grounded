package gateway_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestRerankAgainstFakeProxy(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	c := gateway.New(p.BaseURL(), p.APIKey, 5*time.Second)
	docs := []string{"Parking permits are sold online.", "The library opens at 8 am on weekdays.", testutil.FakeRerankTop + " Hours."}
	// The caller's tag is not sent (the fake refuses unknown fields, like strict servers).
	res, err := c.Rerank(context.Background(), gateway.RerankRequest{Model: testutil.FakeRerankModel, Query: "When does the library open?",
		Documents: docs, TopN: 2, SendTopN: true, User: "grounded:user"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Scores) != 2 || res.Scores[0].Index != 2 || res.Scores[1].Index != 1 || res.Tokens == 0 {
		t.Fatalf("rerank = %+v", res)
	}
	reqs := p.RerankRequests()
	if len(reqs) != 1 || reqs[0].TopN == nil || *reqs[0].TopN != 2 || len(reqs[0].Documents) != 3 || reqs[0].Query == "" {
		t.Fatalf("request = %+v", reqs)
	}

	// texts (text embeddings inference) and no top_n.
	if _, err := c.Rerank(context.Background(), gateway.RerankRequest{Model: testutil.FakeRerankModel, Query: "library", Documents: docs,
		DocumentsField: "texts", TopN: 2}); err != nil {
		t.Fatal(err)
	}
	if r := p.RerankRequests()[1]; r.TopN != nil || len(r.Texts) != 3 || len(r.Documents) != 0 {
		t.Errorf("texts request = %+v", r)
	}

	p.FailRerankWith(http.StatusServiceUnavailable)
	if _, err := c.Rerank(context.Background(), gateway.RerankRequest{Model: testutil.FakeRerankModel, Query: "q", Documents: docs}); kindOf(err) != gateway.KindUnavailable {
		t.Errorf("failure = %v", err)
	}
}

func TestRerankResponseShapes(t *testing.T) {
	cases := []struct {
		name, body string
		want       []gateway.RerankScore
		tokens     int
		bad        bool
	}{
		{"cohere", `{"results":[{"index":1,"relevance_score":0.9},{"index":0,"relevance_score":0.1}],"meta":{"tokens":{"input_tokens":7}}}`,
			[]gateway.RerankScore{{1, 0.9}, {0, 0.1}}, 7, false},
		{"vllm", `{"results":[{"index":0,"relevance_score":0.2,"document":{"text":"a"}}],"usage":{"total_tokens":12}}`,
			[]gateway.RerankScore{{0, 0.2}}, 12, false},
		{"data", `{"data":[{"index":1,"score":0.5}],"usage":{"prompt_tokens":3,"total_tokens":4}}`, []gateway.RerankScore{{1, 0.5}}, 3, false},
		{"tei", `[{"index":0,"score":0.7},{"index":1,"score":0.3}]`, []gateway.RerankScore{{0, 0.7}, {1, 0.3}}, 0, false},
		{"empty", `{"results":[]}`, nil, 0, true},
		{"out of range", `{"results":[{"index":5,"relevance_score":0.9}]}`, nil, 0, true},
		{"twice", `{"results":[{"index":0,"relevance_score":0.9},{"index":0,"relevance_score":0.8}]}`, nil, 0, true},
		{"no score", `{"results":[{"index":0}]}`, nil, 0, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/rerank" {
					http.NotFound(w, r)
					return
				}
				var in map[string]any
				_ = json.NewDecoder(r.Body).Decode(&in)
				if in["return_documents"] != false || in["model"] != "m" {
					t.Errorf("request = %v", in)
				}
				_, _ = w.Write([]byte(c.body))
			}))
			defer srv.Close()
			res, err := gateway.New(srv.URL+"/v1", "", time.Second).Rerank(context.Background(),
				gateway.RerankRequest{Model: "m", Query: "q", Documents: []string{"a", "b"}})
			if c.bad {
				if kindOf(err) != gateway.KindBadResponse {
					t.Errorf("err = %v", err)
				}
				return
			}
			if err != nil || res.Tokens != c.tokens || len(res.Scores) != len(c.want) {
				t.Fatalf("res = %+v %v", res, err)
			}
			for i := range c.want {
				if res.Scores[i] != c.want[i] {
					t.Errorf("score %d = %+v", i, res.Scores[i])
				}
			}
		})
	}
}
