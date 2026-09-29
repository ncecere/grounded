package systemone

import (
	"context"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// AgentUse counts the published agents (active, in active teams) each
// check is on for: by the agent's own "SystemOne checks" setting, else by
// the platform default. The platform defaults alone don't say whether
// SystemOne does anything; the admin Overview's Features card and the
// SystemOne page show these counts too.
type AgentUse struct {
	Judging, Citations, Scope, Any int32
}

// AgentUse returns the counts for the stored settings: all zero without a
// model, since no check runs then.
func (s *Service) AgentUse(ctx context.Context, st Stored) (AgentUse, error) {
	if st.ModelID == nil {
		return AgentUse{}, nil
	}
	row, err := s.q.CountSystemOneAgents(ctx, dbgen.CountSystemOneAgentsParams{
		Judging: st.Settings.Judging.Enabled, Citations: st.Settings.Citations.Enabled, Scope: st.Settings.Scope.Enabled,
	})
	if err != nil {
		return AgentUse{}, err
	}
	return AgentUse{Judging: row.Judging, Citations: row.Citations, Scope: row.Scope, Any: row.AnyCheck}, nil
}
