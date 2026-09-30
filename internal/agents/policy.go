package agents

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Policy rule names reported by agent_policy_violation (ADR-0006).
const (
	RuleTeamCeiling     = "team_ceiling"     // rule 1
	RuleModelCeiling    = "model_ceiling"    // rule 4 (chat model)
	RuleEmbedCeiling    = "embedding_model"  // rule 4 (a KB's embedding model)
	RuleAudienceCeiling = "audience_ceiling" // rule 5
)

// policy is the classification state of a configuration: the effective
// rank (max over the KBs' current ranks) and the checks of ADR-0006 rules
// 1, 4 and 5.
type policy struct {
	Rank           int32
	Classification string // the level at Rank (its key)
	// LevelName is that level's name ("Restricted"), for messages.
	LevelName   string
	MaxAudience string // that level's widest audience
	Model       *dbgen.ModelWithRankRow
	KBs         []dbgen.KBPolicyRowsRow
	Violations  []violation
}

type violation struct {
	Rule    string
	Field   string
	Message string
}

// evaluate computes the policy for a model, KBs and audience. A missing
// model is not a violation here (strict validation reports it).
func (s *Service) evaluate(ctx context.Context, q *dbgen.Queries, team dbgen.Team, modelID *uuid.UUID, kbIDs []uuid.UUID, audience string) (policy, error) {
	var p policy
	rows, err := q.KBPolicyRows(ctx, kbIDs)
	if err != nil {
		return p, err
	}
	p.KBs = rows
	for _, kb := range rows {
		p.Rank = max(p.Rank, kb.Rank)
	}
	level, err := q.ClassificationByRank(ctx, p.Rank)
	if err != nil && !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return p, err
	}
	p.Classification, p.MaxAudience, p.LevelName = level.Key, level.MaxAudience, level.Name
	if p.LevelName == "" {
		p.LevelName = level.Key
	}
	if p.MaxAudience == "" {
		p.MaxAudience = authz.AudienceTeam
	}
	teamLevel, err := q.GetClassification(ctx, team.MaxClassification)
	if err != nil {
		return p, err
	}
	if p.Rank > teamLevel.Rank {
		p.Violations = append(p.Violations, violation{RuleTeamCeiling, "kbs",
			fmt.Sprintf("The knowledge bases hold %s data, above what this team is approved for", p.LevelName)})
	}
	for _, kb := range rows {
		if kb.EmbedModelRank < kb.Rank {
			p.Violations = append(p.Violations, violation{RuleEmbedCeiling, "kbs",
				fmt.Sprintf("The embedding model of %q (%s) is not approved for its data", kb.Name, kb.EmbedModelName)})
		}
	}
	if modelID != nil {
		m, err := q.ModelWithRank(ctx, *modelID)
		if err != nil && !errors.Is(store.NotFound(err), store.ErrNotFound) {
			return p, err
		}
		if err == nil {
			p.Model = &m
			if m.MaxRank < p.Rank {
				p.Violations = append(p.Violations, violation{RuleModelCeiling, "chatModelId",
					fmt.Sprintf("The chat model %s is not approved for %s data", m.DisplayName, p.LevelName)})
			}
		}
	}
	if !authz.AudienceAllowed(audience, p.MaxAudience) {
		p.Violations = append(p.Violations, violation{RuleAudienceCeiling, "audience",
			fmt.Sprintf("The %s audience is not allowed for %s data", audienceLabel(audience), p.LevelName)})
	}
	return p, nil
}

// strictProblems runs publish validation (docs/phase3-agents.md §3).
func (s *Service) strictProblems(ctx context.Context, q *dbgen.Queries, team dbgen.Team, c Config, audience string) ([]Problem, policy, error) {
	var probs []Problem
	add := func(field, msg string) { probs = append(probs, Problem{Field: field, Problem: msg}) }
	if len(c.KBs) == 0 {
		add("kbs", "Choose at least one knowledge base")
	}
	// KBs must exist and belong to the team.
	var ids []uuid.UUID
	for i, ref := range c.KBs {
		kb, err := q.GetKB(ctx, ref.KBID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && kb.TeamID != team.ID) {
			add(fmt.Sprintf("kbs[%d].kbId", i), "This knowledge base does not exist in the team")
			continue
		} else if err != nil {
			return nil, policy{}, err
		}
		ids = append(ids, kb.ID)
	}
	p, err := s.evaluate(ctx, q, team, c.ChatModelID, ids, audience)
	if err != nil {
		return nil, p, err
	}
	probs = append(probs, chatModelProblems(c, p.Model)...)
	toolProbs, err := s.toolProblems(ctx, c, p)
	if err != nil {
		return nil, p, err
	}
	probs = append(probs, toolProbs...)
	if msg, err := s.moderationProblem(ctx, c, audience); err != nil {
		return nil, p, err
	} else if msg != "" {
		add("moderation", msg)
	}
	for _, v := range p.Violations {
		add(v.Field, v.Message)
	}
	return probs, p, nil
}

// chatModelProblems checks the configured chat model and what the
// configuration asks of it.
func chatModelProblems(c Config, m *dbgen.ModelWithRankRow) []Problem {
	var probs []Problem
	add := func(field, msg string) { probs = append(probs, Problem{Field: field, Problem: msg}) }
	switch {
	case c.ChatModelID == nil:
		add("chatModelId", "Choose a chat model")
	case m == nil:
		add("chatModelId", "The chat model no longer exists")
	case m.Kind != catalog.KindChat:
		add("chatModelId", "This model is not a chat model")
	case !m.Enabled || !m.ConnectionEnabled:
		add("chatModelId", "This chat model is disabled")
	default:
		if c.RetrievalMode == ModeTool && !m.SupportsTools {
			add("retrievalMode", "This chat model can't call tools. Choose “Search before every answer”, or another model")
		}
		if c.MaxOutputTokens != nil && m.MaxOutputTokens != nil && int32(*c.MaxOutputTokens) > *m.MaxOutputTokens {
			add("maxOutputTokens", fmt.Sprintf("The model allows at most %d output tokens", *m.MaxOutputTokens))
		}
	}
	return probs
}

// policyError is the query-time refusal (ADR-0006 rule 8).
func policyError(v violation) error {
	return &apperr.Error{Status: 409, Code: "agent_policy_violation",
		Message: "This agent can't answer right now because it no longer meets the data classification policy: " + v.Message + ". Ask the agent's team to review it.",
		Details: map[string]any{"rule": v.Rule}}
}
