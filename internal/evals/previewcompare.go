// The comparison of an index preview (#18, T4): for each evaluation set of the knowledge base, the live index's retrieval run beside the
// candidate's, from the latest comparison that finished. The platform admin sees the numbers (recall, MRR, first places, how many questions
// got better, worse or stayed): evaluation sets are the team's, so the questions themselves go only to the team's editors.

package evals

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// PreviewSide is one side of a set's comparison: a retrieval run of the live index or of the candidate's.
type PreviewSide struct {
	RunID     uuid.UUID
	Status    string
	CreatedAt time.Time
	Summary   Summary
	// FirstPlace counts the questions whose expected document ranked first.
	FirstPlace int
}

// PreviewItem is one question in both runs (the team's view only).
type PreviewItem struct {
	CaseID                      uuid.NullUUID
	Question                    string
	LiveStatus, CandidateStatus string // "" when the question was not in that run
	LiveRank, CandidateRank     *int32
	Change                      string // better, worse, same, only_a or only_b (Compare)
}

// PreviewSet is one evaluation set's comparison. Live and Candidate are nil when no run exists; the counts and Items are filled only when
// both runs completed.
type PreviewSet struct {
	SetID     uuid.UUID
	Name      string
	Questions int
	Live      *PreviewSide
	Candidate *PreviewSide
	Better    int
	Worse     int
	Same      int
	// Unscored are the questions checked in one run only (added or removed between the two) or without a result.
	Unscored int
	Items    []PreviewItem
}

// PreviewTotals sums the sets: the live and candidate indexes scored over every question that completed on both.
type PreviewTotals struct {
	Sets, Questions      int
	Live, Candidate      Summary
	LiveFirst, CandFirst int
	Better, Worse, Same  int
}

// PreviewComparison is a migration's comparison.
type PreviewComparison struct {
	MigrationID     uuid.UUID
	MigrationStatus string
	// Running is true while a comparison of this migration is queued or running (the numbers shown are the latest that finished).
	Running bool
	Sets    []PreviewSet
	Totals  PreviewTotals
}

// PreviewForAdmin is the comparison of a migration as the platform admin sees it: numbers only, no question text.
func (s *Service) PreviewForAdmin(ctx context.Context, migrationID uuid.UUID) (PreviewComparison, error) {
	rows, err := s.q.ListProfileMigrationViews(ctx, dbgen.ListProfileMigrationViewsParams{ID: uuid.NullUUID{UUID: migrationID, Valid: true}, MaxRows: 1})
	if err != nil {
		return PreviewComparison{}, err
	}
	if len(rows) == 0 {
		return PreviewComparison{}, errNotFound
	}
	return s.previewComparison(ctx, rows[0].ProfileMigration.ID, rows[0].ProfileMigration.Status, false)
}

// PreviewForTeam is the comparison of the preview of a team's knowledge base, with the questions, for the team's editors, admins and owners
// (the same access as the evaluation sets themselves). It is nil when the knowledge base has no preview that is building or waiting.
func (s *Service) PreviewForTeam(ctx context.Context, a authz.Actor, teamRef string, kbID uuid.UUID) (*PreviewComparison, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	kb, err := s.q.GetKB(ctx, kbID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && kb.TeamID != acc.Team.ID) {
		return nil, errNotFound
	} else if err != nil {
		return nil, err
	}
	m, err := s.q.BuildingMigrationForKB(ctx, kbID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	out, err := s.previewComparison(ctx, m.ID, m.Status, true)
	return &out, err
}

func (s *Service) previewComparison(ctx context.Context, migrationID uuid.UUID, status string, items bool) (PreviewComparison, error) {
	out := PreviewComparison{MigrationID: migrationID, MigrationStatus: status, Sets: []PreviewSet{}}
	runs, err := s.q.PreviewRunsForMigration(ctx, migrationID.String())
	if err != nil {
		return out, err
	}
	seen := map[uuid.UUID]bool{}
	var order []uuid.UUID
	for _, r := range runs {
		if r.Status == "queued" || r.Status == "running" {
			out.Running = true
		}
		if ref := DecodeRun(r).Config.Preview; ref != nil && !seen[r.SetID] {
			seen[r.SetID] = true
			order = append(order, r.SetID)
		}
	}
	// Per set: the newest candidate run whose live run, made in the same batch (the same transaction, so the same time), completed too;
	// else the newest pair, which is still going or failed.
	var liveAll, candAll []Scored
	for _, setID := range order {
		set, err := s.q.GetEvalSetByID(ctx, setID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		} else if err != nil {
			return out, err
		}
		live, cand := pickPair(runs, setID)
		ps := PreviewSet{SetID: set.ID, Name: set.Name}
		if live != nil {
			ps.Live = &PreviewSide{RunID: live.ID, Status: live.Status, CreatedAt: live.CreatedAt}
		}
		if cand != nil {
			ps.Candidate = &PreviewSide{RunID: cand.ID, Status: cand.Status, CreatedAt: cand.CreatedAt}
		}
		if live != nil && cand != nil && live.Status == "completed" && cand.Status == "completed" {
			if err := s.fillPreviewSet(ctx, &ps, *live, *cand, items, &liveAll, &candAll, &out.Totals); err != nil {
				return out, err
			}
		}
		out.Sets = append(out.Sets, ps)
	}
	k := 0
	if len(out.Sets) > 0 && out.Sets[0].Live != nil {
		k = out.Sets[0].Live.Summary.K
	}
	out.Totals.Sets = len(out.Sets)
	out.Totals.Live, out.Totals.Candidate = Summarize(KindRetrieval, k, liveAll), Summarize(KindRetrieval, k, candAll)
	return out, nil
}

// pickPair chooses a set's runs to show: see previewComparison.
func pickPair(runs []dbgen.EvalRun, setID uuid.UUID) (live, cand *dbgen.EvalRun) {
	var newest *[2]*dbgen.EvalRun
	for i := range runs { // newest first
		c := runs[i]
		ref := DecodeRun(c).Config.Preview
		if c.SetID != setID || ref == nil || ref.Side != PreviewCandidate {
			continue
		}
		var l *dbgen.EvalRun
		for j := range runs {
			lr := DecodeRun(runs[j]).Config.Preview
			if runs[j].SetID == setID && lr != nil && lr.Side == PreviewLive && runs[j].CreatedAt.Equal(c.CreatedAt) {
				l = &runs[j]
				break
			}
		}
		if l == nil {
			continue
		}
		if newest == nil {
			newest = &[2]*dbgen.EvalRun{l, &runs[i]}
		}
		if l.Status == "completed" && c.Status == "completed" {
			return l, &runs[i]
		}
	}
	if newest != nil {
		return newest[0], newest[1]
	}
	return nil, nil
}

func (s *Service) fillPreviewSet(ctx context.Context, ps *PreviewSet, live, cand dbgen.EvalRun, items bool, liveAll, candAll *[]Scored, tot *PreviewTotals) error {
	load := func(run dbgen.EvalRun) ([]Result, []Scored, error) {
		rows, err := s.q.ListEvalResults(ctx, run.ID)
		if err != nil {
			return nil, nil, err
		}
		res, scored := make([]Result, len(rows)), make([]Scored, len(rows))
		for i, r := range rows {
			res[i] = DecodeResult(r)
			scored[i] = Scored{Status: r.Status, Answer: res[i].Scores, Missing: res[i].Diagnosis.Missing}
			if r.Rank != nil {
				scored[i].Rank = int(*r.Rank)
			}
		}
		return res, scored, nil
	}
	resL, scL, err := load(live)
	if err != nil {
		return err
	}
	resC, scC, err := load(cand)
	if err != nil {
		return err
	}
	k := DecodeRun(live).Config.ResultsPerSearch
	ps.Live.Summary, ps.Candidate.Summary = Summarize(KindRetrieval, k, scL), Summarize(KindRetrieval, DecodeRun(cand).Config.ResultsPerSearch, scC)
	ps.Live.FirstPlace, ps.Candidate.FirstPlace = firstPlaces(resL), firstPlaces(resC)
	ps.Questions = len(resL)
	for _, c := range compareResults(resL, resC) {
		switch c.Change {
		case ChangeBetter:
			ps.Better++
		case ChangeWorse:
			ps.Worse++
		case ChangeSame:
			ps.Same++
		default:
			ps.Unscored++
		}
		if items {
			it := PreviewItem{CaseID: c.CaseID, Question: c.Question, Change: c.Change}
			if c.A != nil {
				it.LiveStatus, it.LiveRank = c.A.Status, c.A.Rank
			}
			if c.B != nil {
				it.CandidateStatus, it.CandidateRank = c.B.Status, c.B.Rank
			}
			ps.Items = append(ps.Items, it)
		}
	}
	*liveAll, *candAll = append(*liveAll, scL...), append(*candAll, scC...)
	tot.Questions += ps.Questions
	tot.LiveFirst, tot.CandFirst = tot.LiveFirst+ps.Live.FirstPlace, tot.CandFirst+ps.Candidate.FirstPlace
	tot.Better, tot.Worse, tot.Same = tot.Better+ps.Better, tot.Worse+ps.Worse, tot.Same+ps.Same
	return nil
}

func firstPlaces(rs []Result) int {
	n := 0
	for _, r := range rs {
		if r.Status == StatusPass && r.Rank != nil && *r.Rank == 1 {
			n++
		}
	}
	return n
}
