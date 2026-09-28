package llm

import (
	"context"
	"errors"

	"github.com/ncecere/grounded/internal/gateway"
)

// Complete streams a response and returns the final message. The error is
// non-nil when the stream ended in error or was aborted (the message is still
// returned, with whatever arrived); it wraps the provider error, so
// errors.As(err, *gateway.Error) and errors.Is(err, context.Canceled) work.
func Complete(ctx context.Context, p Provider, model Model, c Context, opts Options) (AssistantMessage, error) {
	var final *Event
	for ev := range p.Stream(ctx, model, c, opts) {
		if ev.Type.Terminal() && final == nil {
			e := ev
			final = &e
		}
	}
	if final == nil {
		msg := "the model stream ended without a result"
		return AssistantMessage{Model: model.ID, StopReason: StopReasonError, ErrorMessage: msg, ErrorKind: gateway.KindBadResponse},
			&gateway.Error{Kind: gateway.KindBadResponse, Message: msg}
	}
	if final.Type == EventDone {
		return final.Message, nil
	}
	err := final.Err
	if err == nil {
		err = errors.New(final.Message.ErrorMessage)
	}
	return final.Message, err
}
