package mcpserver

import (
	"context"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// KnowledgeBase is a knowledge base the caller may search.
type KnowledgeBase struct {
	ID                uuid.UUID
	Name, Description string
	TeamID            uuid.UUID
}

// Agent is an agent the caller may ask.
type Agent struct {
	ID                      uuid.UUID
	Slug, Name, Description string
	TeamID                  uuid.UUID
}

// Backend is what the tools use: Grounded's services, called exactly as the
// REST API calls them.
type Backend interface {
	// KnowledgeBases lists what the actor may search, by name.
	KnowledgeBases(ctx context.Context, a authz.Actor) ([]KnowledgeBase, error)
	// Agents lists the agents the actor may chat with, by name.
	Agents(ctx context.Context, a authz.Actor) ([]Agent, error)
	// Search retrieves passages from a knowledge base (topK 0: its default).
	Search(ctx context.Context, a authz.Actor, kb uuid.UUID, query string, topK int) ([]kbs.Hit, error)
	// Ask asks a published agent, continuing conv when it is set.
	Ask(ctx context.Context, a authz.Actor, agent uuid.UUID, question string, conv *uuid.UUID) (agents.Answer, error)
	// Audit records a tool call.
	Audit(ctx context.Context, e audit.Entry) error
}

// Services is the Backend over the knowledge-base and agent services.
type Services struct {
	KnowledgeBaseService *kbs.Service
	AgentService         *agents.Service
	Q                    *dbgen.Queries
}

var _ Backend = (*Services)(nil)

// team is a team the actor works in.
type team struct {
	ID   uuid.UUID
	Name string
}

// teams are the teams the actor works in: an API key's team, or every team
// a person signed in with OAuth belongs to now (their current memberships,
// read on every request).
func (s *Services) teams(ctx context.Context, a authz.Actor) ([]team, error) {
	if a.Key != nil {
		return []team{{ID: a.Key.TeamID}}, nil
	}
	if a.OAuth == nil || a.UserID == uuid.Nil {
		return nil, nil
	}
	rows, err := s.Q.ListTeamsForUser(ctx, a.UserID)
	if err != nil {
		return nil, err
	}
	out := make([]team, len(rows))
	for i, r := range rows {
		out[i] = team{ID: r.ID, Name: r.Name}
	}
	return out, nil
}

// withTeam names the team after an option when the caller works in
// several, so a model can tell two "Handbook"s apart.
func withTeam(name string, t team, many bool) string {
	if !many || t.Name == "" {
		return name
	}
	return name + " (" + t.Name + ")"
}

// KnowledgeBases are the knowledge bases of the caller's teams that it may
// retrieve from directly: an API key's (within its list), or a person's
// through OAuth. A knowledge base whose classification keeps programs to
// agents (DESIGN.md §4) isn't offered, as /retrieve refuses it.
func (s *Services) KnowledgeBases(ctx context.Context, a authz.Actor) ([]KnowledgeBase, error) {
	teams, err := s.teams(ctx, a)
	if err != nil {
		return nil, err
	}
	out := []KnowledgeBase{}
	for _, t := range teams {
		list, err := s.KnowledgeBaseService.List(ctx, a, t.ID.String())
		if err != nil {
			if _, refused := apperr.As(err); refused && a.Key == nil {
				continue // a membership that ended since the list was read
			}
			return nil, err
		}
		for _, kb := range list {
			if err := s.KnowledgeBaseService.CheckDirectRetrieve(ctx, a, kb); err != nil {
				if _, refused := apperr.As(err); refused {
					continue
				}
				return nil, err
			}
			out = append(out, KnowledgeBase{ID: kb.ID, Name: withTeam(kb.Name, t, len(teams) > 1), Description: kb.Description, TeamID: kb.TeamID})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// Agents are the published, active agents the caller may chat with: an API
// key's team's (within its list), or, for a person through OAuth, those of
// the teams they belong to (not other teams' agents open to everyone
// signed in, which a personal key can't reach either).
func (s *Services) Agents(ctx context.Context, a authz.Actor) ([]Agent, error) {
	cards, err := s.AgentService.Directory(ctx, a, agents.DirectoryFilter{})
	if err != nil {
		return nil, err
	}
	var member map[uuid.UUID]team
	if a.Key == nil {
		teams, err := s.teams(ctx, a)
		if err != nil {
			return nil, err
		}
		member = make(map[uuid.UUID]team, len(teams))
		for _, t := range teams {
			member[t.ID] = t
		}
	}
	out := make([]Agent, 0, len(cards))
	for _, c := range cards {
		name := c.Agent.Name
		if member != nil {
			t, ok := member[c.Agent.TeamID]
			if !ok {
				continue
			}
			name = withTeam(name, t, len(member) > 1)
		}
		out = append(out, Agent{ID: c.Agent.ID, Slug: c.Agent.Slug, Name: name, Description: c.Agent.Description, TeamID: c.Agent.TeamID})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out, nil
}

// Search retrieves as POST /v1/teams/{team}/kbs/{kbId}/retrieve does, with
// the query's usage recorded under the channel mcp.
func (s *Services) Search(ctx context.Context, a authz.Actor, kb uuid.UUID, query string, topK int) ([]kbs.Hit, error) {
	var teamID uuid.UUID
	switch {
	case a.Key != nil:
		teamID = a.Key.TeamID
	case a.OAuth != nil:
		row, err := s.Q.GetKB(ctx, kb)
		if err != nil {
			return nil, apperr.NotFound("kb_not_found", "Knowledge base not found")
		}
		teamID = row.TeamID
	default:
		return nil, apperr.NotFound("kb_not_found", "Knowledge base not found")
	}
	res, err := s.KnowledgeBaseService.Retrieve(ctx, a, teamID.String(), kb, kbs.Query{Text: query, TopK: topK, Channel: agents.ChannelMCP})
	return res.Hits, err
}

// Ask answers as POST /v1/agents/{team}/{agent}/chat does (not streamed),
// on the channel mcp.
func (s *Services) Ask(ctx context.Context, a authz.Actor, agent uuid.UUID, question string, conv *uuid.UUID) (agents.Answer, error) {
	return s.AgentService.Chat(ctx, a, agents.ChatRequest{AgentRef: agent.String(), Message: question, ConversationID: conv, Channel: agents.ChannelMCP}, nil)
}

// Audit writes a tool call's entry; it isn't a change, so it has no
// transaction of its own.
func (s *Services) Audit(ctx context.Context, e audit.Entry) error { return audit.Record(ctx, s.Q, e) }
