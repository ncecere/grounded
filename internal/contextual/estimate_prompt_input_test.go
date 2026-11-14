package contextual

import "testing"

// Planning and the actual reservation must use compatible ceilings, including
// delimiter escaping, local chat framing and the same configured margin.
func TestMetadataEstimateCoversEscapedPromptReservation(t *testing.T) {
	e := newGen(t)
	req, required := escapedCapacityRequest(t, e)
	plan := planDocument(itemsOf(req.Chunks), e.g.Counter)
	input := int64(required - RequestMaxTokens)
	if plan.Over || plan.Units != 1 {
		t.Fatalf("unexpected fixture plan: %+v", plan)
	}
	t.Logf("actual local input reservation=%d advertised metadata ceiling=%d", input, plan.InputMax)
	if input > plan.InputMax {
		t.Fatalf("actual local input reservation=%d exceeds advertised metadata ceiling=%d", input, plan.InputMax)
	}
}
