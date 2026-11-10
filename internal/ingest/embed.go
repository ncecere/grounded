package ingest

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// embedTexts are the inputs embedded for chunks: the profile's document
// prefix, then the title and heading header and the content, cut to the
// model's input limit.
func (p *Processor) embedTexts(t catalog.EmbedTarget, title string, chunks []chunk.Chunk) []string {
	texts := make([]string, len(chunks))
	for i, c := range chunks {
		texts[i] = t.Profile.DocumentPrefix + truncateTokens(chunk.EmbedText(title, c), t.MaxInputTokens, p.Counter)
	}
	return texts
}

// truncateTokens shortens text to fit a model's input limit. It trims by
// runes proportionally, then re-checks, so it never loops long.
func truncateTokens(text string, maxTokens int, c chunk.TokenCounter) string {
	if maxTokens <= 0 {
		return text
	}
	for i := 0; i < 4; i++ {
		n := c.Count(text)
		if n <= maxTokens {
			return text
		}
		runes := []rune(text)
		keep := len(runes) * maxTokens / n * 95 / 100
		text = string(runes[:max(keep, 1)])
	}
	return text
}

// embed embeds a document's chunk texts: through the shared Batcher when
// set (requests carry several documents), else in requests of EmbedBatch
// inputs for this document alone. Requests are background work under the
// connection's request limit.
func (p *Processor) embed(ctx context.Context, t catalog.EmbedTarget, texts []string, team uuid.NullUUID) ([][]float32, EmbedUsage, error) {
	ctx = gateway.Background(ctx)
	var (
		out   [][]float32
		usage EmbedUsage
		err   error
	)
	if p.Batcher != nil {
		out, usage, err = p.Batcher.Embed(ctx, t, texts, teamUser(team))
	} else {
		out, usage, err = p.embedAlone(ctx, t, texts, teamUser(team))
	}
	if err != nil {
		return nil, usage, err
	}
	for _, v := range out {
		if len(v) != int(t.Profile.Dimensions) {
			return nil, usage, fmt.Errorf("%w: the model returned %d dimensions but the profile expects %d",
				vectorstore.ErrDimensions, len(v), t.Profile.Dimensions)
		}
	}
	return out, usage, nil
}

func (p *Processor) embedAlone(ctx context.Context, t catalog.EmbedTarget, texts []string, user string) ([][]float32, EmbedUsage, error) {
	batch := p.EmbedBatch
	if batch <= 0 {
		batch = 64
	}
	out := make([][]float32, 0, len(texts))
	var usage EmbedUsage
	for start := 0; start < len(texts); start += batch {
		end := min(start+batch, len(texts))
		observability.EmbeddingBatchInputs.Observe(float64(end - start))
		res, err := t.Embed(ctx, texts[start:end], user)
		if err != nil {
			return nil, usage, err
		}
		out = append(out, res.Vectors...)
		usage.Requests++
		usage.Reported += res.Usage.TotalTokens
		for _, s := range texts[start:end] {
			usage.Counted += p.Counter.Count(s)
		}
	}
	return out, usage, nil
}
