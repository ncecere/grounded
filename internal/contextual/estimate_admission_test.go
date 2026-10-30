package contextual

import (
	"context"
	"math/big"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
)

func TestConfiguredPriceEstimateCoversPerAttemptRounding(t *testing.T) {
	for _, priced := range []bool{true, false} {
		rate := new(big.Rat)
		want := "0.000000"
		if priced {
			rate.SetFrac64(1, 1000000)
			want = "0.000100"
		}
		s := Service{Price: func(context.Context, authz.Actor, uuid.UUID) (Price, error) {
			return Price{Known: true, Currency: "USD", InputPerMillion: rate, OutputPerMillion: new(big.Rat)}, nil
		}}
		e := SourceEstimate{Model: uuid.NullUUID{UUID: uuid.New(), Valid: true}, Totals: Totals{Calls: 100, InputTokensMax: 100}}
		if err := s.price(t.Context(), authz.Actor{}, &e); err != nil || e.Cost.MaxAmount != want {
			t.Fatalf("tiny/zero configured price estimate=%s want=%s err=%v", e.Cost.MaxAmount, want, err)
		}
	}
}

func TestBuildEstimateMaySpanDailyAdmissionWindows(t *testing.T) {
	e := SourceEstimate{Admission: &Admission{MaxTokens: 100000, MaxTokensPerDay: 1000, MaxAmount: "10", MaxAmountPerDay: "0.01", Currency: "USD"},
		Totals: Totals{Calls: 100, InputTokensMax: 10000, OutputTokensMax: 1000}, Cost: Cost{PriceKnown: true, Currency: "USD", MaxAmount: "1.000000"}}
	admissionEstimateBlockers(&e)
	if len(e.Blockers) != 0 {
		t.Fatalf("valid multi-day build treated as impossible: %+v", e.Blockers)
	}
}

func TestCostSumDoesNotRelabelUnlikeCurrencies(t *testing.T) {
	c := sumCost([]SourceEstimate{{Cost: Cost{PriceKnown: true, Currency: "USD", MaxAmount: "1"}},
		{Cost: Cost{PriceKnown: true, Currency: "EUR", MaxAmount: "1"}}})
	if c.PriceKnown || c.MaxAmount != "" {
		t.Fatalf("unlike currencies were added: %+v", c)
	}
}
