package catalog

import "github.com/ncecere/grounded/internal/apperr"

// A chat model's output is part of its context, never larger than the whole
// window (#146). Unknown values remain allowed; non-chat context fields are
// cleared by normalizeSpec and do not impose a chat-only constraint.
func validateOutputWindow(kind string, window, output *int32) error {
	if kind == KindChat && window != nil && output != nil && *output > *window {
		return apperr.Invalid("invalid_max_output_tokens", "Maximum output tokens must not exceed the context window")
	}
	return nil
}
