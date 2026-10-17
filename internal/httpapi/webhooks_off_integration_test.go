package httpapi_test

import (
	"testing"
	"time"
)

// Turning webhooks off and on again "resumes them" (the switch's own words, docs/webhooks.md): a delivery that was waiting to retry when the
// switch went off is not failed for good at its next attempt; it waits, and goes on when webhooks are on again (QA pass v0.6.0, #137).
func TestWebhookDeliveriesWaitWhileWebhooksAreOff(t *testing.T) {
	env := newHookEnv(t)
	svc := env.app.Svc.Webhooks
	svc.RetryBackoff = func(int) time.Duration { return 1500 * time.Millisecond }
	svc.OffSnooze = 400 * time.Millisecond

	env.rx.mu.Lock()
	env.rx.answer = func(int) int { return 500 } // the receiver is down: the first attempt fails and a retry is scheduled
	env.rx.mu.Unlock()
	c := env.make(t, env.tadmin, env.base, "waits", "agent.published")
	path := env.base + "/webhooks/" + c.Webhook.Id.String()
	env.publishAgent(t, "Waiting help", env.agentConfig(env.kb.Id.String()))
	env.rx.waitCalls(t, 1)

	// Off while the retry is due: it comes and goes without sending.
	env.setWebhooks(t, false)
	time.Sleep(3500 * time.Millisecond)
	d := env.deliveries(t, env.tadmin, path)
	if len(d) != 1 || string(d[0].Status) != "pending" {
		t.Fatalf("a delivery waiting while webhooks are off = %+v, want one pending delivery", d)
	}
	if d[0].LastError == "webhooks are turned off" {
		t.Errorf("the delivery was given a permanent 'turned off' error: %+v", d[0])
	}
	if n := len(env.rx.calls()); n != 1 {
		t.Errorf("the receiver got %d requests while webhooks were off, want the 1 from before", n)
	}

	// On again, with the receiver back: it is delivered.
	env.rx.mu.Lock()
	env.rx.answer = func(int) int { return 200 }
	env.rx.mu.Unlock()
	env.setWebhooks(t, true)
	env.waitStatus(t, env.tadmin, path, "delivered")
}
