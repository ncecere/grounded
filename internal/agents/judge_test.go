package agents

import (
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/systemone"
)

// TestJudgingLimit: judging waits the time limit, never more than twice the
// per-request timeout (the bound before the time limit existed).
func TestJudgingLimit(t *testing.T) {
	s := time.Second
	for _, tc := range []struct{ limit, timeout, want time.Duration }{
		{1500 * time.Millisecond, 5 * s, 1500 * time.Millisecond},
		{10 * s, 2 * s, 4 * s}, // the hard ceiling
		{0, 5 * s, 10 * s},     // no limit (a plan built by hand)
	} {
		plan := &systemone.JudgePlan{TimeLimit: tc.limit, Options: systemone.JudgeOptions{Timeout: tc.timeout}}
		if got := judgingLimit(plan); got != tc.want {
			t.Errorf("limit %v, timeout %v: %v, want %v", tc.limit, tc.timeout, got, tc.want)
		}
	}
}
