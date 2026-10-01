// Command fakeproxy runs a deterministic OpenAI-compatible API for local
// development, so the model admin screens and agent chat work without a real
// proxy key.
//
//	go run ./cmd/fakeproxy            # http://127.0.0.1:8090/v1, key sk-dev-fake
//
// It serves GET /v1/models, POST /v1/embeddings (hashed bag-of-words
// vectors) and POST /v1/chat/completions, streamed or not. Chat replies are
// deterministic: a few reasoning_content deltas, then a search_knowledge
// tool call when tools are offered and no tool result exists yet, otherwise
// the first line of the `<source id="1">` block plus " [1]", otherwise the
// text of a system-prompt line `Refusal message: "<text>"`. The full rules
// are documented on testutil.FakeProxy.
//
// Moderation providers (ADR-0019) are deterministic too: POST /v1/moderations,
// POST /v1/systemone (model e.g. jev-latest), the guardrail chat models
// fake-llama-guard, fake-granite-guardian and fake-shieldgemma (with
// logprobs when asked), and the chat classifier prompt on any chat model.
// A text containing UNSAFE-VIOLENCE (or "hurt someone") scores violence
// 0.97, UNSAFE-PII personal_data, and so on (see testutil/fakemoderation.go);
// anything else scores 0.02.
//
// Embedding models: nomic-embed-text-v1.5 (768 dimensions),
// sfr-embedding-mistral (4096), qwen3-embedding-4b (2560; rejects the
// "dimensions" parameter, so profiles with fewer output dimensions are
// truncated by Grounded) and fake-matryoshka-2560 (2560; accepts "dimensions",
// for models with supportsDimensionsParam).
//
// Rerank model: fake-reranker (POST /v1/rerank, the Cohere and Jina shape)
// scores a passage by the share of the query's words it contains; a passage
// containing FAKE-RERANK-TOP scores 1.
//
// Vision model: fake-vision transcribes a page image (an image_url part) as
// "# Transcribed page" and the image's size, for the OCR vision backend.
//
// -embed-rpm and -embed-latency simulate a rate-limited gateway (429 with
// Retry-After beyond the limit, e.g. a gateway allowing 120 requests per minute).
package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/ncecere/grounded/internal/testutil"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8090", "listen address")
	key := flag.String("key", "sk-dev-fake", "API key clients must send")
	rpm := flag.Int("embed-rpm", 0, "answer 429 beyond this many embedding requests per minute (0 = unlimited)")
	latency := flag.Duration("embed-latency", 0, "delay every embedding response")
	flag.Parse()

	p, h := testutil.NewFakeProxyHandler(*key)
	p.AddChatModel("gpt-oss-120b")
	p.AddEmbeddingModel("nomic-embed-text-v1.5", 768)
	p.AddEmbeddingModel("sfr-embedding-mistral", 4096)
	// 2560 native dimensions for output-dimension profiles: one rejects the
	// "dimensions" parameter (Grounded truncates), one accepts it.
	p.AddEmbeddingModel("qwen3-embedding-4b", 2560)
	p.AddMatryoshkaEmbeddingModel("fake-matryoshka-2560", 2560)
	p.LimitEmbeddingRate(*rpm)
	p.SetEmbedLatency(*latency)

	go func() { // embedding traffic summary while it changes
		last := -1
		for range time.Tick(10 * time.Second) {
			batches := p.EmbedBatches()
			if len(batches)+p.EmbedRejected() == last {
				continue
			}
			last = len(batches) + p.EmbedRejected()
			inputs := 0
			for _, n := range batches {
				inputs += n
			}
			log.Printf("embeddings: %d requests, %d inputs (%.1f per request), %d rejected",
				len(batches), inputs, float64(inputs)/float64(max(len(batches), 1)), p.EmbedRejected())
		}
	}()
	log.Printf("fake OpenAI-compatible proxy on http://%s/v1 (API key %q)", *addr, *key)
	srv := &http.Server{Addr: *addr, Handler: h, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}
