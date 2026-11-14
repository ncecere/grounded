package fakes

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/fakeembed"
)

// admitEmbedding applies injected failures and the rate limit. It returns
// the status and Retry-After to answer with, or 0.
func (p *FakeProxy) admitEmbedding(now time.Time) (int, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.rejectN > 0 {
		p.rejectN--
		p.embedRejected++
		return p.rejectStatus, p.rejectRetryAfter
	}
	if p.embedRPM > 0 {
		cut := 0
		for cut < len(p.embedWindow) && now.Sub(p.embedWindow[cut]) >= time.Minute {
			cut++
		}
		p.embedWindow = p.embedWindow[cut:]
		if len(p.embedWindow) >= p.embedRPM {
			p.embedRejected++
			wait := time.Minute - now.Sub(p.embedWindow[0])
			return http.StatusTooManyRequests, fmt.Sprint(int(math.Ceil(wait.Seconds())))
		}
		p.embedWindow = append(p.embedWindow, now)
	}
	return 0, ""
}

func (p *FakeProxy) embeddings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Model      string `json:"model"`
		Input      any    `json:"input"`
		Dimensions int    `json:"dimensions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	p.log(r, in.Model)
	p.mu.Lock()
	dims, ok := p.embedding[in.Model]
	mrl := p.matryoshka[in.Model]
	p.embedDims = append(p.embedDims, in.Dimensions)
	p.mu.Unlock()
	if !ok {
		writeErr(w, 404, "model not found")
		return
	}
	if in.Dimensions != 0 && (!mrl || in.Dimensions < 1 || in.Dimensions > dims) {
		writeErr(w, 400, "Model \""+in.Model+"\" does not support matryoshka representation, changing output dimensions will lead to poor results.")
		return
	}
	if status, retryAfter := p.admitEmbedding(time.Now()); status != 0 {
		if retryAfter != "" {
			w.Header().Set("Retry-After", retryAfter)
		}
		writeErr(w, status, "rate limit exceeded")
		return
	}
	p.mu.Lock()
	latency := p.embedLatency
	p.mu.Unlock()
	if latency > 0 {
		select {
		case <-time.After(latency):
		case <-r.Context().Done():
			return
		}
	}
	var inputs []string
	switch v := in.Input.(type) {
	case string:
		inputs = []string{v}
	case []any:
		for _, s := range v {
			str, _ := s.(string)
			inputs = append(inputs, str)
		}
	}
	p.recordEmbedInputs(inputs)
	p.mu.Lock()
	bad := p.rejectInput
	p.mu.Unlock()
	for _, text := range inputs {
		if bad != "" && strings.Contains(text, bad) {
			writeErr(w, http.StatusBadRequest, "input rejected")
			return
		}
	}
	data := make([]map[string]any, len(inputs))
	tokens := 0
	for i, text := range inputs {
		vec := FakeEmbedding(text, dims)
		if in.Dimensions > 0 {
			vec = truncateNormalize(vec, in.Dimensions)
		}
		data[i] = map[string]any{"object": "embedding", "index": i, "embedding": vec}
		tokens += len(strings.Fields(text)) + 1
	}
	p.mu.Lock()
	p.embedBatches = append(p.embedBatches, len(inputs))
	p.mu.Unlock()
	_ = json.NewEncoder(w).Encode(map[string]any{
		"object": "list", "data": data, "model": in.Model,
		"usage": map[string]int{"prompt_tokens": tokens, "total_tokens": tokens},
	})
}

// truncateNormalize keeps the first n values at unit length (Matryoshka).
func truncateNormalize(v []float32, n int) []float32 {
	out := append([]float32(nil), v[:n]...)
	var sum float64
	for _, x := range out {
		sum += float64(x) * float64(x)
	}
	if sum > 0 {
		norm := math.Sqrt(sum)
		for i, x := range out {
			out[i] = float32(float64(x) / norm)
		}
	}
	return out
}

// FakeEmbedding returns the vector the fake proxy produces for text
// (fakeembed.Vector, shared with the demo's gateway).
func FakeEmbedding(text string, dims int) []float32 { return fakeembed.Vector(text, dims) }
