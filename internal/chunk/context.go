package chunk

import (
	"strings"

	"github.com/ncecere/grounded/internal/strutil"
)

// ContextLabel starts the context line of an embedding input.
const ContextLabel = "Context: "

// EmbedTextContext is EmbedText with a model-written context line between the title and heading header and the passage (contextual
// chunks, ADR-0028). The context is part of what is embedded and of nothing else: it is not the passage's text. With no context it is
// exactly EmbedText.
//
//	"Student Handbook\nRegistration > Late registration\n\nContext: <context>\n\n<content>"
func EmbedTextContext(title string, c Chunk, context string) string {
	context = strutil.OneLine(context)
	if context == "" {
		return EmbedText(title, c)
	}
	parts := make([]string, 0, 3)
	if header := EmbedText(title, Chunk{HeadingPath: c.HeadingPath}); header != "" {
		parts = append(parts, header)
	}
	parts = append(parts, ContextLabel+context)
	if strings.TrimSpace(c.Content) != "" {
		parts = append(parts, c.Content)
	}
	return strings.Join(parts, "\n\n")
}
