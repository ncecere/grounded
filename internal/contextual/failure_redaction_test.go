package contextual

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
)

func TestFailureErrorDoesNotEchoProviderTextButPreservesCause(t *testing.T) {
	const canary = "SYNTHETIC-PRIVATE-PROMPT-OR-REPLY-CANARY"
	cause := errors.New("provider echoed " + canary)
	f := &Failure{Code: CodeUnavailable, Err: cause}
	if strings.Contains(f.Error(), canary) || strings.Contains(f.Error(), "provider echoed") {
		t.Fatal("contextual failure's loggable string includes provider text")
	}
	if !errors.Is(f, cause) || !strings.Contains(f.Error(), string(CodeUnavailable)) {
		t.Fatal("redaction lost stable code or unwrap identity")
	}
}

func TestRemoteBackpressureErrorDoesNotEchoProviderText(t *testing.T) {
	const canary = "SYNTHETIC-PRIVATE-CONTEXT-CANARY"
	g := Generator{}
	upstream := &gateway.Error{Kind: gateway.KindRateLimited, Status: 429, RetryAfter: time.Second, Message: canary}
	settled := false
	err := g.failed(t.Context(), context.Background(), 1, upstream, func(st Settlement) error {
		settled = st.Outcome == OutcomeError
		return nil
	})
	var ge *gateway.Error
	if !settled || !errors.As(err, &ge) || ge.Status != 429 || ge.RetryAfter != time.Second || !ge.Backpressure() {
		t.Fatalf("redaction changed retry/admission behavior: %v", err)
	}
	if strings.Contains(err.Error(), canary) {
		t.Fatal("remote backpressure's loggable string includes provider text")
	}
}
