package gateway

// reservedChatFields are the chat completion fields Grounded sets or depends on
// itself. A model's extraBody compat option (DESIGN.md §10) may not set
// them: it adds server extensions such as chat_template_kwargs, it never
// changes what Grounded asks for or how it reads the answer.
var reservedChatFields = map[string]bool{
	"model": true, "messages": true, "stream": true, "stream_options": true,
	"tools": true, "tool_choice": true, "parallel_tool_calls": true,
	"functions": true, "function_call": true, "n": true, "user": true,
	"max_tokens": true, "max_completion_tokens": true, "temperature": true,
	"reasoning_effort": true,
}

// ReservedChatField reports whether extraBody may not set the field.
func ReservedChatField(name string) bool { return reservedChatFields[name] }

// MergeExtra adds extra's fields to a chat completion request body. Reserved
// fields and fields the body already has are skipped, so extra can never
// override what Grounded sends.
func MergeExtra(body, extra map[string]any) {
	for k, v := range extra {
		if reservedChatFields[k] {
			continue
		}
		if _, set := body[k]; set {
			continue
		}
		body[k] = v
	}
}
