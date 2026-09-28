// Sets (docs/evaluations.md §1): create, read, change and delete, the
// knowledge bases a set searches, and the document picker.

package evals

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// SetView is a set with its target's name, question count and latest run.
type SetView = dbgen.ListEvalSetViewsRow

// SetInput creates a set: exactly one of KBID and AgentID.
type SetInput struct {
	KBID, AgentID     *uuid.UUID
	Name, Description string
	AutoRun           bool
}

// SetUpdate changes a set; nil fields stay.
type SetUpdate struct {
	Name, Description *string
	AutoRun           *bool
}

// Filter narrows the list to one knowledge base's or agent's sets.
type Filter struct{ KBID, AgentID *uuid.UUID }

func checkNames(name, description string) error {
	if n := utf8.RuneCountInString(name); n == 0 || n > 200 {
		return apperr.Invalid("invalid_name", "The name must be 1-200 characters")
	}
	if utf8.RuneCountInString(description) > 2000 {
		return apperr.Invalid("invalid_description", "The description can be at most 2000 characters")
	}
	return nil
}

func setSnapshot(s dbgen.EvalSet) map[string]any {
	return map[string]any{"name": s.Name, "description": s.Description, "autoRun": s.AutoRun}
}

// List returns the team's sets (editors and above).
func (s *Service) List(ctx context.Context, a authz.Actor, teamRef string, f Filter) ([]SetView, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	return s.q.ListEvalSetViews(ctx, dbgen.ListEvalSetViewsParams{TeamID: acc.Team.ID, KBID: nullID(f.KBID), AgentID: nullID(f.AgentID)})
}

// Get returns one set.
func (s *Service) Get(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) (SetView, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return SetView{}, err
	}
	return s.view(ctx, acc.Team.ID, id)
}

func (s *Service) view(ctx context.Context, teamID, id uuid.UUID) (SetView, error) {
	v, err := s.q.GetEvalSetView(ctx, dbgen.GetEvalSetViewParams{ID: id, TeamID: teamID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return SetView{}, errNoSet
	}
	return SetView(v), err
}

// checkTarget checks that the set's knowledge base or agent belongs to the team.
func (s *Service) checkTarget(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID, in SetInput) error {
	switch {
	case (in.KBID == nil) == (in.AgentID == nil):
		return apperr.Invalid("invalid_target", "Give either kbId or agentId")
	case in.KBID != nil:
		kb, err := q.GetKB(ctx, *in.KBID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && kb.TeamID != teamID) {
			return errTargetFound
		}
		return err
	default:
		ag, err := q.GetAgent(ctx, *in.AgentID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && ag.TeamID != teamID) {
			return errTargetFound
		}
		return err
	}
}

// Create adds a set, within the team's evaluation_sets limit (audited).
func (s *Service) Create(ctx context.Context, a authz.Actor, teamRef string, in SetInput) (SetView, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return SetView{}, err
	}
	in.Name, in.Description = strings.TrimSpace(in.Name), strings.TrimSpace(in.Description)
	if err := checkNames(in.Name, in.Description); err != nil {
		return SetView{}, err
	}
	var set dbgen.EvalSet
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := s.checkTarget(ctx, q, acc.Team.ID, in); err != nil {
			return err
		}
		if s.Limits != nil {
			if err := s.Limits.LockUsage(ctx, q, acc.Team.ID); err != nil {
				return err
			}
			if err := s.Limits.CheckResources(ctx, q, acc.Team.ID, limits.Need{EvalSets: 1}); err != nil {
				return err
			}
		}
		if set, err = q.InsertEvalSet(ctx, dbgen.InsertEvalSetParams{TeamID: acc.Team.ID, KBID: nullID(in.KBID), AgentID: nullID(in.AgentID),
			Name: in.Name, Description: in.Description, AutoRun: in.AutoRun, CreatedBy: nullUser(a)}); err != nil {
			return err
		}
		e := a.Audit("evaluation.set_create", "evaluation_set", set.ID.String())
		e.After = setSnapshot(set)
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"kbId": in.KBID, "agentId": in.AgentID})
		return audited(ctx, q, e, acc.Team.ID)
	})
	if err != nil {
		return SetView{}, err
	}
	return s.view(ctx, acc.Team.ID, set.ID)
}

// Update changes a set's name, description or automatic runs (audited).
func (s *Service) Update(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, in SetUpdate, expectedRevision int64) (SetView, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return SetView{}, err
	}
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := loadSet(ctx, q, acc.Team.ID, id, true)
		if err != nil {
			return err
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		p := dbgen.UpdateEvalSetParams{ID: id, Name: cur.Name, Description: cur.Description, AutoRun: cur.AutoRun}
		if in.Name != nil {
			p.Name = strings.TrimSpace(*in.Name)
		}
		if in.Description != nil {
			p.Description = strings.TrimSpace(*in.Description)
		}
		if in.AutoRun != nil {
			p.AutoRun = *in.AutoRun
		}
		if err := checkNames(p.Name, p.Description); err != nil {
			return err
		}
		next, err := q.UpdateEvalSet(ctx, p)
		if err != nil {
			return err
		}
		e := a.Audit("evaluation.set_update", "evaluation_set", id.String())
		e.Before, e.After = setSnapshot(cur), setSnapshot(next)
		return audited(ctx, q, e, acc.Team.ID)
	})
	if err != nil {
		return SetView{}, err
	}
	return s.view(ctx, acc.Team.ID, id)
}

// Delete removes a set with its questions and runs (audited).
func (s *Service) Delete(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) error {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := loadSet(ctx, q, acc.Team.ID, id, true)
		if err != nil {
			return err
		}
		n, err := q.CountEvalCases(ctx, id)
		if err != nil {
			return err
		}
		if err := q.DeleteEvalSet(ctx, id); err != nil {
			return err
		}
		e := a.Audit("evaluation.set_delete", "evaluation_set", id.String())
		e.Before = setSnapshot(cur)
		e.Metadata = mergeMeta(e.Metadata, map[string]any{"setName": cur.Name, "questions": n})
		return audited(ctx, q, e, acc.Team.ID)
	})
}

// kbIDs are the knowledge bases a set searches: its own, or the agent's
// (the draft's and the published version's).
func (s *Service) kbIDs(ctx context.Context, set dbgen.EvalSet) ([]uuid.UUID, error) {
	if set.KBID.Valid {
		return []uuid.UUID{set.KBID.UUID}, nil
	}
	ids := map[uuid.UUID]bool{}
	var out []uuid.UUID
	for _, published := range []bool{false, true} {
		t, err := s.Agents.LoadEvalTarget(ctx, set.AgentID.UUID, published)
		if agents.ErrNoPublishedVersion(err) {
			continue
		} else if err != nil {
			return nil, err
		}
		for _, id := range t.Config.KBIDs() {
			if !ids[id] {
				ids[id] = true
				out = append(out, id)
			}
		}
	}
	return out, nil
}

// sourceIDs are the data sources of knowledge bases.
func (s *Service) sourceIDs(ctx context.Context, kbIDs []uuid.UUID) ([]uuid.UUID, error) {
	if len(kbIDs) == 0 {
		return []uuid.UUID{}, nil
	}
	return s.q.EvalKBSourceIDs(ctx, kbIDs)
}

// Document is a document a question can expect.
type Document = dbgen.SearchEvalDocumentsRow

// Documents finds documents of the set's knowledge bases by title,
// filename or URL, for the expected-documents picker.
func (s *Service) Documents(ctx context.Context, a authz.Actor, teamRef string, setID uuid.UUID, text string, limit int) ([]Document, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	set, err := loadSet(ctx, s.q, acc.Team.ID, setID, false)
	if err != nil {
		return nil, err
	}
	kbIDs, err := s.kbIDs(ctx, set)
	if err != nil {
		return nil, err
	}
	sources, err := s.sourceIDs(ctx, kbIDs)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	pattern := ""
	if text = strings.TrimSpace(text); text != "" {
		pattern = "%" + store.EscapeLike(text) + "%"
	}
	return s.q.SearchEvalDocuments(ctx, dbgen.SearchEvalDocumentsParams{SourceIds: sources, Pattern: pattern, Lim: int32(limit)})
}

// checkDocuments checks that picked documents belong to the set's sources.
func (s *Service) checkDocuments(ctx context.Context, sources []uuid.UUID, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	for _, id := range ids {
		ok, err := s.q.ExpectedDocumentExists(ctx, dbgen.ExpectedDocumentExistsParams{SourceIds: sources, DocumentIds: []uuid.UUID{id},
			Urls: []string{}, UrlPrefixes: []string{}, Filenames: []string{}})
		if err != nil {
			return err
		}
		if !ok {
			return invalidExpected("The document %s isn't in this set's knowledge base", id)
		}
	}
	return nil
}

func mergeMeta(a, b map[string]any) map[string]any {
	if a == nil {
		a = map[string]any{}
	}
	for k, v := range b {
		a[k] = v
	}
	return a
}
