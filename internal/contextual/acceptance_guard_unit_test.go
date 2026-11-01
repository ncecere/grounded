package contextual

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

type acceptanceCountingTransport struct{ calls atomic.Int64 }

func (p *acceptanceCountingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	p.calls.Add(1)
	return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
}

func fakeAcceptanceLimits() acceptanceLimits {
	return acceptanceLimits{Requests: 16, InputTokens: 20000, OutputTokens: 4000, Amount: "1.000000", ContextModel: "ctx", EmbeddingModel: "embed",
		InputPrice: "1.000000", OutputPrice: "1.000000", EmbeddingPrice: "1.000000"}
}

func acceptanceRequest(t *testing.T, path string, body any) *http.Request {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, "https://acceptance.example.test/v1"+path, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	return req
}

func TestAcceptanceGuardRequiresExplicitPricesAndLimits(t *testing.T) {
	for _, name := range []string{"amount", "input", "output", "requests", "price", "model", "credential URL"} {
		t.Run(name, func(t *testing.T) {
			limits, endpoint := fakeAcceptanceLimits(), "https://acceptance.example.test/v1"
			switch name {
			case "amount":
				limits.Amount = ""
			case "input":
				limits.InputTokens = 0
			case "output":
				limits.OutputTokens = 0
			case "requests":
				limits.Requests = 0
			case "price":
				limits.EmbeddingPrice = ""
			case "model":
				limits.ContextModel = ""
			case "credential URL":
				endpoint = "https://synthetic-user:synthetic-canary@acceptance.example.test/v1"
			}
			_, err := newAcceptanceTransport(endpoint, limits, counter(t))
			if err == nil || strings.Contains(err.Error(), "synthetic-canary") {
				t.Fatalf("invalid grant accepted or leaked: %v", err)
			}
		})
	}
}

func TestAcceptanceGuardRefusesExtraProviderWorkAndNoncanonicalPrices(t *testing.T) {
	for _, field := range []string{"n", "functions", "function_call", "tool_choice", "web_search_options", "modalities"} {
		g, err := newAcceptanceTransport("https://acceptance.example.test/v1", fakeAcceptanceLimits(), counter(t))
		if err != nil {
			t.Fatal(err)
		}
		provider := &acceptanceCountingTransport{}
		g.next = provider
		body := map[string]any{"model": "ctx", "max_tokens": RequestMaxTokens, "messages": []map[string]string{
			{"role": "system", "content": SystemPrompt}, {"role": "user", "content": "A synthetic section."}}, field: 2}
		if _, err := g.RoundTrip(acceptanceRequest(t, "/chat/completions", body)); err == nil || provider.calls.Load() != 0 {
			t.Errorf("unsupported %s reached transport", field)
		}
	}
	for _, value := range []string{"1/2", "1e999999999", "NaN", "-1", "1.1234567", ".1", "1."} {
		limits := fakeAcceptanceLimits()
		limits.InputPrice = value
		if _, err := newAcceptanceTransport("https://acceptance.example.test/v1", limits, counter(t)); err == nil {
			t.Errorf("noncanonical price accepted: %s", value)
		}
	}
	g, err := newAcceptanceTransport("https://acceptance.example.test/v1", fakeAcceptanceLimits(), counter(t))
	if err != nil {
		t.Fatal(err)
	}
	if g.next.(*http.Transport).Proxy != nil {
		t.Fatal("implicit environment proxy was allowed")
	}
}

func TestAcceptanceGuardAtomicallyBoundsConcurrentRequests(t *testing.T) {
	limits := fakeAcceptanceLimits()
	limits.Requests = 1
	g, err := newAcceptanceTransport("https://acceptance.example.test/v1", limits, counter(t))
	if err != nil {
		t.Fatal(err)
	}
	provider := &acceptanceCountingTransport{}
	g.next = provider
	var allowed atomic.Int64
	var wg sync.WaitGroup
	for range 20 {
		req := acceptanceRequest(t, "/embeddings", map[string]any{"model": "embed", "input": []string{"Student library renewal"}})
		wg.Go(func() {
			if response, err := g.RoundTrip(req); err == nil {
				allowed.Add(1)
				response.Body.Close()
			}
		})
	}
	wg.Wait()
	got := g.snapshot()
	if allowed.Load() != 1 || provider.calls.Load() != 1 || got.Requests != 1 || got.EmbeddingRequests != 1 || got.InputTokens <= 0 {
		t.Fatalf("concurrent acceptance gate overspent: allowed=%d provider=%d usage=%+v", allowed.Load(), provider.calls.Load(), got)
	}
}

func TestAcceptanceGuardRefusesUnexpectedWorkBeforeTransport(t *testing.T) {
	for _, name := range []string{"wrong model", "wrong destination", "unknown path", "tools", "too much output", "oversized", "input cap", "amount cap"} {
		t.Run(name, func(t *testing.T) {
			limits := fakeAcceptanceLimits()
			body := map[string]any{"model": "ctx", "max_tokens": RequestMaxTokens, "stream": false,
				"messages": []map[string]string{{"role": "system", "content": SystemPrompt}, {"role": "user", "content": "A bounded student handbook section."}}}
			if name == "input cap" {
				limits.InputTokens = 1
			}
			if name == "amount cap" {
				limits.Amount = "0.000001"
			}
			switch name {
			case "wrong model":
				body["model"] = "not-approved"
			case "tools":
				body["tools"] = []map[string]any{{"type": "function"}}
			case "too much output":
				body["max_tokens"] = RequestMaxTokens + 1
			case "oversized":
				body["padding"] = strings.Repeat("x", 64<<10)
			}
			g, err := newAcceptanceTransport("https://acceptance.example.test/v1", limits, counter(t))
			if err != nil {
				t.Fatal(err)
			}
			provider := &acceptanceCountingTransport{}
			g.next = provider
			req := acceptanceRequest(t, "/chat/completions", body)
			if name == "wrong destination" {
				req.URL.Host = "other.example.test"
			}
			if name == "unknown path" {
				req.URL.Path = "/v1/models"
			}
			_, err = g.RoundTrip(req)
			if err == nil || provider.calls.Load() != 0 || g.snapshot().Requests != 0 {
				t.Fatalf("unexpected work reached gateway: err=%v provider=%d usage=%+v", err, provider.calls.Load(), g.snapshot())
			}
		})
	}
}

func TestAcceptanceGuardAcceptsSDKTextPartsButNotImages(t *testing.T) {
	for _, image := range []bool{false, true} {
		g, err := newAcceptanceTransport("https://acceptance.example.test/v1", fakeAcceptanceLimits(), counter(t))
		if err != nil {
			t.Fatal(err)
		}
		provider := &acceptanceCountingTransport{}
		g.next = provider
		content := []map[string]string{{"type": "text", "text": "A bounded handbook section."}}
		if image {
			content = []map[string]string{{"type": "image_url", "text": "not authorized"}}
		}
		body := map[string]any{"model": "ctx", "max_tokens": RequestMaxTokens, "stream": true, "messages": []map[string]any{
			{"role": "system", "content": []map[string]string{{"type": "text", "text": SystemPrompt}}}, {"role": "user", "content": content}}}
		response, err := g.RoundTrip(acceptanceRequest(t, "/chat/completions", body))
		if image {
			if err == nil || provider.calls.Load() != 0 {
				t.Fatal("image content reached transport")
			}
		} else {
			if err != nil || provider.calls.Load() != 1 {
				t.Fatalf("SDK text content was refused: %v", err)
			}
			response.Body.Close()
		}
	}
}

func TestAcceptanceGuardRetainsReservationAfterUncertainTransport(t *testing.T) {
	limits := fakeAcceptanceLimits()
	limits.Requests = 1
	g, err := newAcceptanceTransport("https://acceptance.example.test/v1", limits, counter(t))
	if err != nil {
		t.Fatal(err)
	}
	g.next = failingAcceptanceTransport{}
	body := map[string]any{"model": "embed", "input": []string{"Student library renewal"}}
	if _, err := g.RoundTrip(acceptanceRequest(t, "/embeddings", body)); err == nil {
		t.Fatal("uncertain transport unexpectedly succeeded")
	}
	if g.snapshot().Requests != 1 {
		t.Fatal("uncertain delivery refunded reservation")
	}
	if _, err := g.RoundTrip(acceptanceRequest(t, "/embeddings", body)); err == nil {
		t.Fatal("uncertain delivery permitted another request beyond the cap")
	}
}

type failingAcceptanceTransport struct{}

func (failingAcceptanceTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, io.ErrUnexpectedEOF
}
