package profilemig

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
)

var errNotReady = apperr.Conflict("migration_not_ready", "This migration is not waiting to be switched")

// Evaluate starts the comparison of a ready held migration again (live index against candidate, over the knowledge base's evaluation
// sets), for after documents changed or the candidate caught up. It returns how many sets it started, and refuses while a comparison is
// still running (409 preview_running) or when the migration is not ready.
func (s *Service) Evaluate(ctx context.Context, a authz.Actor, id uuid.UUID) (int, error) {
	if !a.IsPlatformAdmin() {
		return 0, errAdminOnly
	}
	return s.startComparison(ctx, id, &a)
}
