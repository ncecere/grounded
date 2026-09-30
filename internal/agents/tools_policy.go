package agents

import (
	"context"
	"fmt"
	"strconv"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/mcpclient"
)

// toolProblems checks the configured MCP tools for publishing
// (docs/mcp-client.md): each exists, is approved and still listed, its
// server is enabled and approved for the agent's data (the classification
// ceiling, as for the chat model), and the chat model can call tools.
func (s *Service) toolProblems(ctx context.Context, c Config, p policy) ([]Problem, error) {
	if len(c.Tools) == 0 {
		return nil, nil
	}
	var probs []Problem
	if p.Model != nil && !p.Model.SupportsTools {
		probs = append(probs, Problem{Field: "tools", Problem: "This chat model can't call tools. Choose a model that can, or remove the tools"})
	}
	if s.MCP == nil {
		return append(probs, Problem{Field: "tools", Problem: "Tools are not available on this install"}), nil
	}
	refs, err := s.MCP.ToolsByID(ctx, c.Tools)
	if err != nil {
		return nil, err
	}
	names := map[string]string{} // classification level names by key
	if levels, err := s.q.ListClassificationLevels(ctx); err == nil {
		for _, l := range levels {
			names[l.Key] = l.Name
		}
	}
	levelName := func(key string) string {
		if n := names[key]; n != "" {
			return n
		}
		return key
	}
	for i, id := range c.Tools {
		if msg := toolProblem(refs, id, p, levelName); msg != "" {
			probs = append(probs, Problem{Field: "tools[" + strconv.Itoa(i) + "]", Problem: msg})
		}
	}
	return probs, nil
}

// toolProblem is why one tool can't be used, or "".
func toolProblem(refs map[uuid.UUID]mcpclient.ToolRef, id uuid.UUID, p policy, levelName func(string) string) string {
	ref, ok := refs[id]
	switch {
	case !ok:
		return "This tool no longer exists"
	case ref.GoneAt != nil:
		return fmt.Sprintf("%s no longer offers %s", ref.ServerName, toolLabel(ref))
	case !ref.Approved:
		return fmt.Sprintf("%s (from %s) is not approved by the platform admins", toolLabel(ref), ref.ServerName)
	case !ref.ServerEnabled:
		return fmt.Sprintf("%s is turned off, so %s can't be used", ref.ServerName, toolLabel(ref))
	case ref.ServerMaxRank < p.Rank:
		return fmt.Sprintf("%s may receive data up to %s, and this agent's knowledge bases hold %s data", ref.ServerName,
			levelName(ref.ServerMaxClassification), p.LevelName)
	}
	return ""
}
