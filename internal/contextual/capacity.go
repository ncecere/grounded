package contextual

import (
	"errors"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
)

// promptInputTokens counts the actual escaped messages and local framing with
// the configured margin. It is not the gateway's tokenizer or an invoice bound.
func (g *Generator) promptInputTokens(in Input) int64 {
	return int64(withMargin(promptTokens(in, g.Counter)))
}

// checkPromptCapacity supplements the coarse activation floor with this exact
// local prompt estimate, including its full requested output allowance.
func (g *Generator) checkPromptCapacity(target catalog.ChatTarget, in Input) error {
	window := target.Model.ContextWindow
	if window == nil || *window <= 0 || g.promptInputTokens(in)+RequestMaxTokens > int64(*window) {
		return &Failure{Code: CodeModelError, Permanent: true,
			Err: errors.New("contextual prompt does not fit a known model window under the local counter and margin")}
	}
	return nil
}

// promptTokens is shared by fitting and admission; count after escaping, not field sums.
func promptTokens(in Input, c chunk.TokenCounter) int {
	return c.Count(SystemPrompt) + c.Count(UserMessage(in)) + 16
}
