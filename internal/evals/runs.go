// Runs (docs/evaluations.md §4): start (by hand or automatically), list,
// read with results, cancel, and compare two runs.

package evals

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Triggers of a run.
const (
	TriggerManual          = "manual"
	TriggerAgentPublished  = "agent_published"
	TriggerProfileSwitched = "profile_switched"
	TriggerNightly         = "nightly"
	// TriggerIndexPreview marks the runs a held migration starts to compare the live index with its candidate (preview.go): the platform
	// admin's comparison, left out of every team-facing list, trend and regression check.
	TriggerIndexPreview = "index_preview"
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
	// results per search summed over its knowledge bases (its rerankTopN
	// when it reranks).
	ResultsPerSearch int `json:"resultsPerSearch"`
	// Rerank is on when searches were reranked, off when the run (or the
	// agent) turned reranking off, "" without a rerank model
	// (docs/v0.4.0.md §3).
	Rerank string `json:"rerank,omitempty"`
	// Preview is set on an index preview's runs: which index the run retrieved from (preview.go).
	Preview *PreviewRef `json:"preview,omitempty"`
}

// Rerank states of a run (RunConfig.Rerank).
const (
	RerankOn  = "on"
	RerankOff = "off"
)

// Run is a run with its summary and configuration decoded.
type Run struct {
	dbgen.EvalRun
	Summary Summary
	Config  RunConfig
}

// decodeRun reads a stored run.
func decodeRun(r dbgen.EvalRun) Run {
	out := Run{EvalRun: r}
	_ = json.Unmarshal(r.Summary, &out.Summary)
	_ = json.Unmarshal(r.Config, &out.Config)
	if out.Config.KBs == nil {
		out.Config.KBs = []RunKB{}
	}
	return out
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
		out[i] = decodeRun(r)
	}
	return out, err
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
	return decodeRun(out), err
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
		scored[i] = Scored{Status: r.Status, Answer: d.Scores, Missing: d.Diagnosis.Missing}
		if r.Rank != nil {
			scored[i].Rank = int(*r.Rank)
		}
	}
	return Summarize(run.Kind, decodeRun(run).Config.ResultsPerSearch, scored), nil
}

// systemActor is who automatic runs act as.
var systemActor = authz.Actor{}

// auditSystem records an automatic run's start as the system.
func auditSystem(ctx context.Context, q *dbgen.Queries, run dbgen.EvalRun, set dbgen.EvalSet) error {
	return audit.Record(ctx, q, audit.Entry{ActorKind: audit.ActorSystem, TeamID: set.TeamID, Action: "evaluation.run_start",
		TargetType: "evaluation_run", TargetID: run.ID.String(),
		Metadata: map[string]any{"setId": set.ID, "setName": set.Name, "kind": run.Kind, "trigger": run.Trigger, "questions": run.Total}})
}
