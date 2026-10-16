package testutil

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// TEST_TIME_SCALE stretches the limit of every wait in the Go integration tests by one factor, for a machine slower than the runners the
// limits were set for, such as a shared cluster node (the same setting, and the same rules, as web/test-scale.ts, which stretches the web
// tests). It is 1 by default, so CI is unchanged. It is a limit, not a delay: a test that finishes in time is no slower, and a real hang
// still fails, only later. Only 1 to 10 is accepted; anything else (0.5, 0, a word) is ignored, so it can never shorten a limit.
//
// Scale the deadline of a poll ("wait until the documents are ready"), never a duration the test is about (a TTL, a timeout it expects to
// fire, a window it asserts on): stretching those would change what the test checks. TestWaitDeadlinesAreScaled keeps the polls honest.

// ParseTimeScale is the scale in a setting: 1 to 10, else 1.
func ParseTimeScale(value string) float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 1
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || !(n >= 1 && n <= 10) { // not (>= && <=) so a NaN is refused too
		return 1
	}
	return n
}

// Scale is a limit times the scale in the environment's TEST_TIME_SCALE.
func Scale(d time.Duration) time.Duration {
	return time.Duration(float64(d) * ParseTimeScale(os.Getenv("TEST_TIME_SCALE")))
}
