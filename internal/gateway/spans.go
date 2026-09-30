package gateway

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/tracing"
)

// Model call spans (docs/operations/tracing.md) follow the OpenTelemetry
// GenAI conventions: "chat gpt-4o", "embeddings text-embedding-3-small",
// with the model and token counts. Never the prompt, the inputs or the
// completion.

// Operation names (gen_ai.operation.name).
const (
	OperationChat       = "chat"
	OperationEmbeddings = "embeddings"
)

// StartModelSpan starts a client span for one model call.
func StartModelSpan(ctx context.Context, operation, model string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	attrs = append(attrs, attribute.String("gen_ai.operation.name", operation), attribute.String("gen_ai.request.model", model))
	return tracing.StartKind(ctx, operation+" "+model, trace.SpanKindClient, attrs...)
}

// EndModelSpan records the token counts and ends the span, failed with the
// call's outcome (a gateway error kind) when err is set.
func EndModelSpan(span trace.Span, inputTokens, outputTokens int, err error) {
	if inputTokens > 0 {
		span.SetAttributes(attribute.Int("gen_ai.usage.input_tokens", inputTokens))
	}
	if outputTokens > 0 {
		span.SetAttributes(attribute.Int("gen_ai.usage.output_tokens", outputTokens))
	}
	if err != nil {
		tracing.Fail(span, Outcome(err))
	}
	span.End()
}
