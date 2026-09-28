// Runs (docs/evaluations.md §4): start (by hand or automatically), list,
// read with results, cancel, and compare two runs.

package evals

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Triggers of a run.
const (
	TriggerManual          = "manual"
	TriggerAgentPublished  = "agent_published"
	TriggerProfileSwitched = "profile_switched"
	TriggerNightly         = "nightly"
)

// Agent versions a run can test.
const (
	VersionDraft     = "draft"
	VersionPublished = "published"
)

// RunKB is one knowledge base a run searched, as it was configured.
type RunKB struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	ProfileID uuid.UUID `json:"profileId"`
	Profile   string    `json:"profile"`
	// TopK is the results per search from this knowledge base.
	TopK int `json:"topK"`
}

// RunConfig is what a run tested, for the markers of the score chart.
type RunConfig struct {
	// Version is draft or published (agent sets); AgentVersion the
	// published version's number.
	Version       string     `json:"version,omitempty"`
	AgentVersion  *int32     `json:"agentVersion,omitempty"`
	RetrievalMode string     `json:"retrievalMode,omitempty"`
	ChatModelID   *uuid.UUID `json:"chatModelId,omitempty"`
	KBs           []RunKB    `json:"kbs"`
	// ResultsPerSearch is k: the knowledge base's top-k, or the agent's
	// results per search summed over its knowledge bases.
	ResultsPerSearch int `json:"resultsPerSearch"`
}

// Run is a run with its summary and configuration decoded.
type Run struct {
	dbgen.EvalRun
	Summary Summary
	Config  RunConfig
}

// DecodeRun reads a stored run.
func DecodeRun(r dbgen.EvalRun) Run {
	out := Run{EvalRun: r}
	_ = json.Unmarshal(r.Summary, &out.Summary)
	_ = json.Unmarshal(r.Config, &out.Config)
	if out.Config.KBs == nil {
		out.Config.KBs = []RunKB{}
	}
	return out
}

// StartInput starts a run: its kind and, for agent sets, the version.
type StartInput struct {
	Kind    string
	Version string
}

// target is what a run checks: a knowledge base, or an agent's draft or
// published version.
type target struct {
	kb    *kbs.KB
	agent *agents.EvalTarget
	cfg   RunConfig
}

// loadTarget resolves a set's knowledge base or agent configuration.
func (s *Service) loadTarget(ctx context.Context, set dbgen.EvalSet, version string) (target, error) {
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
	return t, nil
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
	t, err := s.loadTarget(ctx, set, in.Version)
	if err != nil {
		return Run{}, err
	}
	var run dbgen.EvalRun
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if set, err = loadSet(ctx, q, acc.Team.ID, setID, true); err != nil {
			return err
		}
		if run, err = s.insertRun(ctx, q, tx, set, in.Kind, TriggerManual, nullUser(a), t.cfg); err != nil {
			return err
		}
		e := a.Audit("evaluation.run_start", "evaluation_run", run.ID.String())
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"setId": set.ID, "setName": set.Name, "kind": in.Kind, "version": in.Version,
			"questions": run.Total})
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

// Runs lists a set's latest runs, newest first.
func (s *Service) Runs(ctx context.Context, a authz.Actor, teamRef string, setID uuid.UUID, limit int) ([]Run, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	if _, err := loadSet(ctx, s.q, acc.Team.ID, setID, false); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.q.ListEvalRuns(ctx, dbgen.ListEvalRunsParams{SetID: setID, Lim: int32(limit)})
	out := make([]Run, len(rows))
	for i, r := range rows {
		out[i] = DecodeRun(r)
	}
	return out, err
}

// Result is a question's result in a run, decoded.
type Result struct {
	dbgen.EvalResult
	Hits   []HitView
	Scores *AnswerScores
}

// HitView is a document that came back (or was cited), for the editor.
type HitView struct {
	Rank       int       `json:"rank"`
	DocumentID uuid.UUID `json:"documentId"`
	Title      string    `json:"title"`
	URL        string    `json:"url,omitempty"`
	Filename   string    `json:"filename,omitempty"`
	// Expected: the document is one of the question's expected documents.
	Expected bool `json:"expected"`
}

// DecodeResult reads a stored result.
func DecodeResult(r dbgen.EvalResult) Result {
	out := Result{EvalResult: r, Hits: []HitView{}}
	_ = json.Unmarshal(r.Hits, &out.Hits)
	if len(r.Scores) > 2 {
		var sc AnswerScores
		if json.Unmarshal(r.Scores, &sc) == nil {
			out.Scores = &sc
		}
	}
	return out
}

// Run returns a run with its results.
func (s *Service) Run(ctx context.Context, a authz.Actor, teamRef string, setID, runID uuid.UUID) (Run, []Result, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return Run{}, nil, err
	}
	if _, err := loadSet(ctx, s.q, acc.Team.ID, setID, false); err != nil {
		return Run{}, nil, err
	}
	run, err := s.q.GetEvalRun(ctx, dbgen.GetEvalRunParams{ID: runID, SetID: setID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Run{}, nil, errNoRun
	} else if err != nil {
		return Run{}, nil, err
	}
	rows, err := s.q.ListEvalResults(ctx, runID)
	out := make([]Result, len(rows))
	for i, r := range rows {
		out[i] = DecodeResult(r)
	}
	return DecodeRun(run), out, err
}

// CancelRun stops a queued or running run; the results so far are kept and
// summarised (audited).
func (s *Service) CancelRun(ctx context.Context, a authz.Actor, teamRef string, setID, runID uuid.UUID) (Run, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return Run{}, err
	}
	if _, err := loadSet(ctx, s.q, acc.Team.ID, setID, false); err != nil {
		return Run{}, err
	}
	var out dbgen.EvalRun
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockEvalRun(ctx, runID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && cur.SetID != setID) {
			return errNoRun
		} else if err != nil {
			return err
		}
		if cur.Status != "queued" && cur.Status != "running" {
			return apperr.Conflict("run_not_running", "This run has already ended")
		}
		sum, err := summarize(ctx, q, cur)
		if err != nil {
			return err
		}
		raw, _ := json.Marshal(sum)
		if out, err = q.FinishEvalRun(ctx, dbgen.FinishEvalRunParams{ID: runID, Status: "cancelled", Summary: raw}); err != nil {
			return err
		}
		e := a.Audit("evaluation.run_cancel", "evaluation_run", runID.String())
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"setId": setID, "done": out.Done, "questions": out.Total})
		return audited(ctx, q, e, acc.Team.ID)
	})
	return DecodeRun(out), err
}

// summarize computes a run's summary from its stored results.
func summarize(ctx context.Context, q *dbgen.Queries, run dbgen.EvalRun) (Summary, error) {
	rows, err := q.ListEvalResults(ctx, run.ID)
	if err != nil {
		return Summary{}, err
	}
	scored := make([]Scored, len(rows))
	for i, r := range rows {
		d := DecodeResult(r)
		scored[i] = Scored{Status: r.Status, Answer: d.Scores}
		if r.Rank != nil {
			scored[i].Rank = int(*r.Rank)
		}
	}
	return Summarize(run.Kind, DecodeRun(run).Config.ResultsPerSearch, scored), nil
}

// Comparison is one question in two runs.
type Comparison struct {
	CaseID   uuid.NullUUID
	Question string
	A, B     *Result
	Change   string
}

// Compare lists how each question changed from run a to run b.
func (s *Service) Compare(ctx context.Context, a authz.Actor, teamRef string, setID, runA, runB uuid.UUID) (Run, Run, []Comparison, error) {
	ra, resA, err := s.Run(ctx, a, teamRef, setID, runA)
	if err != nil {
		return Run{}, Run{}, nil, err
	}
	rb, resB, err := s.Run(ctx, a, teamRef, setID, runB)
	if err != nil {
		return Run{}, Run{}, nil, err
	}
	return ra, rb, compareResults(resA, resB), nil
}

// compareResults pairs the results of two runs by question.
func compareResults(resA, resB []Result) []Comparison {
	var out []Comparison
	byCase := map[uuid.UUID]int{}
	add := func(r Result, first bool) {
		if r.CaseID.Valid {
			if i, ok := byCase[r.CaseID.UUID]; ok {
				out[i].B = &r
				return
			}
			byCase[r.CaseID.UUID] = len(out)
		}
		c := Comparison{CaseID: r.CaseID, Question: r.Question}
		if first {
			c.A = &r
		} else {
			c.B = &r
		}
		out = append(out, c)
	}
	for _, r := range resA {
		add(r, true)
	}
	for _, r := range resB {
		add(r, false)
	}
	for i := range out {
		out[i].Change = Compare(outcome(out[i].A), outcome(out[i].B))
	}
	return out
}

func outcome(r *Result) *Outcome {
	if r == nil {
		return nil
	}
	o := &Outcome{Status: r.Status}
	if r.Rank != nil {
		o.Rank = int(*r.Rank)
	}
	return o
}

// systemActor is who automatic runs act as.
var systemActor = authz.Actor{}

// auditSystem records an automatic run's start as the system.
func auditSystem(ctx context.Context, q *dbgen.Queries, run dbgen.EvalRun, set dbgen.EvalSet) error {
	return audit.Record(ctx, q, audit.Entry{ActorKind: audit.ActorSystem, TeamID: set.TeamID, Action: "evaluation.run_start",
		TargetType: "evaluation_run", TargetID: run.ID.String(),
		Metadata: map[string]any{"setId": set.ID, "setName": set.Name, "kind": run.Kind, "trigger": run.Trigger, "questions": run.Total}})
}
