// An agent's answer cache settings and Clear cache (Agent → Settings,
// docs/answer-cache.md): the team's editors, admins and owners. The
// settings aren't versioned: a change applies to the next question.

package agents

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/answercache"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// AnswerCacheView is an agent's cache settings and state.
type AnswerCacheView struct {
	answercache.AgentSettings
	// Audience is the agent's audience grant (the default is on for public).
	Audience string
	// On: the agent's setting, else the default for its audience.
	On bool
	// PlatformEnabled is the platform switch; while off nothing is reused.
	PlatformEnabled bool
	// NearIdenticalAvailable: a SystemOne model is set and usable.
	NearIdenticalAvailable bool
	Stats                  answercache.Stats
}

var errNoCache = apperr.New(503, "answer_cache_unavailable", "The answer cache is not available")

// AnswerCache returns an agent's cache settings (team editors, admins and
// owners).
func (s *Service) AnswerCache(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (AnswerCacheView, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, "")
	if err != nil {
		return AnswerCacheView{}, err
	}
	if a.Key != nil || !authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
		return AnswerCacheView{}, apperr.Forbidden("Only team editors, admins and owners can see the answer cache")
	}
	if s.Cache == nil {
		return AnswerCacheView{}, errNoCache
	}
	if _, err := s.loadAgent(ctx, s.q, acc.Team.ID, id, false); err != nil {
		return AnswerCacheView{}, err
	}
	st, err := s.Cache.AgentSettings(ctx, id)
	if err != nil {
		return AnswerCacheView{}, err
	}
	return s.answerCacheView(ctx, id, st)
}

func (s *Service) answerCacheView(ctx context.Context, id uuid.UUID, st answercache.AgentSettings) (AnswerCacheView, error) {
	v := AnswerCacheView{AgentSettings: st, PlatformEnabled: s.Cache.Enabled(ctx)}
	g, err := s.q.GetAudienceGrant(ctx, id)
	if err != nil {
		return v, store.NotFound(err)
	}
	v.Audience, v.On = g.PrincipalType, st.On(g.PrincipalType)
	if s.SystemOne != nil {
		so, err := s.SystemOne.Status(ctx)
		if err != nil {
			return v, err
		}
		v.NearIdenticalAvailable = so.Available
	}
	v.Stats, err = s.Cache.AgentStats(ctx, id)
	return v, err
}

func cacheSnapshot(st answercache.AgentSettings) map[string]any {
	return map[string]any{"enabled": st.Enabled, "nearIdentical": st.NearIdentical, "expiryHours": st.ExpiryHours}
}

// SetAnswerCache saves an agent's cache settings (team editors, admins and
// owners; audited as agent.answer_cache_update). expectedRevision is the
// If-Match revision.
func (s *Service) SetAnswerCache(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, in answercache.AgentInput,
	expectedRevision int64) (AnswerCacheView, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor)
	if err != nil {
		return AnswerCacheView{}, err
	}
	if s.Cache == nil {
		return AnswerCacheView{}, errNoCache
	}
	var after answercache.AgentSettings
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if _, err := s.loadAgent(ctx, q, acc.Team.ID, id, true); err != nil {
			return err
		}
		var before answercache.AgentSettings
		before, after, err = answercache.PutAgentSettings(ctx, tx, id, in, expectedRevision, nullUser(a))
		if err != nil {
			return err
		}
		b, af := cacheSnapshot(before), cacheSnapshot(after)
		if jsonEqual(b, af) {
			return nil
		}
		e := a.Audit("agent.answer_cache_update", "agent", id.String())
		e.TeamID, e.Before, e.After = acc.Team.ID, b, af
		return audit.Record(ctx, q, e)
	})
	if err != nil {
		return AnswerCacheView{}, err
	}
	return s.answerCacheView(ctx, id, after)
}

// ClearAnswerCache deletes every stored answer of an agent, so the next
// questions get fresh ones (team editors, admins and owners; audited as
// agent.answer_cache_clear with the count). It returns how many went.
func (s *Service) ClearAnswerCache(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (int64, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor)
	if err != nil {
		return 0, err
	}
	var n int64
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if _, err := s.loadAgent(ctx, q, acc.Team.ID, id, true); err != nil {
			return err
		}
		if n, err = answercache.Clear(ctx, tx, id); err != nil {
			return err
		}
		e := a.Audit("agent.answer_cache_clear", "agent", id.String())
		e.TeamID = acc.Team.ID
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"cleared": n})
		return audit.Record(ctx, q, e)
	})
	return n, err
}
