package gateway

import (
	"context"
	"encoding/json"
	"net/http"

	"go.opentelemetry.io/otel/attribute"
)

// OperationRerank is a rerank call's gen_ai.operation.name.
const OperationRerank = "rerank"

// RerankRequest scores documents against a query with a cross-encoder
// (docs/v0.4.0.md §3) over POST {base}/rerank, the Cohere and Jina request
// shape that LiteLLM, vLLM and SGLang accept.
type RerankRequest struct {
	Model     string
	Query     string
	Documents []string
	// TopN, when above 0 and SendTopN is set, asks for the best TopN
	// results only (the "top_n" field).
	TopN     int
	SendTopN bool
	// DocumentsField is the request field carrying the documents:
	// "documents" (the default) or "texts" (Hugging Face text embeddings
	// inference).
	DocumentsField string
	// User is the caller's tag. It is not sent: rerank APIs don't define it,
	// and strict servers refuse unknown fields.
	User string
}

// RerankScore is one document's relevance score; Index is its position in
// the request's documents.
type RerankScore struct {
	Index int
	Score float64
}

// RerankResult holds the scores the server returned (best first is not
// guaranteed) and the tokens it reported (0 when it reported none).
type RerankResult struct {
	Scores []RerankScore
	Tokens int
}

// rerankItem is one result: Cohere, Jina, vLLM and LiteLLM send
// relevance_score, text embeddings inference sends score.
type rerankItem struct {
	Index          *int     `json:"index"`
	RelevanceScore *float64 `json:"relevance_score"`
	Score          *float64 `json:"score"`
}

// rerankBody is the response: {results:[…]} (or {data:[…]}) with usage, or
// a bare array.
type rerankBody struct {
	Results []rerankItem `json:"results"`
	Data    []rerankItem `json:"data"`
	Usage   struct {
		TotalTokens  int `json:"total_tokens"`
		PromptTokens int `json:"prompt_tokens"`
	} `json:"usage"`
	Meta struct {
		Tokens struct {
			InputTokens int `json:"input_tokens"`
		} `json:"tokens"`
	} `json:"meta"`
}

// UnmarshalJSON accepts the object form and the bare array form.
func (b *rerankBody) UnmarshalJSON(raw []byte) error {
	if len(raw) > 0 && raw[0] == '[' {
		return json.Unmarshal(raw, &b.Results)
	}
	type plain rerankBody
	return json.Unmarshal(raw, (*plain)(b))
}

func (b *rerankBody) tokens() int {
	switch {
	case b.Usage.PromptTokens > 0:
		return b.Usage.PromptTokens
	case b.Usage.TotalTokens > 0:
		return b.Usage.TotalTokens
	}
	return b.Meta.Tokens.InputTokens
}

// Rerank calls POST /rerank. Every returned index must name a request
// document once, with a score.
func (c *Client) Rerank(ctx context.Context, r RerankRequest) (res RerankResult, err error) {
	ctx, span := StartModelSpan(ctx, OperationRerank, r.Model, attribute.Int("grounded.rerank.documents", len(r.Documents)))
	defer func() { EndModelSpan(span, res.Tokens, 0, err) }()
	field := r.DocumentsField
	if field != "texts" {
		field = "documents"
	}
	body := map[string]any{"model": r.Model, "query": r.Query, field: r.Documents}
	if r.SendTopN && r.TopN > 0 {
		body["top_n"] = min(r.TopN, len(r.Documents))
	}
	if field == "documents" {
		body["return_documents"] = false
	}
	// No "user": rerank APIs don't define it, and strict servers refuse the request (422).
	var out rerankBody
	if err := c.do(ctx, http.MethodPost, "/rerank", body, &out); err != nil {
		return RerankResult{}, err
	}
	items := out.Results
	if len(items) == 0 {
		items = out.Data
	}
	if len(items) == 0 && len(r.Documents) > 0 {
		return RerankResult{}, &Error{Kind: KindBadResponse, Message: "the rerank response has no results"}
	}
	seen := make([]bool, len(r.Documents))
	res.Scores = make([]RerankScore, 0, len(items))
	for _, it := range items {
		score := it.RelevanceScore
		if score == nil {
			score = it.Score
		}
		if it.Index == nil || score == nil || *it.Index < 0 || *it.Index >= len(seen) || seen[*it.Index] {
			return RerankResult{}, &Error{Kind: KindBadResponse, Message: "the rerank results' indexes or scores are invalid"}
		}
		seen[*it.Index] = true
		res.Scores = append(res.Scores, RerankScore{Index: *it.Index, Score: *score})
	}
	res.Tokens = out.tokens()
	return res, nil
}
