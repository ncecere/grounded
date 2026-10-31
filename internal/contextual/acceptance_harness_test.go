package contextual

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

type acceptanceArtifact struct {
	Document string `json:"syntheticDocument"`
	Context  string `json:"untrustedGeneratedPrefix"`
}
type acceptanceReport struct {
	Mode                 string               `json:"mode"`
	CorpusSHA256         string               `json:"syntheticCorpusSHA256"`
	ExplicitLimits       acceptanceLimits     `json:"explicitLimitsAndConfiguredPrices"`
	Currency             string               `json:"configuredCurrency"`
	Dimensions           int                  `json:"embeddingDimensions"`
	PhaseMilliseconds    map[string]int64     `json:"phaseMilliseconds"`
	AccountingCollected  bool                 `json:"accountingCollected"`
	AccountingReadFailed bool                 `json:"accountingReadFailed"`
	ContextOK            int64                `json:"successfulContextAttempts"`
	Status               string               `json:"status"`
	FailedStage          string               `json:"failedStage,omitempty"`
	Seconds              float64              `json:"seconds"`
	Planned              acceptanceUsage      `json:"conservativePreflight"`
	Reserved             acceptanceUsage      `json:"transportReservationsNotInvoice"`
	ContextCalls         int64                `json:"contextAttempts"`
	UnknownContextCalls  int64                `json:"unknownContextAttempts"`
	ContextTokensIn      int64                `json:"reportedContextTokensIn"`
	ContextTokensOut     int64                `json:"reportedContextTokensOut"`
	CachedReplayRequests int64                `json:"cachedReplayRequests"`
	EmbeddingUsage       []gateway.Usage      `json:"embeddingUsage"`
	Artifacts            []acceptanceArtifact `json:"syntheticArtifacts"`
	Comparison           acceptanceComparison `json:"smallCorpusComparison"`
	Limitations          string               `json:"limitations"`
}

type acceptanceRun struct {
	fixture           settlementFixture
	generator         *Generator
	client            *gateway.Client
	guard             *acceptanceTransport
	config            acceptanceConfig
	requests          []Request
	plain, contextual []string
	report            acceptanceReport
}

func (r *acceptanceRun) execute(ctx context.Context) (report acceptanceReport, err error) {
	start := time.Now()
	r.report.Status = "failed"
	r.report.CorpusSHA256 = acceptanceCorpusSHA256()
	r.report.ExplicitLimits, r.report.Currency, r.report.Dimensions = r.config.Limits, r.config.Currency, r.config.Dimensions
	r.report.PhaseMilliseconds = make(map[string]int64)
	r.report.Limitations = "Synthetic generator/PG admission and real-or-fake embedding comparison only; not a full HTTP product walk, representative corpus, answer-quality/latency/generalization result, or external invoice guarantee. Equal or worse retrieval is reported, not hidden."
	defer func() {
		if !r.report.AccountingCollected {
			cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			r.report.AccountingReadFailed = r.collectAccounting(cleanupCtx) != nil
			cancel()
		}
		r.report.Seconds = time.Since(start).Seconds()
		r.report.Reserved = r.guard.snapshot()
		report = r.report
	}()
	stages := []struct {
		name string
		run  func(context.Context) error
	}{
		{"context generation", r.generate}, {"cache replay", r.replay}, {"embedding comparison", r.compare}, {"durable accounting", r.accounting},
	}
	for _, stage := range stages {
		if ctx.Err() != nil {
			r.report.FailedStage = "whole-run deadline or cancellation"
			return report, errors.New("acceptance stopped before another stage")
		}
		phaseStart := time.Now()
		stageErr := stage.run(ctx)
		r.report.PhaseMilliseconds[stage.name] = time.Since(phaseStart).Milliseconds()
		if stageErr != nil {
			r.report.FailedStage = stage.name
			return report, fmt.Errorf("acceptance failed at %s (provider/body text intentionally redacted)", stage.name)
		}
	}
	r.report.Status = "passed"
	return report, nil
}

func (r *acceptanceRun) generate(ctx context.Context) error {
	for i, doc := range acceptanceDocuments {
		id := r.fixture.res.DocumentID
		if i > 0 {
			id = uuid.New()
			if _, err := r.fixture.pool.Exec(ctx, `INSERT INTO documents (id, source_id, external_id, status, version) VALUES ($1, $2, $3, 'ready', 1)`, id, r.fixture.res.SourceID, "https://example.edu/synthetic/"+doc.ID); err != nil {
				return err
			}
		}
		req := Request{SourceID: r.fixture.res.SourceID, ProfileID: r.fixture.res.ProfileID, DocumentID: id, Version: 1,
			Model: r.fixture.res.ModelID, Team: r.fixture.usage.Team, Phase: PhaseBuild, Cap: int(r.report.Planned.ContextRequests),
			Title: doc.Title, Policy: PolicyFail, Chunks: acceptanceChunks(doc, r.generator.Counter)}
		req.Checkpoint = r.checkpoint
		result, err := r.generator.Contextualize(ctx, req)
		if err != nil {
			return err
		}
		if result.State != StateContext || len(result.Contexts) != 1 || result.Contexts[0] == "" {
			return errors.New("acceptance did not generate the bounded context")
		}
		r.requests = append(r.requests, req)
		r.plain = append(r.plain, chunk.EmbedText(doc.Title, req.Chunks[0]))
		r.contextual = append(r.contextual, chunk.EmbedTextContext(doc.Title, req.Chunks[0], result.Contexts[0]))
		r.report.Artifacts = append(r.report.Artifacts, acceptanceArtifact{doc.ID, result.Contexts[0]})
	}
	return nil
}

func (r *acceptanceRun) checkpoint(ctx context.Context) error {
	q := dbgen.New(r.fixture.pool)
	s, err := q.GetSourceContextual(ctx, r.fixture.res.SourceID)
	if err != nil || !s.Enabled {
		return &StopError{Reason: "acceptance source is not enabled"}
	}
	snap, err := q.GetSetContextual(ctx, dbgen.GetSetContextualParams{SourceID: r.fixture.res.SourceID, ProfileID: r.fixture.res.ProfileID})
	if err != nil || snap.PromptVersion != PromptVersion || snap.ModelID != r.fixture.res.ModelID {
		return &StopError{Reason: "acceptance snapshot changed"}
	}
	if problem := ModelProblem(ctx, q, &r.fixture.res.ModelID, "open"); problem != nil {
		return &StopError{Reason: "acceptance model eligibility changed"}
	}
	return nil
}

func (r *acceptanceRun) replay(ctx context.Context) error {
	before := r.guard.snapshot().Requests
	for _, req := range r.requests {
		result, err := r.generator.Contextualize(ctx, req)
		if err != nil || result.Calls != 0 || result.Cached != 1 {
			return errors.New("acceptance cache replay made new work")
		}
	}
	r.report.CachedReplayRequests = r.guard.snapshot().Requests - before
	if r.report.CachedReplayRequests != 0 {
		return errors.New("acceptance cache replay reached gateway")
	}
	return nil
}

func (r *acceptanceRun) embed(ctx context.Context, texts []string) ([][]float32, error) {
	result, err := r.client.Embed(ctx, gateway.EmbedRequest{Model: r.config.Limits.EmbeddingModel, Input: texts, User: "grounded-contextual-acceptance"})
	if err != nil {
		return nil, errors.New("acceptance embedding request failed")
	}
	if err := validateAcceptanceVectors(result.Vectors, len(texts), r.config.Dimensions); err != nil {
		return nil, err
	}
	r.report.EmbeddingUsage = append(r.report.EmbeddingUsage, result.Usage)
	return result.Vectors, nil
}

func (r *acceptanceRun) compare(ctx context.Context) error {
	plain, err := r.embed(ctx, r.plain)
	if err != nil {
		return err
	}
	contextual, err := r.embed(ctx, r.contextual)
	if err != nil {
		return err
	}
	queries := make([]string, len(acceptanceQuestions))
	for i, q := range acceptanceQuestions {
		queries[i] = q.Text
	}
	query, err := r.embed(ctx, queries)
	if err != nil {
		return err
	}
	r.report.Comparison = compareAcceptance(plain, contextual, query)
	return nil
}

func (r *acceptanceRun) collectAccounting(ctx context.Context) error {
	stats, err := dbgen.New(r.fixture.pool).ContextualCallStats(ctx, dbgen.ContextualCallStatsParams{SourceID: r.fixture.res.SourceID})
	if err != nil {
		return err
	}
	r.report.ContextCalls, r.report.UnknownContextCalls = stats.Attempts, stats.Unknown
	r.report.ContextTokensIn, r.report.ContextTokensOut = stats.TokensIn, stats.TokensOut
	r.report.AccountingCollected, r.report.ContextOK = true, stats.Ok
	return nil
}

func (r *acceptanceRun) accounting(ctx context.Context) error {
	if err := r.collectAccounting(ctx); err != nil {
		return err
	}
	if r.report.ContextCalls != r.report.Planned.ContextRequests || r.report.ContextOK != r.report.ContextCalls {
		return errors.New("acceptance attempts did not settle successfully exactly once")
	}
	return nil
}
