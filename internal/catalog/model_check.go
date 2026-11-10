package catalog

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
)

// ModelTest is the result of a tiny real request to a model.
type ModelTest struct {
	OK      bool
	Latency time.Duration
	// Embedding models: the dimensions the proxy returned, and whether they
	// match the configured value.
	Dimensions      *int32
	DimensionsMatch *bool
	// Chat models: the start of the reply.
	Reply string
	Usage gateway.Usage
	// Rerank models: the scores of the fixed test passages.
	Rerank *RerankTest
	// Chat models with a way to turn thinking off: whether the model honoured it (thinkingoff.go).
	ThinkingOff *ThinkingOffTest
	Error       *ProbeError
}

// TestModel sends a small request so admins can confirm the model works
// (and, for embeddings, learn its real dimensions) before relying on it.
func (s *Service) TestModel(ctx context.Context, a authz.Actor, id uuid.UUID) (ModelTest, error) {
	if !a.IsPlatformAdmin() {
		return ModelTest{}, errAdminOnly
	}
	m, err := s.q.GetModel(ctx, id)
	if err != nil {
		return ModelTest{}, notFound(err, errNoModel)
	}
	c, err := s.q.GetConnection(ctx, m.ConnectionID)
	if err != nil {
		return ModelTest{}, err
	}
	cl, err := s.client(c)
	if err != nil {
		return ModelTest{}, err
	}
	user := "grounded-admin-test:" + a.UserID.String()
	start := time.Now()
	var res ModelTest
	switch m.Kind {
	case KindEmbedding:
		out, err := cl.Embed(ctx, gateway.EmbedRequest{Model: m.UpstreamModel, Input: []string{"Grounded connection test."}, User: user})
		res.Latency = time.Since(start)
		if err != nil {
			res.Error, err = probeError(err)
			return res, err
		}
		dims := int32(len(out.Vectors[0]))
		match := m.Dimensions != nil && *m.Dimensions == dims
		res.Dimensions, res.DimensionsMatch, res.Usage, res.OK = &dims, &match, out.Usage, true
	case KindChat:
		out, err := cl.Complete(ctx, gateway.CompleteRequest{
			Model: m.UpstreamModel, MaxTokens: 16, User: user, Extra: DecodeCompat(m.Compat).ExtraBody,
			Messages: []gateway.ChatMessage{{Role: "user", Content: "Reply with the single word: pong"}},
		})
		res.Latency = time.Since(start)
		if err != nil {
			res.Error, err = probeError(err)
			return res, err
		}
		reply := strings.TrimSpace(out.Text)
		if len(reply) > 200 {
			reply = reply[:200]
		}
		res.Reply, res.Usage, res.OK = reply, out.Usage, true
		// the ordinary test is done (and timed); thinking off is a second request, made the way the chat path makes it
		if model := llm.ModelFromRow(m); model.Compat.ThinkingOff != "" {
			pctx, cancel := context.WithTimeout(ctx, thinkingOffProbeTimeout)
			defer cancel()
			res.ThinkingOff = checkThinkingOff(pctx, llm.NewOpenAI(cl), model, user)
		}
		// what it found stays on the model, for the admin pages and the agent builder (#52); the Test's own result is
		// still what it says
		if err := s.keepThinkingOffResult(ctx, m.ID, res.ThinkingOff); err != nil {
			return ModelTest{}, err
		}
	case KindRerank:
		return testRerank(ctx, cl, m, user), nil
	default:
		return ModelTest{}, apperr.Invalid("test_unsupported", "Testing "+m.Kind+" models is not supported yet")
	}
	return res, nil
}
