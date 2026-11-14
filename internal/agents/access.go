package agents

import (
	"context"

	"github.com/ncecere/grounded/internal/access"
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
