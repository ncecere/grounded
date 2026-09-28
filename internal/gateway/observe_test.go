package gateway_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/testutil"
)

type outcomes struct {
	mu  sync.Mutex
	got []string
}

func (o *outcomes) observe(outcome string, elapsed time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if elapsed < 0 {
		outcome += "(negative)"
	}
	o.got = append(o.got, outcome)
}

func (o *outcomes) take() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	got := o.got
	o.got = nil
	return got
}

func TestObserveReportsEveryRequest(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	obs := &outcomes{}
	c := gateway.New(p.BaseURL(), p.APIKey, 5*time.Second)
	c.Observe = obs.observe
	ctx := context.Background()
	embed := func() { _, _ = c.Embed(ctx, gateway.EmbedRequest{Model: "test-embed", Input: []string{"x"}}) }

	embed()
	p.RejectEmbeddings(1, 429, "1")
	embed()
	p.RejectEmbeddings(1, 500, "")
	embed()
	if got := fmt.Sprint(obs.take()); got != "[ok rate_limited unavailable]" {
		t.Errorf("outcomes = %s", got)
	}

	// Streams report when the headers arrive.
	res, err := c.PostStream(ctx, "/chat/completions", map[string]any{
		"model": "test-chat", "stream": true, "messages": []map[string]string{{"role": "user", "content": "hi"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if got := fmt.Sprint(obs.take()); got != "[ok]" {
		t.Errorf("stream outcomes = %s", got)
	}

	// A request the connection's own limit refuses is throttled, never sent.
	c.Limiter = &recordingLimiter{refuse: &gateway.Error{Kind: gateway.KindRateLimited, RetryAfter: time.Minute}}
	embed()
	if _, err := c.PostStream(ctx, "/chat/completions", map[string]any{}); err == nil {
		t.Fatal("refused stream succeeded")
	}
	if got := fmt.Sprint(obs.take()); got != "[throttled throttled]" {
		t.Errorf("throttled outcomes = %s", got)
	}
}

func TestOutcome(t *testing.T) {
	cases := map[string]error{
		gateway.OutcomeOK:        nil,
		gateway.OutcomeThrottled: &gateway.Error{Kind: gateway.KindRateLimited},
		gateway.KindRateLimited:  &gateway.Error{Kind: gateway.KindRateLimited, Status: 429},
		gateway.KindAuth:         fmt.Errorf("wrapped: %w", &gateway.Error{Kind: gateway.KindAuth, Status: 401}),
		gateway.OutcomeCanceled:  context.Canceled,
		gateway.KindUnavailable:  errors.New("something else"),
	}
	for want, err := range cases {
		if got := gateway.Outcome(err); got != want {
			t.Errorf("Outcome(%v) = %s, want %s", err, got, want)
		}
	}
}
