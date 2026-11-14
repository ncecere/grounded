package catalog

import (
	"context"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Usage is what uses each model and embedding profile, for the catalog
// pages' "Used by" (docs/ui-review A5; platform admins and auditors).
func (s *Service) Usage(ctx context.Context, a authz.Actor) ([]dbgen.ModelUsageRow, []dbgen.ProfileUsageRow, error) {
	if !a.CanReadPlatform() {
		return nil, nil, errReadOnly
	}
	models, err := s.q.ModelUsage(ctx)
	if err != nil {
		return nil, nil, err
	}
	profiles, err := s.q.ProfileUsage(ctx)
	if err != nil {
		return nil, nil, err
	}
	return models, profiles, nil
}
