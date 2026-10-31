package contextual

import (
	"errors"

	"github.com/ncecere/grounded/internal/catalog"
)

// promptInputTokens counts the actual escaped messages and local framing with
// the configured margin. It is not the gateway's tokenizer or an invoice bound.
func (g *Generator) promptInputTokens(in Input) int64 {
	return int64(WithMargin(g.Counter.Count(SystemPrompt) + g.Counter.Count(UserMessage(in)) + 16))
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
