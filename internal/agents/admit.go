package agents

import (
	"context"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// errUnavailableNow is what anonymous visitors of a public agent get when
// its team's budget is used up (docs/costs.md §4).
var errUnavailableNow = apperr.New(503, "agent_unavailable", "This assistant is unavailable right now. Please try again later.")

// admit applies the limits (monthly budget, daily chat tokens, query rates,
// concurrent chats) and writes the access log entry that every use of a Sensitive or
// Restricted agent gets. release frees the concurrent-chat slot.
func (ru *run) admit(ctx context.Context) (release func(), err error) {
	s := ru.s
	release = func() {}
	if s.Limits != nil {
		if err := s.Limits.CheckChat(ctx, ru.team.ID, ru.a); err != nil {
			if ru.anon != nil && costs.IsExhausted(err) {
				return nil, errUnavailableNow // anonymous visitors don't see the team's budget
			}
			return nil, err
		}
		if err := s.Limits.CheckAgent(ctx, ru.team.ID, ru.agent.ID); err != nil {
			if ru.anon != nil && costs.IsAgentExhausted(err) {
				return nil, errUnavailableNow // nor the agent's
			}
			return nil, err
		}
		principal := ru.a.UserID.String()
		switch {
		case ru.anon != nil:
			principal = "anon:" + ru.anon.SessionID.String()
		case ru.a.Key != nil && !ru.a.Key.Personal():
			principal = "key:" + ru.a.Key.ID.String()
		}
		slot, err := s.Limits.AcquireChat(ctx, ru.team.ID, principal)
		if err != nil {
			return nil, err
		}
		release = func() { slot.Release(ctx) }
	}
	if ru.rank >= 1 {
		if err := s.q.InsertAccessLog(ctx, dbgen.InsertAccessLogParams{
			UserID: ru.a.NullUser(), APIKeyID: keyID(ru.a), AgentID: ru.agent.ID,
			AgentVersionID: ru.versionID(), Rank: ru.rank, Channel: ru.channel,
		}); err != nil {
			release()
			return nil, err
		}
	}
	return release, nil
}
