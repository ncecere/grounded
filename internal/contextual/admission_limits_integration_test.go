package contextual

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func TestPGConcurrentAdmissionCannotOverspendEitherWindow(t *testing.T) {
	for _, kind := range []string{"day tokens", "day amount", "build tokens", "build amount", "platform day tokens"} {
		t.Run(kind, func(t *testing.T) {
			f := newSettlementFixture(t)
			column, cap := "max_tokens_per_day", "15"
			switch kind {
			case "day amount":
				column, cap = "max_amount_per_day", "0.000015"
			case "build tokens":
				column = "max_tokens"
			case "build amount":
				column, cap = "max_amount", "0.000015"
			case "platform day tokens":
				if _, err := f.pool.Exec(t.Context(), `UPDATE data_sources SET team_id = NULL WHERE id = $1`, f.res.SourceID); err != nil {
					t.Fatal(err)
				}
			}
			// Column and cap are fixed test literals, never external input.
			if _, err := f.pool.Exec(t.Context(), `UPDATE source_contextual SET `+column+` = `+cap+` WHERE source_id = $1`, f.res.SourceID); err != nil {
				t.Fatal(err)
			}
			var admitted, denied atomic.Int64
			var wg sync.WaitGroup
			for range 20 {
				wg.Go(func() {
					_, err := f.store.Reserve(t.Context(), f.res)
					if err == nil {
						admitted.Add(1)
					} else if errors.Is(err, ErrCapReached) {
						denied.Add(1)
					} else {
						t.Error(err)
					}
				})
			}
			wg.Wait()
			if admitted.Load() != 1 || denied.Load() != 19 {
				t.Fatalf("admitted=%d denied=%d; want 1/19", admitted.Load(), denied.Load())
			}
			var calls, tokens int64
			if err := f.pool.QueryRow(t.Context(), `SELECT count(*), sum(charged_tokens)::bigint FROM contextual_calls WHERE source_id = $1`, f.res.SourceID).Scan(&calls, &tokens); err != nil {
				t.Fatal(err)
			}
			if calls != 1 || tokens != 10 {
				t.Fatalf("durable reservation calls=%d tokens=%d, want 1/10", calls, tokens)
			}
		})
	}
}

func TestPGAdmissionRequiresKnownPricesEvenWithCostModeOff(t *testing.T) {
	f := newSettlementFixture(t)
	if _, err := f.pool.Exec(t.Context(), `UPDATE cost_settings SET mode = 'off'`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `DELETE FROM model_prices WHERE model_id = $1 AND unit = 'chat_tokens_out'`, f.res.ModelID); err != nil {
		t.Fatal(err)
	}
	_, err := f.store.Reserve(t.Context(), f.res)
	var wait *Wait
	if !errors.As(err, &wait) || wait.Code != "contextual_price_unknown" {
		t.Fatalf("got %v, want unknown-price wait", err)
	}
	var n int
	if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM contextual_calls`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("unknown price created attempts=%d err=%v", n, err)
	}
}

func TestPGAdmissionDoesNotMixCurrenciesOrResetTheirWindow(t *testing.T) {
	f := newSettlementFixture(t)
	if _, err := f.store.Reserve(t.Context(), f.res); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE source_contextual SET currency = 'EUR' WHERE source_id = $1`, f.res.SourceID); err != nil {
		t.Fatal(err)
	}
	_, err := f.store.Reserve(t.Context(), f.res)
	var wait *Wait
	if !errors.As(err, &wait) || wait.Code != "contextual_currency" {
		t.Fatalf("mismatched configured currency: %v", err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE cost_settings SET currency = 'EUR'`); err != nil {
		t.Fatal(err)
	}
	_, err = f.store.Reserve(t.Context(), f.res)
	if !errors.As(err, &wait) || wait.Code != "contextual_currency" {
		t.Fatalf("currency change reset the charged window: %v", err)
	}
}

func TestPGAdmissionReadsLoweredLimitsInsteadOfCallerCap(t *testing.T) {
	f := newSettlementFixture(t)
	if _, err := f.store.Reserve(t.Context(), f.res); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `UPDATE source_contextual SET max_tokens_per_day = 10 WHERE source_id = $1`, f.res.SourceID); err != nil {
		t.Fatal(err)
	}
	r := f.res
	r.Cap = 100000
	if _, err := f.store.Reserve(t.Context(), r); !errors.Is(err, ErrCapReached) {
		t.Fatalf("lowered live token limit was ignored: %v", err)
	}
}

func TestPGKnownSettlementReconcilesHeadroomButUnknownKeepsIt(t *testing.T) {
	for _, outcome := range []string{"reported", "unknown", "partial", "overrun"} {
		t.Run(outcome, func(t *testing.T) {
			f := newSettlementFixture(t)
			if _, err := f.pool.Exec(t.Context(), `UPDATE source_contextual SET max_tokens_per_day = 100 WHERE source_id = $1`, f.res.SourceID); err != nil {
				t.Fatal(err)
			}
			r := f.res
			r.InputTokens, r.OutputTokens = 50, 50
			id, err := f.store.Reserve(t.Context(), r)
			if err != nil {
				t.Fatal(err)
			}
			in, out := int32(10), int32(5)
			u := f.usage
			u.TokensIn, u.TokensOut = int(in), int(out)
			st := Settlement{ID: id, Outcome: OutcomeOK, TokensIn: &in, TokensOut: &out, Usage: &u}
			wantTokens := int64(15)
			switch outcome {
			case "unknown":
				st = Settlement{ID: id, Outcome: OutcomeTimeout}
				wantTokens = 100
			case "partial":
				st.TokensOut = nil
				wantTokens = 100
			case "overrun":
				in, out = 100, 50
				u.TokensIn, u.TokensOut = 100, 50
				wantTokens = 150
			}
			if err := f.store.Settle(t.Context(), st); err != nil {
				t.Fatal(err)
			}
			var charged int64
			if err := f.pool.QueryRow(t.Context(), `SELECT charged_tokens FROM contextual_calls WHERE id = $1`, id).Scan(&charged); err != nil || charged != wantTokens {
				t.Fatalf("charged=%d want=%d err=%v", charged, wantTokens, err)
			}
			_, err = f.store.Reserve(t.Context(), f.res)
			if outcome == "reported" {
				if err != nil {
					t.Fatalf("known usage did not free unused headroom: %v", err)
				}
			} else if !errors.Is(err, ErrCapReached) {
				t.Fatalf("unknown/overrun usage produced unsafe headroom: %v", err)
			}
		})
	}
}

func TestPGOffTransitionDoesNotRepopulateCacheButRecordsRealUsage(t *testing.T) {
	f := newSettlementFixture(t)
	id, err := f.store.Reserve(t.Context(), f.res)
	if err != nil {
		t.Fatal(err)
	}
	entry := f.cacheEntry(t, 5, "A valid context that arrived after the source was switched off.")
	if _, err := f.pool.Exec(t.Context(), `UPDATE source_contextual SET enabled = false WHERE source_id = $1`, f.res.SourceID); err != nil {
		t.Fatal(err)
	}
	err = f.store.Settle(t.Context(), Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage, Cache: &entry})
	var stopped *StopError
	if !errors.As(err, &stopped) {
		t.Fatalf("got %v, want off-transition stop", err)
	}
	if rows, tokens := f.ledger(t); rows != 2 || tokens != 10 {
		t.Fatalf("paid usage lost on off transition: %d/%d", rows, tokens)
	}
	cached, err := f.store.CacheFor(t.Context(), entry.DocumentID, [][32]byte{entry.Key})
	if err != nil || len(cached) != 0 {
		t.Fatalf("off transition repopulated cache: %v %v", cached, err)
	}
}
