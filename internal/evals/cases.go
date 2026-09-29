// Questions (docs/evaluations.md §1): typed in, imported (with a dry run
// first) and exported, within the questions-per-set limit.

package evals

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Case is a question with its expected documents decoded.
type Case struct {
	dbgen.EvalCase
	Want Expected
}

// DecodeCase reads a stored question.
func DecodeCase(c dbgen.EvalCase) Case {
	out := Case{EvalCase: c}
	_ = json.Unmarshal(c.Expected, &out.Want)
	return out
}

func caseSnapshot(c dbgen.EvalCase) map[string]any {
	return map[string]any{"question": clip(c.Question, 200), "expected": json.RawMessage(c.Expected), "mustMention": c.MustMention, "note": clip(c.Note, 200)}
}

// Questions lists a set's questions.
func (s *Service) Questions(ctx context.Context, a authz.Actor, teamRef string, setID uuid.UUID) ([]Case, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	if _, err := loadSet(ctx, s.q, acc.Team.ID, setID, false); err != nil {
		return nil, err
	}
	rows, err := s.q.ListEvalCases(ctx, setID)
	out := make([]Case, len(rows))
	for i, r := range rows {
		out[i] = DecodeCase(r)
	}
	return out, err
}

// CaseResult is a question's result in one run.
type CaseResult = dbgen.ListCaseResultsRow

// Question returns a question with its results in the latest runs.
func (s *Service) Question(ctx context.Context, a authz.Actor, teamRef string, setID, id uuid.UUID) (Case, []CaseResult, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return Case{}, nil, err
	}
	if _, err := loadSet(ctx, s.q, acc.Team.ID, setID, false); err != nil {
		return Case{}, nil, err
	}
	c, err := s.q.GetEvalCase(ctx, dbgen.GetEvalCaseParams{ID: id, SetID: setID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Case{}, nil, errNoQuestion
	} else if err != nil {
		return Case{}, nil, err
	}
	results, err := s.q.ListCaseResults(ctx, dbgen.ListCaseResultsParams{CaseID: uuid.NullUUID{UUID: id, Valid: true}, Lim: 20})
	return DecodeCase(c), results, err
}

// setSources are the data sources of a set's knowledge bases.
func (s *Service) setSources(ctx context.Context, set dbgen.EvalSet) ([]uuid.UUID, error) {
	kbIDs, err := s.kbIDs(ctx, set)
	if err != nil {
		return nil, err
	}
	return s.sourceIDs(ctx, kbIDs)
}

// CreateQuestion adds a question, within evaluation_questions_per_set (audited).
func (s *Service) CreateQuestion(ctx context.Context, a authz.Actor, teamRef string, setID uuid.UUID, in CaseInput) (Case, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return Case{}, err
	}
	if in, err = in.Normalize(); err != nil {
		return Case{}, err
	}
	var c dbgen.EvalCase
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		set, err := loadSet(ctx, q, acc.Team.ID, setID, true)
		if err != nil {
			return err
		}
		if err := s.checkQuestionRoom(ctx, q, set, 1); err != nil {
			return err
		}
		if err := s.checkPicked(ctx, set, in.Expected); err != nil {
			return err
		}
		if c, err = insertCase(ctx, q, a, setID, in); err != nil {
			return err
		}
		e := a.Audit("evaluation.question_create", "evaluation_set", setID.String())
		e.After = caseSnapshot(c)
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"questionId": c.ID})
		return audited(ctx, q, e, acc.Team.ID)
	})
	return DecodeCase(c), err
}

// checkQuestionRoom applies evaluation_questions_per_set before adding n
// questions (the set is locked).
func (s *Service) checkQuestionRoom(ctx context.Context, q *dbgen.Queries, set dbgen.EvalSet, n int) error {
	if s.Limits == nil {
		return nil
	}
	cur, err := q.CountEvalCases(ctx, set.ID)
	if err != nil {
		return err
	}
	return s.Limits.CheckSetQuestions(ctx, q, set.TeamID, cur, int64(n))
}

// checkPicked checks that picked documents are in the set's knowledge bases.
func (s *Service) checkPicked(ctx context.Context, set dbgen.EvalSet, e Expected) error {
	if len(e.DocumentIDs) == 0 {
		return nil
	}
	sources, err := s.setSources(ctx, set)
	if err != nil {
		return err
	}
	return s.checkDocuments(ctx, sources, e.DocumentIDs)
}

func insertCase(ctx context.Context, q *dbgen.Queries, a authz.Actor, setID uuid.UUID, in CaseInput) (dbgen.EvalCase, error) {
	raw, _ := json.Marshal(in.Expected)
	return q.InsertEvalCase(ctx, dbgen.InsertEvalCaseParams{SetID: setID, Question: in.Question, Expected: raw,
		MustMention: in.MustMention, Note: in.Note, CreatedBy: nullUser(a)})
}

// UpdateQuestion replaces a question's text, expected documents, phrases
// and note (audited).
func (s *Service) UpdateQuestion(ctx context.Context, a authz.Actor, teamRef string, setID, id uuid.UUID, in CaseInput, expectedRevision int64) (Case, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return Case{}, err
	}
	if in, err = in.Normalize(); err != nil {
		return Case{}, err
	}
	var next dbgen.EvalCase
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		set, err := loadSet(ctx, q, acc.Team.ID, setID, true)
		if err != nil {
			return err
		}
		cur, err := q.LockEvalCase(ctx, dbgen.LockEvalCaseParams{ID: id, SetID: setID})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoQuestion
		} else if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		if err := s.checkPicked(ctx, set, in.Expected); err != nil {
			return err
		}
		raw, _ := json.Marshal(in.Expected)
		if next, err = q.UpdateEvalCase(ctx, dbgen.UpdateEvalCaseParams{ID: id, Question: in.Question, Expected: raw,
			MustMention: in.MustMention, Note: in.Note}); err != nil {
			return err
		}
		e := a.Audit("evaluation.question_update", "evaluation_set", setID.String())
		e.Before, e.After = caseSnapshot(cur), caseSnapshot(next)
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"questionId": id})
		return audited(ctx, q, e, acc.Team.ID)
	})
	return DecodeCase(next), err
}

// DeleteQuestion removes a question; past runs keep its results (audited).
func (s *Service) DeleteQuestion(ctx context.Context, a authz.Actor, teamRef string, setID, id uuid.UUID) error {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if _, err := loadSet(ctx, q, acc.Team.ID, setID, true); err != nil {
			return err
		}
		cur, err := q.LockEvalCase(ctx, dbgen.LockEvalCaseParams{ID: id, SetID: setID})
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return errNoQuestion
		} else if err != nil {
			return err
		}
		if err := q.DeleteEvalCase(ctx, id); err != nil {
			return err
		}
		e := a.Audit("evaluation.question_delete", "evaluation_set", setID.String())
		e.Before = caseSnapshot(cur)
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"questionId": id})
		return audited(ctx, q, e, acc.Team.ID)
	})
}

// ImportInput is an import: its format, content, and whether to add the
// usable rows or only preview them.
type ImportInput struct {
	Format, Content string
	DryRun          bool
}

// ImportResult is what an import found (and, unless a dry run, added).
type ImportResult struct {
	Rows     int
	Usable   int
	Added    int
	Problems []ImportProblem
	// Warnings are usable rows whose expected documents match nothing in
	// the knowledge bases yet (they count once one is added).
	Warnings []ImportProblem
	// Max and Current are the questions-per-set limit (nil: none) and the
	// set's questions before the import.
	Max     *int64
	Current int64
}

// Import previews (DryRun) or adds the usable rows of a CSV or JSONL
// import. Rows that can't be used are reported and left out; an import
// that would pass the questions-per-set limit adds nothing (409). One
// audit entry records the counts.
func (s *Service) Import(ctx context.Context, a authz.Actor, teamRef string, setID uuid.UUID, in ImportInput) (ImportResult, error) {
	acc, err := s.access(ctx, a, teamRef, !in.DryRun)
	if err != nil {
		return ImportResult{}, err
	}
	rows, probs, err := Parse(in.Format, in.Content)
	if err != nil {
		return ImportResult{}, err
	}
	var res ImportResult
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		set, err := loadSet(ctx, q, acc.Team.ID, setID, !in.DryRun)
		if err != nil {
			return err
		}
		usable, more, err := s.usableRows(ctx, q, set, rows)
		if err != nil {
			return err
		}
		res = ImportResult{Rows: len(rows) + len(probs), Usable: len(usable), Problems: sortProblems(append(probs, more...))}
		if res.Warnings, err = s.importWarnings(ctx, set, usable); err != nil {
			return err
		}
		if res.Current, err = q.CountEvalCases(ctx, setID); err != nil {
			return err
		}
		if s.Limits != nil {
			eff, err := s.Limits.Effective(ctx, q, acc.Team.ID)
			if err != nil {
				return err
			}
			res.Max = eff.Get(limits.EvaluationQuestionsPerSet)
		}
		if in.DryRun || len(usable) == 0 {
			return nil
		}
		return s.addImported(ctx, q, a, acc.Team.ID, set, usable, &res, in.Format)
	})
	return res, err
}

// usableRows drops duplicates and rows whose picked documents aren't in the
// set's knowledge bases.
func (s *Service) usableRows(ctx context.Context, q *dbgen.Queries, set dbgen.EvalSet, rows []ImportRow) ([]ImportRow, []ImportProblem, error) {
	existing, err := q.ListEvalCases(ctx, set.ID)
	if err != nil {
		return nil, nil, err
	}
	questions := make([]string, len(existing))
	for i, c := range existing {
		questions[i] = c.Question
	}
	rows, probs := Dedupe(rows, questions)
	var sources []uuid.UUID
	var out []ImportRow
	for _, r := range rows {
		if len(r.Expected.DocumentIDs) > 0 {
			if sources == nil {
				if sources, err = s.setSources(ctx, set); err != nil {
					return nil, nil, err
				}
			}
			if err := s.checkDocuments(ctx, sources, r.Expected.DocumentIDs); err != nil {
				probs = append(probs, ImportProblem{Line: r.Line, Message: problemText(err)})
				continue
			}
		}
		out = append(out, r)
	}
	return out, probs, nil
}

func (s *Service) addImported(ctx context.Context, q *dbgen.Queries, a authz.Actor, teamID uuid.UUID, set dbgen.EvalSet, rows []ImportRow, res *ImportResult, format string) error {
	if err := s.checkQuestionRoom(ctx, q, set, len(rows)); err != nil {
		return err
	}
	for _, r := range rows {
		if _, err := insertCase(ctx, q, a, set.ID, r.CaseInput); err != nil {
			return err
		}
	}
	res.Added = len(rows)
	e := a.Audit("evaluation.questions_import", "evaluation_set", set.ID.String())
	e.Metadata = mergeMeta(e.Metadata, map[string]any{"format": format, "rows": res.Rows, "added": res.Added, "skipped": len(res.Problems)})
	return audited(ctx, q, e, teamID)
}

func sortProblems(p []ImportProblem) []ImportProblem {
	sort.SliceStable(p, func(i, j int) bool { return p[i].Line < p[j].Line })
	if p == nil {
		p = []ImportProblem{}
	}
	return p
}

// Export writes a set's questions as CSV (the import's format) and returns
// the set's name for the file name.
func (s *Service) Export(ctx context.Context, a authz.Actor, teamRef string, setID uuid.UUID) (string, []byte, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return "", nil, err
	}
	set, err := loadSet(ctx, s.q, acc.Team.ID, setID, false)
	if err != nil {
		return "", nil, err
	}
	rows, err := s.q.ListEvalCases(ctx, setID)
	if err != nil {
		return "", nil, err
	}
	out := make([]ExportRow, len(rows))
	for i, r := range rows {
		c := DecodeCase(r)
		out[i] = ExportRow{Question: c.Question, Expected: c.Want, MustMention: c.MustMention, Note: c.Note}
	}
	var buf bytes.Buffer
	err = WriteCSV(&buf, out)
	return set.Name, buf.Bytes(), err
}
