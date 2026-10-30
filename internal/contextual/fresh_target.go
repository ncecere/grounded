package contextual

import (
	"context"

	"github.com/ncecere/grounded/internal/catalog"
)

// generationModel pins the non-secret destination and catalog revision used to
// plan an artifact. A credential/timeout change alone needs a fresh client, not
// a different artifact. No key, header or provider error enters this identity.
func generationModel(t catalog.ChatTarget) Model {
	return Model{ID: t.Model.ID, Upstream: t.Model.UpstreamModel,
		Revision: t.Model.Revision, ConnectionID: t.Model.ConnectionID, Endpoint: t.Client.BaseURL}
}

// currentTarget runs scope checks and resolves an enabled model/connection at
// each use boundary. A configuration change needs a new plan/key; it must not
// send the old plan to either the old destination or the new one. No DB lock is
// held over a model call. Credential rotations use the newly resolved client.
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

// dispatch checks again after admission, whose row lock can have waited while
// an administrator changed the model/connection. This reservation is proven
// unsent, unlike a request cancelled after entering the provider.
func (g *Generator) dispatch(ctx context.Context, req Request, m Model, in Input, key [32]byte, id int64) (flightResult, error) {
	target, err := g.currentTarget(ctx, req, m)
	if err != nil {
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), g.persistenceTimeout())
		defer cancel()
		if releaseErr := g.Store.Release(rctx, id); releaseErr != nil {
			g.log().WarnContext(ctx, "could not release an unsent contextual call", "call", id, "err", releaseErr)
		}
		return flightResult{}, err
	}
	return g.send(ctx, req, target, m, in, key, id)
}
