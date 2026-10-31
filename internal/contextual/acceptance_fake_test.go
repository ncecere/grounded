package contextual

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/testutil"
)

func newAcceptanceRun(t *testing.T, config acceptanceConfig, key, mode string) (*acceptanceRun, error) {
	t.Helper()
	g := &Generator{Counter: counter(t), Concurrency: 1, CallTimeout: 30 * time.Second}
	planned, err := acceptancePreflight(config, g)
	if err != nil {
		return nil, err
	}
	guard, err := newAcceptanceTransport(config.Endpoint, config.Limits, g.Counter)
	if err != nil {
		return nil, err
	}
	client := acceptanceClient(config, key, guard)
	t.Cleanup(client.HTTP.CloseIdleConnections)
	f := newSettlementFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	if err := configureAcceptanceFixture(ctx, f, config, planned.ContextRequests); err != nil {
		return nil, err
	}
	g.Store, g.Catalog = f.store, acceptanceResolver{pool: f.pool, client: client}
	return &acceptanceRun{fixture: f, generator: g, client: client, guard: guard, config: config,
		report: acceptanceReport{Mode: mode, Planned: planned}}, nil
}

func fakeAcceptanceConfig(t *testing.T) (*testutil.FakeProxy, acceptanceConfig) {
	t.Helper()
	proxy := testutil.NewFakeProxy(t)
	limits := fakeAcceptanceLimits()
	limits.ContextModel, limits.EmbeddingModel, limits.InputTokens = "test-chat", "test-embed", 100000
	return proxy, acceptanceConfig{Endpoint: proxy.BaseURL(), Currency: "USD", Dimensions: 8, ContextWindow: 32000, Seconds: 120, Limits: limits}
}

func TestContextualAcceptanceHarnessFake(t *testing.T) {
	proxy, config := fakeAcceptanceConfig(t)
	run, err := newAcceptanceRun(t, config, proxy.APIKey, "fake")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Duration(config.Seconds)*time.Second)
	defer cancel()
	report, err := run.execute(ctx)
	if err != nil {
		t.Fatalf("fake acceptance failed at stage %q: guard=%+v actualContextCalls=%d", report.FailedStage, report.Reserved, len(proxy.ContextCalls()))
	}
	if report.Status != "passed" || report.ContextCalls != int64(len(acceptanceDocuments)) || report.CachedReplayRequests != 0 {
		t.Fatalf("fake harness accounting/replay = %+v", report)
	}
	if report.Reserved.ContextRequests != 6 || report.Reserved.EmbeddingRequests != 3 || len(proxy.ContextCalls()) != 6 || proxy.EmbedRequestsFor(config.Limits.EmbeddingModel) != 3 {
		t.Fatalf("fake harness unexpected gateway work: %+v", report.Reserved)
	}
	if len(report.Artifacts) != 6 || len(report.Comparison.Ranks) != 6 || len(report.EmbeddingUsage) != 3 {
		t.Fatal("fake harness omitted comparison/evidence")
	}
	data, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) == "" {
		t.Fatal("empty report")
	}
	// Report comparisons honestly; fake answers/ranks do not prove quality.
	for _, rank := range report.Comparison.Ranks {
		if rank.Plain < 1 || rank.Plain > 6 || rank.Contextual < 1 || rank.Contextual > 6 {
			t.Fatalf("invalid rank: %+v", rank)
		}
	}
}

func TestAcceptanceHarnessFailureStillReportsUncertainAttempt(t *testing.T) {
	proxy, config := fakeAcceptanceConfig(t)
	proxy.FailContextWith(429)
	run, err := newAcceptanceRun(t, config, proxy.APIKey, "fake")
	if err != nil {
		t.Fatal(err)
	}
	report, err := run.execute(t.Context())
	if err == nil || report.Status != "failed" || report.FailedStage != "context generation" {
		t.Fatal("remote backpressure did not stop the harness")
	}
	if !report.AccountingCollected || report.AccountingReadFailed || report.ContextCalls != 1 || report.UnknownContextCalls != 1 {
		t.Fatalf("failed run lost accounting: %+v", report)
	}
	if report.Reserved.Requests != 1 || report.Reserved.EmbeddingRequests != 0 || len(proxy.ContextCalls()) != 1 {
		t.Fatal("failed run retried or continued spending")
	}
}

func TestAcceptanceHarnessPreflightRefusesBeforeAnyGatewayWork(t *testing.T) {
	proxy, config := fakeAcceptanceConfig(t)
	config.Limits.Requests = 1
	if _, err := newAcceptanceRun(t, config, proxy.APIKey, "fake"); err == nil {
		t.Fatal("impossible whole-run allowance was accepted")
	}
	if len(proxy.ContextCalls()) != 0 || proxy.EmbedRequestsFor(config.Limits.EmbeddingModel) != 0 {
		t.Fatal("preflight refusal reached a model")
	}
}
