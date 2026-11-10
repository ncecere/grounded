package evals

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// StartInput starts a run: its kind and, for agent sets, the version.
// NoRerank runs without the platform's rerank model, to compare.
type StartInput struct {
	Kind     string
	Version  string
	NoRerank bool
}

// target is what a run checks: a knowledge base, or an agent's draft or
// published version.
type target struct {
	kb    *kbs.KB
	agent *agents.EvalTarget
	cfg   RunConfig
	// depth is the results a retrieval check's search asks for (0: the
	// configuration's own).
	depth int
}

// loadTarget resolves a set's knowledge base or agent configuration, with
// reranking unless noRerank.
func (s *Service) loadTarget(ctx context.Context, set dbgen.EvalSet, version string, noRerank bool) (target, error) {
	var t target
	var kbIDs []uuid.UUID
	topK := map[uuid.UUID]int{}
	if set.KBID.Valid {
		kbIDs = []uuid.UUID{set.KBID.UUID}
	} else {
		at, err := s.Agents.LoadEvalTarget(ctx, set.AgentID.UUID, version == VersionPublished)
		if agents.ErrNoPublishedVersion(err) {
			return t, apperr.Conflict("not_published", "This agent has no published version yet: test the draft instead")
		} else if err != nil {
			return t, err
		}
		t.agent = &at
		t.cfg = RunConfig{Version: version, AgentVersion: at.VersionNumber(), RetrievalMode: at.Config.RetrievalMode, ChatModelID: at.Config.ChatModelID}
		kbIDs = at.Config.KBIDs()
		for _, ref := range at.Config.KBs {
			topK[ref.KBID] = -1
			if ref.TopK != nil {
				topK[ref.KBID] = *ref.TopK
			}
		}
	}
	resolved, err := s.KBs.ResolveKBs(ctx, kbIDs)
	if err != nil {
		return t, err
	}
	if len(resolved) == 0 {
		return t, apperr.Conflict("no_knowledge_base", "There is no knowledge base to search")
	}
	t.cfg.KBs = []RunKB{}
	for i, kb := range resolved {
		k := int(kb.TopK)
		if n, ok := topK[kb.ID]; ok && n > 0 {
			k = n
		}
		name := ""
		if p, err := s.q.GetEmbeddingProfile(ctx, kb.EmbeddingProfileID); err == nil {
			name = p.EmbeddingProfile.Name
		}
		t.cfg.KBs = append(t.cfg.KBs, RunKB{ID: kb.ID, Name: kb.Name, ProfileID: kb.EmbeddingProfileID, Profile: name, TopK: k})
		t.cfg.ResultsPerSearch += k
		if set.KBID.Valid {
			t.kb = &resolved[i]
		}
	}
	s.planRerank(ctx, &t, noRerank)
	return t, nil
}

// planRerank records whether the run reranks: on when the platform has a
// rerank model and neither the run nor the agent turned it off. An agent
// that reranks keeps its rerankTopN per search; a run that turns its
// reranking off searches for as many results in the fusion order, so runs
// with and without reranking are scored at the same k.
func (s *Service) planRerank(ctx context.Context, t *target, noRerank bool) {
	if s.KBs.RerankPlan(ctx) == nil {
		return
	}
	t.cfg.Rerank = RerankOn
	if noRerank || (t.agent != nil && !t.agent.Config.Rerank) {
		t.cfg.Rerank = RerankOff
	}
	if t.agent == nil {
		return
	}
	reranks := t.agent.Config.Rerank // the agent's own setting
	t.agent.Config.Rerank = t.cfg.Rerank == RerankOn
	if reranks {
		t.cfg.ResultsPerSearch = t.agent.Config.RerankTopN
		if !t.agent.Config.Rerank {
			t.depth = t.agent.Config.RerankTopN
		}
	}
}

func checkStart(set dbgen.EvalSet, in *StartInput) error {
	if in.Kind == "" {
		in.Kind = KindRetrieval
	}
	if in.Kind != KindRetrieval && in.Kind != KindAnswer {
		return apperr.Invalid("invalid_kind", "The kind must be retrieval or answer")
	}
	if !set.AgentID.Valid {
		if in.Kind == KindAnswer {
			return apperr.Invalid("invalid_kind", "Full-answer checks need an agent: this set belongs to a knowledge base")
		}
		in.Version = ""
		return nil
	}
	if in.Version == "" {
		in.Version = VersionDraft
	}
	if in.Version != VersionDraft && in.Version != VersionPublished {
		return apperr.Invalid("invalid_version", "The version must be draft or published")
	}
	return nil
}

// StartRun starts a run of a set by hand (audited). One run of a set at a
// time.
func (s *Service) StartRun(ctx context.Context, a authz.Actor, teamRef string, setID uuid.UUID, in StartInput) (Run, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return Run{}, err
	}
	set, err := loadSet(ctx, s.q, acc.Team.ID, setID, false)
	if err != nil {
		return Run{}, err
	}
	if err := checkStart(set, &in); err != nil {
		return Run{}, err
	}
	t, err := s.loadTarget(ctx, set, in.Version, in.NoRerank)
	if err != nil {
		return Run{}, err
	}
	var run dbgen.EvalRun
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if set, err = loadSet(ctx, q, acc.Team.ID, setID, true); err != nil {
			return err
		}
		if run, err = s.insertRun(ctx, q, tx, set, in.Kind, TriggerManual, a.NullUser(), t.cfg); err != nil {
			return err
		}
		e := a.Audit("evaluation.run_start", "evaluation_run", run.ID.String())
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"setId": set.ID, "setName": set.Name, "kind": in.Kind, "version": in.Version,
			"questions": run.Total, "rerank": t.cfg.Rerank})
		return audited(ctx, q, e, acc.Team.ID)
	})
	return DecodeRun(run), err
}

var (
	errRunning     = apperr.Conflict("run_in_progress", "A run of this set is in progress. Wait for it to finish or cancel it.")
	errNoQuestions = apperr.Conflict("no_questions", "Add questions to the set before running it")
)

// insertRun records a queued run (the set is locked) and enqueues its job.
func (s *Service) insertRun(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, set dbgen.EvalSet, kind, trigger string, by uuid.NullUUID, cfg RunConfig) (dbgen.EvalRun, error) {
	if _, err := q.ActiveEvalRun(ctx, set.ID); err == nil {
		return dbgen.EvalRun{}, errRunning
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return dbgen.EvalRun{}, err
	}
	n, err := q.CountEvalCases(ctx, set.ID)
	if err != nil {
		return dbgen.EvalRun{}, err
	}
	if n == 0 {
		return dbgen.EvalRun{}, errNoQuestions
	}
	raw, _ := json.Marshal(cfg)
	run, err := q.InsertEvalRun(ctx, dbgen.InsertEvalRunParams{SetID: set.ID, TeamID: set.TeamID, Kind: kind, Trigger: trigger,
		StartedBy: by, Config: raw, Total: int32(n)})
	if err != nil {
		return run, err
	}
	if s.Jobs != nil {
		_, err = s.Jobs.InsertTx(ctx, tx, RunArgs{RunID: run.ID}, nil)
	}
	return run, err
}
