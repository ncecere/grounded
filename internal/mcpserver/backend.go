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
}

// Agent is an agent the caller may ask.
type Agent struct {
	ID                      uuid.UUID
	Slug, Name, Description string
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

// teamRef is the team the actor works in: an API key's team.
func teamRef(a authz.Actor) (string, bool) {
	if a.Key == nil {
		return "", false
	}
	return a.Key.TeamID.String(), true
}

// KnowledgeBases are the key's knowledge bases that it may retrieve from
// directly: a knowledge base whose classification keeps API keys to agents
// (DESIGN.md §4) isn't offered, as /retrieve refuses it.
func (s *Services) KnowledgeBases(ctx context.Context, a authz.Actor) ([]KnowledgeBase, error) {
	team, ok := teamRef(a)
	if !ok {
		return nil, nil
	}
	list, err := s.KnowledgeBaseService.List(ctx, a, team)
	if err != nil {
		return nil, err
	}
	out := make([]KnowledgeBase, 0, len(list))
	for _, kb := range list {
		if err := s.KnowledgeBaseService.CheckDirectRetrieve(ctx, a, kb); err != nil {
			if _, refused := apperr.As(err); refused {
				continue
			}
			return nil, err
		}
		out = append(out, KnowledgeBase{ID: kb.ID, Name: kb.Name, Description: kb.Description})
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// Agents are the published, active agents the key may chat with.
func (s *Services) Agents(ctx context.Context, a authz.Actor) ([]Agent, error) {
	cards, err := s.AgentService.Directory(ctx, a, agents.DirectoryFilter{})
	if err != nil {
		return nil, err
	}
	out := make([]Agent, 0, len(cards))
	for _, c := range cards {
		out = append(out, Agent{ID: c.Agent.ID, Slug: c.Agent.Slug, Name: c.Agent.Name, Description: c.Agent.Description})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out, nil
}

// Search retrieves as POST /v1/teams/{team}/kbs/{kbId}/retrieve does, with
// the query's usage recorded under the channel mcp.
func (s *Services) Search(ctx context.Context, a authz.Actor, kb uuid.UUID, query string, topK int) ([]kbs.Hit, error) {
	team, ok := teamRef(a)
	if !ok {
		return nil, apperr.NotFound("kb_not_found", "Knowledge base not found")
	}
	res, err := s.KnowledgeBaseService.Retrieve(ctx, a, team, kb, kbs.Query{Text: query, TopK: topK, Channel: agents.ChannelMCP})
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
