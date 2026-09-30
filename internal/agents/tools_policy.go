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
		probs = append(probs, Problem{Field: "tools", Problem: "This chat model does not support tools; choose another model or remove the tools"})
	}
	if s.MCP == nil {
		return append(probs, Problem{Field: "tools", Problem: "MCP tools are not available on this install"}), nil
	}
	refs, err := s.MCP.ToolsByID(ctx, c.Tools)
	if err != nil {
		return nil, err
	}
	for i, id := range c.Tools {
		if msg := toolProblem(refs, id, p); msg != "" {
			probs = append(probs, Problem{Field: "tools[" + strconv.Itoa(i) + "]", Problem: msg})
		}
	}
	return probs, nil
}

// toolProblem is why one tool can't be used, or "".
func toolProblem(refs map[uuid.UUID]mcpclient.ToolRef, id uuid.UUID, p policy) string {
	ref, ok := refs[id]
	switch {
	case !ok:
		return "This tool no longer exists"
	case ref.GoneAt != nil:
		return fmt.Sprintf("%s no longer lists the tool %s", ref.ServerName, ref.Name)
	case !ref.Approved:
		return fmt.Sprintf("The tool %s is not approved by the platform admins", ref.Name)
	case !ref.ServerEnabled:
		return fmt.Sprintf("The MCP server %s is turned off", ref.ServerName)
	case ref.ServerMaxRank < p.Rank:
		return fmt.Sprintf("The MCP server %s is not approved for %s data", ref.ServerName, p.Classification)
	}
	return ""
}
