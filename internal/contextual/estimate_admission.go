package contextual

import "math/big"

// admissionEstimateBlockers checks build-wide feasibility before creating a
// candidate. Day caps remain dispatch windows: a valid build may span days.
// Live atomic admission still checks current settings/prices and other work.
func admissionEstimateBlockers(est *SourceEstimate) {
	add := func(code, message string) { est.Blockers = append(est.Blockers, Issue{code, message}) }
	if err := validateAdmission(est.Admission, true); err != nil {
		add("contextual_admission_required", "Configure explicit token and configured-price spend admission before previewing contextual chunks")
		return
	}
	a := est.Admission
	if est.InputTokensMax+est.OutputTokensMax > a.MaxTokens {
		add("tokens_over_cap", "This build's conservative token estimate exceeds its source admission limit. Raise it explicitly or reduce the source before previewing.")
	}
	if !est.Cost.PriceKnown {
		add("contextual_price_unknown", "Configure both chat token prices before a contextual preview can reserve spend. Unknown price is not zero.")
		return
	}
	if est.Cost.Currency != a.Currency {
		add("contextual_currency", "The source admission currency must match the configured price currency before previewing")
		return
	}
	amount, aok := new(big.Rat).SetString(est.Cost.MaxAmount)
	cap, cok := new(big.Rat).SetString(a.MaxAmount)
	if !aok || !cok || amount.Cmp(cap) > 0 {
		add("amount_over_cap", "This build's conservative configured-price estimate exceeds its source admission limit. Raise it explicitly or reduce the source before previewing.")
	}
}
