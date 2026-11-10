package kbs

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/displaytext"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Input creates or updates a KB. ProfileID nil uses the platform default;
// the profile cannot change after creation (ADR-0007). Weights nil keeps the
// current fusion weights (the default for a new KB); DefaultWeights clears
// an override so the KB follows the default again: its profile's, else the
// platform's.
type Input struct {
	Name, Description string
	ProfileID         *uuid.UUID
	TopK              int32
	Weights           *Weights
	DefaultWeights    bool
}

func validate(in Input) error {
	if n := len(strings.TrimSpace(in.Name)); n < 1 || n > 100 {
		return apperr.Invalid("invalid_name", "Name must be 1-100 characters")
	}
	if len(in.Description) > 2000 {
		return apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
	}
	if in.TopK < 1 || in.TopK > 50 {
		return apperr.Invalid("invalid_top_k", "Results per query must be between 1 and 50")
	}
	if in.Weights != nil && in.DefaultWeights {
		return apperr.Invalid("invalid_fusion_weights", "Set fusion weights or use the platform default, not both")
	}
	if in.Weights != nil && !in.Weights.Valid() {
		return apperr.Invalid("invalid_fusion_weights", "Fusion weights must be between 0 and 1, and at least one must be above 0")
	}
	return nil
}

// weightColumns returns the stored override for w (nil = platform default).
func weightColumns(w *Weights) (*float64, *float64) {
	if w == nil {
		return nil, nil
	}
	v, k := w.Vector, w.Keyword
	return &v, &k
}

func kbSnapshot(kb dbgen.KnowledgeBase) map[string]any {
	return map[string]any{"name": kb.Name, "embeddingProfileId": kb.EmbeddingProfileID, "topK": kb.TopK,
		"vectorWeight": kb.VectorWeight, "keywordWeight": kb.KeywordWeight}
}

func (s *Service) Create(ctx context.Context, a authz.Actor, teamRef string, in Input) (KB, error) {
	acc, in, err := s.prepareCreate(ctx, a, teamRef, in)
	if err != nil {
		return KB{}, err
	}
	var (
		out     dbgen.KnowledgeBase
		created []KB
	)
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		return s.create(ctx, q, tx, a, acc, in, &out, &created)
	})
	if err != nil {
		return KB{}, err
	}
	return created[0], nil
}

// create is Create's transaction: limits, the profile, the row and its audit entry.
func (s *Service) create(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, acc teams.Access, in Input, out *dbgen.KnowledgeBase, created *[]KB) error {
	if s.Limits != nil {
		if err := s.Limits.LockUsage(ctx, q, acc.Team.ID); err != nil {
			return err
		}
		if err := s.Limits.CheckResources(ctx, q, acc.Team.ID, limits.Need{KnowledgeBases: 1}); err != nil {
			return err
		}
	}
	profileID := uuid.Nil
	if in.ProfileID != nil {
		profileID = *in.ProfileID
	} else {
		profiles, err := q.ListEmbeddingProfiles(ctx)
		if err != nil {
			return err
		}
		for _, p := range profiles {
			if p.EmbeddingProfile.IsDefault {
				profileID = p.EmbeddingProfile.ID
			}
		}
		if profileID == uuid.Nil {
			return apperr.Invalid("no_default_profile", "No default embedding profile is configured. Ask a platform admin.")
		}
	}
	if _, err := s.Catalog.ProfileForUse(ctx, q, profileID, 0); err != nil {
		return err
	}
	var err error
	vw, kw := weightColumns(in.Weights)
	*out, err = q.InsertKB(ctx, dbgen.InsertKBParams{
		TeamID: acc.Team.ID, Name: in.Name, Description: in.Description, EmbeddingProfileID: profileID,
		TopK: in.TopK, VectorWeight: vw, KeywordWeight: kw,
		CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil},
	})
	if apperr.IsUniqueViolation(err, "knowledge_bases_team_name_key") {
		return apperr.Conflict("name_taken", "This team already has a knowledge base with that name")
	} else if err != nil {
		return err
	}
	e := a.Audit("kb.create", "knowledge_base", out.ID.String())
	e.TeamID, e.After = acc.Team.ID, kbSnapshot(*out)
	if err := audit.Record(ctx, q, e); err != nil {
		return err
	}
	*created, err = s.withSources(ctx, q, []dbgen.KnowledgeBase{*out})
	return err
}

func (s *Service) Update(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID, in Input, expectedRevision int64) (KB, error) {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return KB{}, err
	}
	var out []KB
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		return s.update(ctx, q, tx, a, acc, id, in, expectedRevision, &out)
	})
	if err != nil {
		return KB{}, err
	}
	return out[0], nil
}

// update is Update's transaction.
func (s *Service) update(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, a authz.Actor, acc teams.Access, id uuid.UUID, in Input, expectedRevision int64, out *[]KB) error {
	cur, err := s.load(ctx, q, a, acc.Team.ID, id, true)
	if err != nil {
		return err
	}
	if cur.Revision != expectedRevision {
		return apperr.Stale()
	}
	// The handler fills in the name even for unrelated updates. Do not force
	// existing objects to be renamed unless their name actually changes.
	if in.Name != cur.Name {
		if err := displaytext.Validate(in.Name, "invalid_name", "Name"); err != nil {
			return err
		}
	}
	if in.ProfileID != nil && *in.ProfileID != cur.EmbeddingProfileID {
		return apperr.Invalid("profile_immutable", "A knowledge base's embedding profile cannot be changed")
	}
	if err := validate(in); err != nil {
		return err
	}
	in.Name = strings.TrimSpace(in.Name)
	vw, kw := cur.VectorWeight, cur.KeywordWeight
	switch {
	case in.DefaultWeights:
		vw, kw = nil, nil
	case in.Weights != nil:
		vw, kw = weightColumns(in.Weights)
	}
	updated, err := q.UpdateKB(ctx, dbgen.UpdateKBParams{ID: id, Name: in.Name, Description: in.Description, TopK: in.TopK,
		VectorWeight: vw, KeywordWeight: kw})
	if apperr.IsUniqueViolation(err, "knowledge_bases_team_name_key") {
		return apperr.Conflict("name_taken", "This team already has a knowledge base with that name")
	} else if err != nil {
		return err
	}
	e := a.Audit("kb.update", "knowledge_base", id.String())
	e.TeamID, e.Before, e.After = acc.Team.ID, kbSnapshot(cur), kbSnapshot(updated)
	if err := audit.Record(ctx, q, e); err != nil {
		return err
	}
	*out, err = s.withSources(ctx, q, []dbgen.KnowledgeBase{updated})
	return err
}

func (s *Service) Delete(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) error {
	acc, err := s.access(ctx, a, teamRef, true)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		// Its profile migrations go with it; they lock before the KB.
		if err := q.LockProfileMigrations(ctx); err != nil {
			return err
		}
		cur, err := s.load(ctx, q, a, acc.Team.ID, id, true)
		if err != nil {
			return err
		}
		// Refused while a published agent version searches it.
		users, err := q.AgentsPublishingKB(ctx, id)
		if err != nil {
			return err
		}
		if len(users) > 0 {
			names := make([]string, len(users))
			agents := make([]map[string]any, len(users))
			for i, u := range users {
				names[i] = u.Name
				agents[i] = map[string]any{"id": u.ID, "name": u.Name, "slug": u.Slug}
			}
			return &apperr.Error{Status: 409, Code: "kb_in_use",
				Message: "Published agents use this knowledge base: " + strings.Join(names, ", ") +
					". Remove it from them and publish again first.",
				Details: map[string]any{"agents": agents}}
		}
		// Drafts drop the reference silently (the agent shows a warning);
		// versions that are no longer served release it.
		drafts, err := q.AgentsWithDraftKB(ctx, dbgen.AgentsWithDraftKBParams{TeamID: acc.Team.ID, KBID: id.String()})
		if err != nil {
			return err
		}
		for _, ag := range drafts {
			if _, err := q.SetAgentDraft(ctx, dbgen.SetAgentDraftParams{ID: ag.ID, Draft: withoutKB(ag.Draft, id)}); err != nil {
				return err
			}
		}
		if err := q.DeleteUnservedVersionKB(ctx, id); err != nil {
			return err
		}
		if err := q.DeleteKB(ctx, id); err != nil {
			return err
		}
		e := a.Audit("kb.delete", "knowledge_base", id.String())
		e.TeamID, e.Before = acc.Team.ID, kbSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
}
