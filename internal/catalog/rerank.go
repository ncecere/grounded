// Rerank models (docs/v0.4.0.md §3): a cross-encoder called over POST
// {base}/rerank scores how well each candidate passage answers a question.
// The platform's rerank model (internal/rerank) reorders every search.

package catalog

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ErrRerankUnusable is returned when the rerank model or its connection is
// missing or disabled.
var ErrRerankUnusable = apperr.New(503, "rerank_unavailable", "The rerank model is disabled or unavailable. Ask a platform admin.")

// RerankTarget returns a client for an enabled rerank model on an enabled
// connection. The client honours the connection's request limit and the
// proxy's backoff.
func (s *Service) RerankTarget(ctx context.Context, modelID uuid.UUID) (ModerationTarget, error) {
	t, err := s.target(ctx, modelID, func(k string) bool { return k == KindRerank })
	if errors.Is(err, errUnusable) {
		return t, ErrRerankUnusable
	}
	return t, err
}

// RerankRequest is a request to rerank documents with model m, following
// its compatibility flags. topN is how many results are wanted.
func RerankRequest(m dbgen.Model, query string, docs []string, topN int, user string) gateway.RerankRequest {
	c := DecodeCompat(m.Compat)
	r := gateway.RerankRequest{Model: m.UpstreamModel, Query: query, Documents: docs, TopN: topN, User: user, SendTopN: true}
	if c.SupportsRerankTopN != nil {
		r.SendTopN = *c.SupportsRerankTopN
	}
	if c.RerankDocumentsField != nil {
		r.DocumentsField = *c.RerankDocumentsField
	}
	return r
}

// The fixed test of a rerank model: a question, a passage that answers it
// and one that doesn't. A working reranker scores the first higher.
const (
	RerankTestQuery      = "When does the library open on weekdays?"
	RerankTestRelevant   = "The library is open from 8 am to 10 pm on weekdays."
	RerankTestIrrelevant = "Parking permits are sold at the transport office."
)

// RerankTest is the result of a rerank model's test.
type RerankTest struct {
	Relevant, Irrelevant float64
	Tokens               int
}

// testRerank scores the fixed passages. Ranking the unrelated passage first
// fails the test (bad_response): the model or its server is misconfigured.
func testRerank(ctx context.Context, cl *gateway.Client, m dbgen.Model, user string) ModelTest {
	start := time.Now()
	out, err := cl.Rerank(ctx, RerankRequest(m, RerankTestQuery, []string{RerankTestRelevant, RerankTestIrrelevant}, 2, user))
	res := ModelTest{Latency: time.Since(start)}
	if err == nil && len(out.Scores) != 2 {
		err = &gateway.Error{Kind: gateway.KindBadResponse, Message: "the rerank response doesn't score both test passages"}
	}
	if err != nil {
		res.Error, _ = probeError(err)
		if res.Error == nil {
			res.Error = &ProbeError{Kind: gateway.KindUnavailable, Message: err.Error()}
		}
		return res
	}
	t := &RerankTest{Tokens: out.Tokens}
	for _, s := range out.Scores {
		if s.Index == 0 {
			t.Relevant = s.Score
		} else {
			t.Irrelevant = s.Score
		}
	}
	res.Rerank = t
	res.Usage = gateway.Usage{PromptTokens: out.Tokens, TotalTokens: out.Tokens}
	if t.Relevant <= t.Irrelevant {
		res.Error = &ProbeError{Kind: gateway.KindBadResponse, Message: "The model ranked the unrelated test passage first. Check that it is a reranker."}
		return res
	}
	res.OK = true
	return res
}
