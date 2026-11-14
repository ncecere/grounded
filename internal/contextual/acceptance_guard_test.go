package contextual

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/ncecere/grounded/internal/chunk"
)

// Test/harness-only network ceiling. The real Generator+PGStore still performs
// contextual admission; this also bounds embeddings and all gateway requests.
// Nothing here refunds unknown responses or claims an external invoice cap.
type acceptanceLimits struct {
	Requests, InputTokens, OutputTokens     int64
	Amount                                  string
	ContextModel, EmbeddingModel            string
	InputPrice, OutputPrice, EmbeddingPrice string
}

type acceptanceUsage struct {
	DispatchAttempts  int64  `json:"dispatchAttemptsMayHaveBeenSent"`
	Requests          int64  `json:"requests"`
	ContextRequests   int64  `json:"contextRequests"`
	EmbeddingRequests int64  `json:"embeddingRequests"`
	InputTokens       int64  `json:"reservedLocalInputTokens"`
	OutputTokens      int64  `json:"reservedOutputTokens"`
	Amount            string `json:"reservedConfiguredAmount"`
}

type acceptanceTransport struct {
	check    func() error
	next     http.RoundTripper
	endpoint *url.URL
	counter  chunk.TokenCounter
	limits   acceptanceLimits
	mu       sync.Mutex
	usage    acceptanceUsage
	amount   *big.Rat
}

func newAcceptanceTransport(endpoint string, limits acceptanceLimits, counter chunk.TokenCounter) (*acceptanceTransport, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("acceptance gateway must be an explicit HTTP(S) endpoint without credentials or query")
	}
	if !acceptanceDecimal(limits.Amount) {
		return nil, errors.New("acceptance requires a canonical positive amount")
	}
	amount, ok := new(big.Rat).SetString(limits.Amount)
	if !ok || amount.Sign() <= 0 || limits.Requests < 1 || limits.Requests > 64 || limits.InputTokens < 1 || limits.InputTokens > 250000 || limits.OutputTokens < 1 || limits.OutputTokens > 25000 {
		return nil, errors.New("acceptance requires explicit bounded request/token/amount limits")
	}
	if limits.ContextModel == "" || limits.EmbeddingModel == "" {
		return nil, errors.New("acceptance requires explicit model identities")
	}
	for _, price := range []string{limits.InputPrice, limits.OutputPrice, limits.EmbeddingPrice} {
		if !acceptanceDecimal(price) {
			return nil, errors.New("acceptance requires canonical configured prices")
		}
		p, ok := new(big.Rat).SetString(price)
		if !ok || p.Sign() < 0 {
			return nil, errors.New("acceptance requires known nonnegative configured prices")
		}
	}
	base, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return nil, errors.New("acceptance requires a standard direct transport")
	}
	transport := base.Clone()
	transport.Proxy = nil // An environment proxy is not part of the agreed gateway.
	return &acceptanceTransport{next: transport, endpoint: u, counter: counter, limits: limits, usage: acceptanceUsage{Amount: "0.000000"}, amount: new(big.Rat)}, nil
}

func acceptanceDecimal(value string) bool {
	if len(value) == 0 || len(value) > 20 {
		return false
	}
	whole, fraction, dot := strings.Cut(value, ".")
	if len(whole) == 0 || len(whole) > 12 || (dot && (len(fraction) == 0 || len(fraction) > 6)) {
		return false
	}
	for _, r := range whole + fraction {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (g *acceptanceTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if err := req.Context().Err(); err != nil {
		return nil, errors.New("dispatch_cancelled")
	}
	if g.check != nil {
		if err := g.check(); err != nil {
			return nil, err
		}
	}
	if req.Method != http.MethodPost || req.URL.Scheme != g.endpoint.Scheme || req.URL.Host != g.endpoint.Host || req.URL.User != nil || req.URL.RawQuery != "" || req.URL.Fragment != "" || req.URL.Opaque != "" || (req.Host != "" && req.Host != g.endpoint.Host) {
		return nil, errors.New("acceptance refused unexpected method or destination")
	}
	if req.GetBody == nil {
		return nil, errors.New("acceptance requires a bounded replayable JSON request")
	}
	body, err := req.GetBody()
	if err != nil {
		return nil, errors.New("acceptance could not inspect request")
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, (64<<10)+1))
	if err != nil || len(data) > 64<<10 {
		return nil, errors.New("acceptance refused oversized request")
	}
	kind, input, output, err := g.requestBudget(req.URL.EscapedPath(), data)
	if err != nil {
		return nil, err
	}
	if err := g.reserve(kind, input, output); err != nil {
		return nil, err
	}
	if g.check != nil {
		if err := g.check(); err != nil {
			return nil, err
		}
	}
	g.mu.Lock()
	g.usage.DispatchAttempts++
	g.mu.Unlock()
	response, err := g.next.RoundTrip(req)
	if err == nil && response != nil {
		response.Body = &acceptanceResponseBody{ReadCloser: response.Body, remaining: 1 << 20}
	}
	return response, err
}

func (g *acceptanceTransport) requestBudget(path string, data []byte) (string, int64, int64, error) {
	var request struct {
		Model    string `json:"model"`
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
		Input               []string        `json:"input"`
		MaxTokens           int             `json:"max_tokens"`
		MaxCompletionTokens int             `json:"max_completion_tokens"`
		ReasoningEffort     json.RawMessage `json:"reasoning_effort"`
		Stream              bool            `json:"stream"`
		StreamOptions       *struct {
			IncludeUsage bool `json:"include_usage"`
		} `json:"stream_options"`
		User           string `json:"user"`
		EncodingFormat string `json:"encoding_format"`
		Dimensions     int    `json:"dimensions"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF {
		return "", 0, 0, errors.New("acceptance refused invalid JSON")
	}
	prefix := strings.TrimRight(g.endpoint.EscapedPath(), "/")
	switch path {
	case prefix + "/chat/completions":
		if request.Model != g.limits.ContextModel || len(request.Messages) != 2 || len(request.Input) != 0 || request.Dimensions != 0 || request.EncodingFormat != "" || !acceptanceChatEffort(request.ReasoningEffort) || (request.MaxTokens > 0 && request.MaxCompletionTokens > 0) {
			return "", 0, 0, errors.New("acceptance refused unexpected context request")
		}
		var text [2]string
		for i, message := range request.Messages {
			value, err := acceptanceMessageText(message.Content)
			if err != nil {
				return "", 0, 0, err
			}
			text[i] = value
		}
		if request.Messages[0].Role != "system" || text[0] != SystemPrompt || request.Messages[1].Role != "user" {
			return "", 0, 0, errors.New("acceptance refused unexpected context roles or system prompt")
		}
		output := max(request.MaxTokens, request.MaxCompletionTokens)
		if output < 1 || output > RequestMaxTokens {
			return "", 0, 0, errors.New("acceptance refused unbounded context output")
		}
		return "context", int64(withMargin(g.counter.Count(text[0]) + g.counter.Count(text[1]) + 16)), int64(output), nil
	case prefix + "/embeddings":
		if request.Model != g.limits.EmbeddingModel || len(request.Input) < 1 || len(request.Input) > 32 || len(request.Messages) != 0 || request.Stream || request.StreamOptions != nil || request.MaxTokens != 0 || request.MaxCompletionTokens != 0 || len(request.ReasoningEffort) != 0 || request.Dimensions < 0 || request.Dimensions > 4000 || (request.EncodingFormat != "" && request.EncodingFormat != "float") {
			return "", 0, 0, errors.New("acceptance refused unexpected embedding request")
		}
		input := 0
		for _, text := range request.Input {
			input += g.counter.Count(text)
		}
		return "embedding", int64(withMargin(input)), 0, nil
	}
	return "", 0, 0, errors.New("acceptance refused unexpected gateway path")
}

// No unbounded reasoning option or arbitrary provider setting is authorized.
func acceptanceChatEffort(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return true
	}
	var effort string
	return json.Unmarshal(raw, &effort) == nil && effort == "none"
}

// OpenAI adapters may encode plain text as a string or text-only content
// parts. Neither form authorizes images, tools or another input modality.
func acceptanceMessageText(raw json.RawMessage) (string, error) {
	var text string
	if len(raw) > 0 && raw[0] == '"' && json.Unmarshal(raw, &text) == nil {
		return text, nil
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&parts) != nil || len(parts) == 0 || len(parts) > 8 {
		return "", errors.New("acceptance requires text-only fixed-prompt messages")
	}
	var out strings.Builder
	for _, part := range parts {
		if part.Type != "text" {
			return "", errors.New("acceptance refused non-text content")
		}
		out.WriteString(part.Text)
	}
	return out.String(), nil
}

func (g *acceptanceTransport) reserve(kind string, input, output int64) error {
	inPrice, outPrice := g.limits.InputPrice, g.limits.OutputPrice
	if kind == "embedding" {
		inPrice, outPrice = g.limits.EmbeddingPrice, "0"
	}
	amount, err := admissionAmount(input, output, inPrice, outPrice)
	if err != nil {
		return errors.New("acceptance could not reserve configured amount")
	}
	price, _ := new(big.Rat).SetString(amount)
	limit, _ := new(big.Rat).SetString(g.limits.Amount)
	g.mu.Lock()
	defer g.mu.Unlock()
	next := new(big.Rat).Add(g.amount, price)
	if g.usage.Requests+1 > g.limits.Requests || g.usage.InputTokens+input > g.limits.InputTokens || g.usage.OutputTokens+output > g.limits.OutputTokens || next.Cmp(limit) > 0 {
		return errors.New("acceptance exhausted explicit whole-run limits")
	}
	g.usage.Requests++
	if kind == "context" {
		g.usage.ContextRequests++
	} else {
		g.usage.EmbeddingRequests++
	}
	g.usage.InputTokens += input
	g.usage.OutputTokens += output
	g.amount = next
	g.usage.Amount = ceilAmount(next)
	return nil
}

func (g *acceptanceTransport) snapshot() acceptanceUsage {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.usage
}

// A stream or embedding response cannot grow without bound.
type acceptanceResponseBody struct {
	io.ReadCloser
	remaining int64
}

func (b *acceptanceResponseBody) Read(p []byte) (int, error) {
	if b.remaining <= 0 {
		return 0, errors.New("response_size")
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.ReadCloser.Read(p)
	b.remaining -= int64(n)
	return n, err
}
