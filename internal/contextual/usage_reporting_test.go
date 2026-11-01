package contextual

import (
	"context"
	"math"
	"testing"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestReportedUsageDoesNotInventMissingZeroOrOverflowCounts(t *testing.T) {
	for _, tc := range []struct {
		name          string
		input, output int
		known         bool
	}{
		{"complete", 7, 3, true}, {"missing", 0, 0, false}, {"output missing or ambiguous zero", 7, 0, false},
		{"input missing or ambiguous zero", 0, 3, false}, {"negative input", -1, 3, false}, {"negative output", 7, -1, false},
		{"input overflow", math.MaxInt32 + 1, 3, false}, {"output overflow", 7, math.MaxInt32 + 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, known := reportedUsage(llm.Usage{Input: tc.input, Output: tc.output})
			if known != tc.known {
				t.Errorf("usage completeness = %v want %v", known, tc.known)
			}
		})
	}
}

type usageReportingProvider struct{ usage llm.Usage }

func (p usageReportingProvider) Stream(_ context.Context, _ llm.Model, _ llm.Context, _ llm.Options) <-chan llm.Event {
	out := make(chan llm.Event, 1)
	out <- llm.Event{Type: llm.EventDone, Message: llm.AssistantMessage{
		Content: []llm.Block{llm.Text{Text: "This section describes a synthetic institutional procedure."}}, Usage: p.usage}}
	close(out)
	return out
}

// The real generator and PG admission/settlement run; the provider is a
// scripted terminal event and makes no HTTP/model request.
func TestPGGeneratorPartialUsageDoesNotRefundOutputHeadroom(t *testing.T) {
	for _, partial := range []bool{true, false} {
		t.Run(map[bool]string{true: "partial", false: "complete"}[partial], func(t *testing.T) {
			proxy, config := fakeAcceptanceConfig(t)
			run, err := newAcceptanceRun(t, config, proxy.APIKey, "scripted-usage")
			if err != nil {
				t.Fatal(err)
			}
			u := llm.Usage{Input: 7, Output: 3}
			if partial {
				u.Output = 0
			}
			run.generator.NewProvider = func(*gateway.Client) llm.Provider { return usageReportingProvider{usage: u} }
			if err := run.generate(t.Context()); err != nil {
				t.Fatal(err)
			}
			var charged, reserved int64
			if err := run.fixture.pool.QueryRow(t.Context(), `SELECT sum(charged_tokens)::bigint, sum(reserved_tokens)::bigint FROM contextual_calls WHERE source_id = $1`, run.fixture.res.SourceID).Scan(&charged, &reserved); err != nil {
				t.Fatal(err)
			}
			want := int64(6 * (7 + 3))
			if partial {
				want = reserved
				if reserved < 6*RequestMaxTokens {
					t.Fatal("test did not reserve output headroom")
				}
			}
			if charged != want {
				t.Errorf("partial=%v charged tokens=%d want%d", partial, charged, want)
			}
			stats, err := dbgen.New(run.fixture.pool).ContextualCallStats(t.Context(), dbgen.ContextualCallStatsParams{SourceID: run.fixture.res.SourceID})
			if err != nil {
				t.Fatal(err)
			}
			unknown := int64(0)
			if partial {
				unknown = 6
			}
			if stats.Unknown != unknown {
				t.Errorf("partial=%v unknown=%d want%d", partial, stats.Unknown, unknown)
			}
			if len(proxy.ContextCalls()) != 0 {
				t.Fatal("scripted usage test unexpectedly called gateway")
			}
		})
	}
}

func TestPGTerminalMissingUsageRemainsVisibleAsUnknown(t *testing.T) {
	for _, outcome := range []string{OutcomeOK, OutcomeRefused, OutcomeInvalid} {
		t.Run(outcome, func(t *testing.T) {
			f := newSettlementFixture(t)
			id, err := f.store.Reserve(t.Context(), f.res)
			if err != nil {
				t.Fatal(err)
			}
			usage := f.usage
			usage.Reported = false
			if err := f.store.Settle(t.Context(), Settlement{ID: id, Outcome: outcome, Usage: &usage}); err != nil {
				t.Fatal(err)
			}
			stats, err := dbgen.New(f.pool).ContextualCallStats(t.Context(), dbgen.ContextualCallStatsParams{SourceID: f.res.SourceID})
			if err != nil {
				t.Fatal(err)
			}
			if stats.Attempts != 1 || stats.Unknown != 1 {
				t.Errorf("terminal missing usage was called known: outcome=%s attempts=%d unknown=%d", outcome, stats.Attempts, stats.Unknown)
			}
		})
	}
}

func TestPGPartialUsageIsUnknownAndCompleteUsageControlIsKnown(t *testing.T) {
	for _, partial := range []bool{true, false} {
		t.Run(map[bool]string{true: "partial", false: "complete"}[partial], func(t *testing.T) {
			f := newSettlementFixture(t)
			id, err := f.store.Reserve(t.Context(), f.res)
			if err != nil {
				t.Fatal(err)
			}
			in, out := int32(7), int32(3)
			st := Settlement{ID: id, Outcome: OutcomeOK, TokensIn: &in, TokensOut: &out, Usage: &f.usage}
			if partial {
				st.TokensOut = nil
			}
			if err := f.store.Settle(t.Context(), st); err != nil {
				t.Fatal(err)
			}
			stats, err := dbgen.New(f.pool).ContextualCallStats(t.Context(), dbgen.ContextualCallStatsParams{SourceID: f.res.SourceID})
			if err != nil {
				t.Fatal(err)
			}
			want := int64(0)
			if partial {
				want = 1
			}
			if stats.Unknown != want {
				t.Errorf("partial=%v unknown=%d want%d", partial, stats.Unknown, want)
			}
		})
	}
}
