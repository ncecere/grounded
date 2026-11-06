package agents

import (
	"context"

	"github.com/ncecere/grounded/internal/access"
	"github.com/ncecere/grounded/internal/kbs"
)

// readCaller is whose document permissions an answer's retrieval reads with (docs/specs/document-acls/DESIGN.md): the
// person asking, in the app or on their own connected app (MCP). An anonymous visitor (public page, widget), an API key
// and an evaluation run read unrestricted documents only. A router's routed answer is the same run, so the same caller.
func (ru *run) readCaller(ctx context.Context) (access.Caller, error) {
	if ru.anon != nil || ru.evaluation {
		return access.Anyone(), nil
	}
	return ru.s.KBs.CallerFor(ctx, ru.a)
}

// newRetriever sets the answer's retriever with the caller's permissions, and whether its knowledge has restricted
// documents (which keeps the answer out of the answer cache).
func (ru *run) newRetriever(ctx context.Context, resolved []kbs.KB) error {
	caller, err := ru.readCaller(ctx)
	if err != nil {
		return err
	}
	ru.retr = newRetriever(ru.s.KBs, resolved, ru.cfg, ru.userTag(), caller)
	ru.restricted, err = ru.retr.restrictedKnowledge(ctx)
	return err
}
