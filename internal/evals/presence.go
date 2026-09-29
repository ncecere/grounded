// Warnings before a question is saved (docs/evaluations.md §1): expected
// documents that no document of the knowledge bases matches yet, and
// must-mention phrases that appear in none of their passages. Neither
// blocks saving: a document added later counts from then on.

package evals

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// CheckInput is a question to check before it's saved: its set, or the
// knowledge base or agent of a set to come, and what it expects.
type CheckInput struct {
	SetID, KBID, AgentID *uuid.UUID
	Expected             Expected
	MustMention          []string
}

// QuestionCheck says which expected documents and phrases the knowledge
// bases hold.
type QuestionCheck struct {
	Expected []ExpectedItem
	Mentions []Mention
}

// CheckQuestion checks a question's expected documents and must-mention
// phrases against the knowledge bases it would search (editors and above;
// nothing is saved).
func (s *Service) CheckQuestion(ctx context.Context, a authz.Actor, teamRef string, in CheckInput) (QuestionCheck, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return QuestionCheck{}, err
	}
	kbIDs, err := s.checkScope(ctx, acc.Team.ID, in)
	if err != nil {
		return QuestionCheck{}, err
	}
	want := Expected{}
	if in.Expected.Count() > 0 {
		if want, err = in.Expected.Normalize(); err != nil {
			return QuestionCheck{}, err
		}
	}
	phrases, err := NormalizePhrases(in.MustMention)
	if err != nil {
		return QuestionCheck{}, err
	}
	sources, err := s.sourceIDs(ctx, kbIDs)
	if err != nil {
		return QuestionCheck{}, err
	}
	out := QuestionCheck{Expected: want.Items(), Mentions: []Mention{}}
	if err := s.stateItems(ctx, sources, out.Expected); err != nil {
		return out, err
	}
	for _, p := range phrases {
		found, err := s.q.PhraseInSources(ctx, dbgen.PhraseInSourcesParams{Phrase: p, SourceIds: sources})
		if err != nil {
			return out, err
		}
		out.Mentions = append(out.Mentions, Mention{Phrase: p, Found: found})
	}
	return out, nil
}

// checkScope resolves the knowledge bases of a set, or of a knowledge base
// or agent of the team.
func (s *Service) checkScope(ctx context.Context, teamID uuid.UUID, in CheckInput) ([]uuid.UUID, error) {
	if in.SetID == nil {
		if err := s.checkTarget(ctx, s.q, teamID, SetInput{KBID: in.KBID, AgentID: in.AgentID}); err != nil {
			return nil, err
		}
		return s.targetKBIDs(ctx, nullID(in.KBID), nullID(in.AgentID))
	}
	if in.KBID != nil || in.AgentID != nil {
		return nil, apperr.Invalid("invalid_target", "Give one of setId, kbId and agentId")
	}
	set, err := loadSet(ctx, s.q, teamID, *in.SetID, false)
	if err != nil {
		return nil, err
	}
	return s.kbIDs(ctx, set)
}

// stateItems marks each item indexed (with the matching document) or not,
// and a picked document that's gone as deleted (the form only offers the
// knowledge base's documents).
func (s *Service) stateItems(ctx context.Context, sources []uuid.UUID, items []ExpectedItem) error {
	found, err := s.match(ctx, sources, items)
	if err != nil {
		return err
	}
	for i := range items {
		switch {
		case found[i]:
			items[i].State = StateIndexed
		case items[i].Kind == ItemDocument:
			items[i].State = StateDeleted
		default:
			items[i].State = StateNotIndexed
		}
	}
	return nil
}

// importWarnings are the usable rows none of whose expected documents is
// in the set's knowledge bases yet.
func (s *Service) importWarnings(ctx context.Context, set dbgen.EvalSet, rows []ImportRow) ([]ImportProblem, error) {
	out := []ImportProblem{}
	if len(rows) == 0 {
		return out, nil
	}
	sources, err := s.setSources(ctx, set)
	if err != nil {
		return nil, err
	}
	where, err := s.targetWords(ctx, set)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		items := r.Expected.Items()
		found, err := s.match(ctx, sources, items)
		if err != nil {
			return nil, err
		}
		if !anyTrue(found) {
			out = append(out, ImportProblem{Line: r.Line, Message: notInKBText(where, items)})
		}
	}
	return out, nil
}

// targetWords names where a set's documents are: "Student help" or
// "Helper's knowledge bases".
func (s *Service) targetWords(ctx context.Context, set dbgen.EvalSet) (string, error) {
	v, err := s.view(ctx, set.TeamID, set.ID)
	if err != nil {
		return "", err
	}
	if set.AgentID.Valid {
		return v.TargetName + "'s knowledge bases", nil
	}
	return v.TargetName, nil
}

// notInKBText is the warning for expected documents nothing matches:
// "No document in Student help matches housing.pdf yet. It'll count once
// one is added."
func notInKBText(where string, items []ExpectedItem) string {
	names := make([]string, 0, len(items))
	for _, it := range items {
		names = append(names, clip(it.Value, 80))
	}
	return fmt.Sprintf("No document in %s matches %s yet. It'll count once one is added.", where, strings.Join(names, " or "))
}

func anyTrue(v []bool) bool {
	for _, b := range v {
		if b {
			return true
		}
	}
	return false
}
