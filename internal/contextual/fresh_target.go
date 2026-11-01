package contextual

import (
	"context"
	"time"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
)

// generationModel pins the non-secret destination and catalog revision used to
// plan an artifact. A credential/timeout change alone needs a fresh client, not
// a different artifact. No key, header or provider error enters this identity.
func generationModel(t catalog.ChatTarget) Model {
	return Model{ID: t.Model.ID, Upstream: t.Model.UpstreamModel,
		Revision: t.Model.Revision, ConnectionID: t.Model.ConnectionID, Endpoint: t.Client.BaseURL}
}

// currentTarget rechecks live scope/model eligibility without a lock over HTTP.
func (g *Generator) currentTarget(ctx context.Context, req Request, planned Model) (catalog.ChatTarget, error) {
	if err := requestCheckpoint(ctx, req); err != nil {
		return catalog.ChatTarget{}, err
	}
	target, err := g.Catalog.ChatTarget(ctx, req.Model)
	if err != nil {
		if cancelled := ctx.Err(); cancelled != nil {
			return catalog.ChatTarget{}, &StopError{Reason: "cancelled", Err: cancelled}
		}
		return catalog.ChatTarget{}, &Failure{Code: CodeForbidden, Err: err, Permanent: true}
	}
	if generationModel(target) != planned {
		return catalog.ChatTarget{}, &StopError{Reason: "model configuration changed; a new contextual plan is required"}
	}
	return target, nil
}

// pacedTarget acquires the connection's slot BEFORE the last eligibility check.
// Catalog clients are rebuilt on each resolve, so pointer equality is not a
// pacing identity. A changed connection revision requires retrying unsent work;
// an old slot must never bypass a replacement connection's pacing settings.
func (g *Generator) pacedTarget(ctx context.Context, req Request, m Model) (catalog.ChatTarget, error) {
	target, err := g.currentTarget(ctx, req, m)
	if err != nil || target.Client.Limiter == nil {
		return target, err
	}
	start := time.Now()
	if err := target.Client.Limiter.Wait(ctx); err != nil {
		if target.Client.Observe != nil {
			target.Client.Observe(gateway.Outcome(err), time.Since(start))
		}
		return catalog.ChatTarget{}, err
	}
	fresh, err := g.currentTarget(ctx, req, m)
	if err != nil {
		return catalog.ChatTarget{}, err
	}
	if fresh.ConnectionRevision != target.ConnectionRevision {
		return catalog.ChatTarget{}, &StopError{Reason: "connection changed during gateway pacing; retry with current settings"}
	}
	return fresh, nil
}

// dispatch includes pacing in the existing call deadline. Every failure before
// entering the provider is proven unsent and releases admission; only the final
// checked target receives the acquired slot. No DB lock spans the pacing wait.
func (g *Generator) dispatch(ctx context.Context, req Request, m Model, in Input, key [32]byte, id int64) (flightResult, error) {
	callCtx, cancel := context.WithTimeout(gateway.Background(ctx), g.timeout())
	defer cancel()
	target, err := g.pacedTarget(callCtx, req, m)
	if err == nil {
		err = g.checkPromptCapacity(target, in)
	}
	if err != nil {
		rctx, stop := context.WithTimeout(context.WithoutCancel(ctx), g.persistenceTimeout())
		defer stop()
		if releaseErr := g.Store.Release(rctx, id); releaseErr != nil {
			g.log().WarnContext(ctx, "could not release an unsent contextual call", "call", id, "err", releaseErr)
		}
		if ctx.Err() != nil {
			err = &StopError{Reason: "cancelled", Err: ctx.Err()}
		} else if callCtx.Err() != nil {
			err = &Failure{Code: CodeUnavailable, Err: callCtx.Err()}
		}
		return flightResult{}, err
	}
	return g.send(ctx, gateway.WithSlot(callCtx), req, target, m, in, key, id)
}
