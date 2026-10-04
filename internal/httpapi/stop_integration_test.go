package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"
)

// TestStopAfterTheModelFinished (v0.4.2 US-05): a reader who presses Stop
// while a finished answer is still being checked (here a public answer's
// moderation) never got it; it's stored as stopped, so a reload says
// Stopped rather than showing a complete answer.
func TestStopAfterTheModelFinished(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	v := newVisitor(t, env.app.URL)
	if code, e := v.start(pub.Id, "", ""); code != 201 {
		t.Fatalf("start = %d %s", code, e)
	}
	env.proxy.SetModerationDelay(1500 * time.Millisecond)
	t.Cleanup(func() { env.proxy.SetModerationDelay(0) })
	before := env.proxy.ModerationRequests()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b, _ := json.Marshal(map[string]any{"message": "Where do students buy a parking permit?"})
	req, _ := http.NewRequestWithContext(ctx, "POST", env.app.URL+"/v1/public/agents/"+pub.Id.String()+"/chat", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", env.app.URL)
	done := make(chan struct{})
	go func() {
		defer close(done)
		res, err := v.client.Do(req)
		if err != nil {
			return
		}
		if res.StatusCode != 200 {
			raw, _ := io.ReadAll(res.Body)
			t.Errorf("chat = %d %s", res.StatusCode, raw)
		}
		_, _ = io.Copy(io.Discard, res.Body)
		_ = res.Body.Close()
	}()
	// The question's check, then the answer's: the model has finished.
	deadline := time.Now().Add(10 * time.Second)
	for env.proxy.ModerationRequests() < before+2 {
		if time.Now().After(deadline) {
			t.Fatalf("the answer's moderation check never started: %d %d %v", before, env.proxy.ModerationRequests(), env.proxy.RequestLog())
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	<-done

	q := `SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
		WHERE c.agent_id = $1 AND m.role = 'assistant' AND m.stop_reason = $2`
	for time.Now().Before(deadline) && env.scalar(t, q, pub.Id, "aborted") == 0 {
		time.Sleep(50 * time.Millisecond)
	}
	if n := env.scalar(t, q, pub.Id, "aborted"); n != 1 {
		t.Fatalf("stopped answers stored = %d (complete: %d)", n, env.scalar(t, q, pub.Id, "stop"))
	}
}
