package contextual

import "context"

// Cached context is derived source data too: neither a cache hit nor a wait for
// another caller may bypass cancellation, revocation or the source/model gate.
func requestCheckpoint(ctx context.Context, req Request) error {
	if err := ctx.Err(); err != nil {
		return &StopError{Reason: "cancelled", Err: err}
	}
	if req.Checkpoint != nil {
		if err := req.Checkpoint(ctx); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return &StopError{Reason: "cancelled", Err: err}
	}
	return nil
}
