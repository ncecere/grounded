package gateway_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/testutil"
)

func kindOf(err error) string {
	var ge *gateway.Error
	if errors.As(err, &ge) {
		return ge.Kind
	}
	return ""
}

func TestClientAgainstFakeProxy(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	c := gateway.New(p.BaseURL()+"/", p.APIKey, 5*time.Second)
	ctx := context.Background()

	ids, err := c.ListModels(ctx)
	if err != nil || !slices.Contains(ids, "test-embed") || !slices.Contains(ids, "test-chat") {
		t.Fatalf("models = %v %v", ids, err)
	}

	res, err := c.Embed(ctx, gateway.EmbedRequest{Model: "test-embed", Input: []string{"a", "b", "a"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Vectors) != 3 || len(res.Vectors[0]) != 8 || res.Usage.TotalTokens == 0 {
		t.Fatalf("embed = %+v", res)
	}
	if !slices.Equal(res.Vectors[0], res.Vectors[2]) || slices.Equal(res.Vectors[0], res.Vectors[1]) {
		t.Fatal("embeddings not deterministic per input")
	}

	out, err := c.Complete(ctx, gateway.CompleteRequest{Model: "test-chat", Messages: []gateway.ChatMessage{{Role: "user", Content: "ping"}}, MaxTokens: 5})
	if err != nil || out.Text != "pong" || out.FinishReason != "stop" {
		t.Fatalf("complete = %+v %v", out, err)
	}
}

func TestClientErrors(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	ctx := context.Background()

	if _, err := gateway.New(p.BaseURL(), "wrong", time.Second).ListModels(ctx); kindOf(err) != gateway.KindAuth {
		t.Errorf("bad key: %v", err)
	}
	c := gateway.New(p.BaseURL(), p.APIKey, time.Second)
	if _, err := c.Embed(ctx, gateway.EmbedRequest{Model: "nope", Input: []string{"x"}}); kindOf(err) != gateway.KindNotFound {
		t.Errorf("unknown model: %v", err)
	}
	p.FailWith(http.StatusServiceUnavailable)
	if _, err := c.ListModels(ctx); kindOf(err) != gateway.KindUnavailable {
		t.Errorf("5xx: %v", err)
	}
	p.FailWith(http.StatusTooManyRequests)
	if _, err := c.ListModels(ctx); kindOf(err) != gateway.KindRateLimited {
		t.Errorf("429: %v", err)
	}
	p.FailWith(0)

	// Base URL without /v1 reaches a non-JSON or 404 path.
	if _, err := gateway.New(p.URL, p.APIKey, time.Second).ListModels(ctx); kindOf(err) != gateway.KindNotFound {
		t.Errorf("missing /v1: %v", err)
	}
	if _, err := gateway.New("http://127.0.0.1:1", "", time.Second).ListModels(ctx); kindOf(err) != gateway.KindUnavailable {
		t.Errorf("connection refused: %v", err)
	}

	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(300 * time.Millisecond) }))
	defer slow.Close()
	_, err := gateway.New(slow.URL, "", 50*time.Millisecond).ListModels(ctx)
	var ge *gateway.Error
	if !errors.As(err, &ge) || !ge.TimedOut() || !strings.HasPrefix(ge.Message, "timed out after") || !strings.Contains(ge.Message, "waiting for the response") {
		t.Errorf("timeout: %v", err)
	}

	html := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("<html>")) }))
	defer html.Close()
	if _, err := gateway.New(html.URL, "", time.Second).ListModels(ctx); kindOf(err) != gateway.KindBadResponse {
		t.Errorf("html response: %v", err)
	}
}
