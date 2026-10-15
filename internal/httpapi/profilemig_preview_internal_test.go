package httpapi

import (
	"testing"

	"github.com/ncecere/grounded/internal/evals"
)

// The comparison's A is the live index and B the candidate; the API names the sides.
func TestPreviewChangeNamesTheSides(t *testing.T) {
	for in, want := range map[string]string{
		evals.ChangeBetter: "better", evals.ChangeWorse: "worse", evals.ChangeSame: "same",
		evals.ChangeOnlyA: "only_live", evals.ChangeOnlyB: "only_candidate",
	} {
		if got := string(previewChange(in)); got != want {
			t.Errorf("previewChange(%s) = %s, want %s", in, got, want)
		}
	}
}
