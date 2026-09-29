// Evaluation runs (docs/evaluations.md §2-§3): an agent's retrieval for a
// question, the way its search runs, and an answer the way the Test panel
// asks, without a conversation. internal/evals checks access when a run
// starts; these run as the person who started it, or the system for
// automatic runs.

package agents

import (
	"context"
	"encoding/json"
	"errors"
	"math"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// EvalTarget is the agent configuration an evaluation tests: its draft or
// its published version.
type EvalTarget struct {
	Agent dbgen.Agent
	Team  dbgen.Team
	// Version is the published version, nil for the draft.
	Version *dbgen.AgentVersion
	Config  Config
}

// VersionNumber is the published version tested (nil: the draft).
func (t EvalTarget) VersionNumber() *int32 {
	if t.Version == nil {
		return nil
	}
	v := t.Version.Version
	return &v
}

var errNoPublished = errors.New("the agent has no published version")

// ErrNoPublishedVersion reports an evaluation of the published version of an
// agent that was never published.
func ErrNoPublishedVersion(err error) bool { return errors.Is(err, errNoPublished) }

// LoadEvalTarget loads a live agent's draft (published false) or its
// published version.
func (s *Service) LoadEvalTarget(ctx context.Context, agentID uuid.UUID, published bool) (EvalTarget, error) {
	var t EvalTarget
	ag, err := s.q.GetAgent(ctx, agentID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && ag.DeletedAt != nil) {
		return t, errNoAgent
	} else if err != nil {
		return t, err
	}
	team, err := s.q.GetTeamByID(ctx, ag.TeamID)
	if err != nil {
		return t, err
	}
	t.Agent, t.Team, t.Config = ag, team, DecodeConfig(ag.Draft)
	if !published {
		return t, nil
	}
	if !ag.PublishedVersionID.Valid {
		return t, errNoPublished
	}
	v, err := s.q.GetAgentVersion(ctx, ag.PublishedVersionID.UUID)
	if err != nil {
		return t, err
	}
	t.Version, t.Config = &v, DecodeConfig(v.Config)
	return t, nil
}

// EvalRetrieve searches the agent's knowledge bases for a question as its
// search does (each KB with the agent's results per search, its filters and
// minimum similarity, fused and trimmed to its context budget), without
// judging. With depth > 0 each KB returns depth results and the fused list
// is cut at depth, without the budget: an evaluation's search for an
// expected document's rank beyond the agent's k. It counts as one query
// under the team's query limits and is recorded as query usage with meta
// (source: evaluation).
func (s *Service) EvalRetrieve(ctx context.Context, a authz.Actor, t EvalTarget, question string, depth int, meta map[string]any) ([]kbs.Hit, error) {
	if s.Limits != nil {
		if err := s.Limits.CheckQuery(ctx, t.Team.ID, a); err != nil {
			return nil, err
		}
	}
	resolved, err := s.KBs.ResolveKBs(ctx, t.Config.KBIDs())
	if err != nil {
		return nil, err
	}
	cfg := t.Config
	if depth > 0 {
		cfg.KBs = make([]KBRef, len(t.Config.KBs))
		for i, ref := range t.Config.KBs {
			ref.TopK = &depth
			cfg.KBs[i] = ref
		}
		cfg.ContextTokenBudget = math.MaxInt32
	}
	r := newRetriever(s.KBs, resolved, cfg, llm.UserTag(t.Team.Slug, t.Agent.Slug))
	found, _, err := r.search(ctx, question, depth)
	if err != nil {
		return nil, err
	}
	hits := make([]kbs.Hit, len(found))
	for i, h := range found {
		hits[i] = h.Hit
	}
	base := map[string]any{"channel": ChannelTest, "agentVersion": t.VersionNumber(), "hits": len(hits)}
	usage := []dbgen.InsertUsageParams{{Kind: limits.UsageQuery, Quantity: 1}}
	for m, n := range r.embedTokens {
		usage = append(usage, dbgen.InsertUsageParams{Kind: "embed_tokens", Quantity: int64(n), ModelID: uuid.NullUUID{UUID: m, Valid: true}})
	}
	raw, _ := json.Marshal(base)
	for _, u := range usage {
		u.TeamID, u.AgentID, u.UserID = uuid.NullUUID{UUID: t.Team.ID, Valid: true}, uuid.NullUUID{UUID: t.Agent.ID, Valid: true}, nullUser(a)
		u.Metadata = kbs.TagMetadata(raw, meta)
		if err := s.q.InsertUsage(ctx, u); err != nil {
			return nil, err
		}
	}
	return hits, nil
}

// EvalAnswer asks the agent a question as the Test panel does (channel test,
// no conversation), with the draft or the published version: the same
// limits (chat and query), moderation and citation checks as a chat, and
// usage tagged with meta. checks is the SystemOne citation check of the
// answer (nil when off).
func (s *Service) EvalAnswer(ctx context.Context, a authz.Actor, t EvalTarget, question string, meta map[string]any) (ans Answer, checks *CitationsRecord, err error) {
	if question, err = checkMessage(question); err != nil {
		return Answer{}, nil, err
	}
	grant := t.Config.Audience
	var pol policy
	if t.Version == nil {
		var probs []Problem
		if probs, pol, err = s.strictProblems(ctx, s.q, t.Team, t.Config, grant); err != nil {
			return Answer{}, nil, err
		}
		if len(probs) > 0 {
			return Answer{}, nil, Invalid(probs)
		}
	} else {
		grant = authz.AudienceTeam
		if g, err := s.q.GetAudienceGrant(ctx, t.Agent.ID); err == nil {
			grant = g.PrincipalType
		}
		if pol, err = s.evaluate(ctx, s.q, t.Team, &t.Version.ChatModelID, t.Config.KBIDs(), grant); err != nil {
			return Answer{}, nil, err
		}
		if len(pol.Violations) > 0 {
			return Answer{}, nil, policyError(pol.Violations[0])
		}
	}
	ru := &run{s: s, a: a, team: t.Team, agent: t.Agent, version: t.Version, cfg: t.Config, grant: grant, rank: pol.Rank,
		channel: ChannelTest, question: question, usageMeta: meta}
	ans, err = ru.execute(ctx, nil)
	return ans, ru.citeRec, err
}

// usageMetadata is the metadata of the answer's usage events: the channel,
// the version, anything the caller tags them with (evaluations) and extra.
func (ru *run) usageMetadata(extra map[string]any) json.RawMessage {
	m := map[string]any{"channel": ru.channel, "agentVersion": ru.versionNum()}
	for k, v := range extra {
		m[k] = v
	}
	raw, _ := json.Marshal(m)
	return kbs.TagMetadata(raw, ru.usageMeta)
}
