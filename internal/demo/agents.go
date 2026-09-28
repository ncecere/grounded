package demo

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
)

// createAgent creates a demo agent's draft: the Go instructions, the demo
// KB, the chat model and the audience it is published to.
func (s *seeder) createAgent(ctx context.Context, spec agentSpec, kb, chat uuid.UUID) (uuid.UUID, error) {
	cfg, _ := json.Marshal(map[string]any{
		"instructions": instructions,
		"chatModelId":  chat,
		"kbs":          []map[string]any{{"kbId": kb}},
		"audience":     spec.Audience,
		"citationMode": agents.CitationSnippetLink,
	})
	name, slug, desc, welcome, starters := spec.Name, spec.Slug, spec.Description, spec.Welcome, spec.Starters
	v, err := s.svc.Agents.Create(ctx, s.actor, TeamSlug, agents.CreateInput{
		Profile: agents.Profile{Name: &name, Slug: &slug, Description: &desc, WelcomeMessage: &welcome, StarterQuestions: &starters},
		Config:  cfg,
	})
	if err != nil {
		return uuid.Nil, err
	}
	s.created("agent %q", spec.Name)
	return v.Agent.ID, nil
}
