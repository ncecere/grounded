package catalog

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Profile statuses.
const (
	ProfileActive  = "active"
	ProfileRetired = "retired"
)

// pgvector HNSW index limits (ADR-0004).
var maxDimensions = map[string]int32{"halfvec": 4000, "vector": 2000}

var errNoProfile = apperr.NotFound("profile_not_found", "Embedding profile not found")

// errIsCandidate: a candidate is changed only by the index preview that made it (switch, discard).
var errIsCandidate = apperr.Conflict("profile_is_candidate", "This profile belongs to an index preview. Switch or discard the preview instead")

// Profile is an embedding profile with its model.
type Profile struct {
	dbgen.EmbeddingProfile
	Model dbgen.Model
}

func profileSnapshot(p dbgen.EmbeddingProfile) map[string]any {
	m := map[string]any{
		"key": p.Key, "name": p.Name, "modelId": p.ModelID, "dimensions": p.Dimensions, "storageType": p.StorageType,
		"documentPrefix": p.DocumentPrefix, "queryPrefix": p.QueryPrefix, "chunkSize": p.ChunkSize,
		"chunkOverlap": p.ChunkOverlap, "chunkerVersion": p.ChunkerVersion, "parentTokens": p.ParentTokens, "status": p.Status, "isDefault": p.IsDefault,
		"outputDimensions": p.OutputDimensions, "defaultVectorWeight": p.DefaultVectorWeight, "defaultKeywordWeight": p.DefaultKeywordWeight,
	}
	if p.Contextual { // only when set, so the audit of every other profile is what it was
		m["contextual"] = true
	}
	return m
}

func (s *Service) ListProfiles(ctx context.Context, a authz.Actor) ([]Profile, error) {
	if !a.CanReadPlatform() {
		return nil, errReadOnly
	}
	rows, err := s.q.ListEmbeddingProfiles(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Profile, len(rows))
	for i, r := range rows {
		out[i] = Profile{EmbeddingProfile: r.EmbeddingProfile, Model: r.Model}
	}
	return out, nil
}

func (s *Service) GetProfile(ctx context.Context, a authz.Actor, id uuid.UUID) (Profile, error) {
	if !a.CanReadPlatform() {
		return Profile{}, errReadOnly
	}
	r, err := s.q.GetEmbeddingProfile(ctx, id)
	if err != nil {
		return Profile{}, notFound(err, errNoProfile)
	}
	return Profile{EmbeddingProfile: r.EmbeddingProfile, Model: r.Model}, nil
}

func (s *Service) CreateProfile(ctx context.Context, a authz.Actor, in ProfileInput) (Profile, error) {
	return s.createProfile(ctx, a, in, uuid.NullUUID{})
}

// createProfile inserts a profile; candidateOf is set for the hidden copy an index preview builds into (candidate.go), which is never
// the default whatever the input says.
func (s *Service) createProfile(ctx context.Context, a authz.Actor, in ProfileInput, candidateOf uuid.NullUUID) (Profile, error) {
	if !a.IsPlatformAdmin() {
		return Profile{}, errAdminOnly
	}
	limit, err := checkProfileInput(&in)
	if err != nil {
		return Profile{}, err
	}
	var out Profile
	err = s.inTx(ctx, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockModelConfig(ctx); err != nil {
			return err
		}
		m, err := profileModel(ctx, q, in.ModelID)
		if err != nil {
			return err
		}
		dims, err := profileDimensions(m, in.OutputDimensions, in.StorageType, limit)
		if err != nil {
			return err
		}
		vw, kw := in.DefaultWeights.columns()
		n, err := q.CountEmbeddingProfiles(ctx)
		if err != nil {
			return err
		}
		isDefault := !candidateOf.Valid && (in.IsDefault || n == 0) // the first profile becomes the default
		if in.Contextual && !candidateOf.Valid {
			return apperr.Invalid("contextual_needs_preview", "Contextual chunks are switched on by an index preview, not when a profile is created")
		}
		p, err := q.InsertEmbeddingProfile(ctx, dbgen.InsertEmbeddingProfileParams{
			Key: in.Key, Name: in.Name, Description: in.Description, ModelID: m.ID, Dimensions: dims,
			StorageType: in.StorageType, DocumentPrefix: in.DocumentPrefix, QueryPrefix: in.QueryPrefix,
			ChunkSize: in.ChunkSize, ChunkOverlap: in.ChunkOverlap, ChunkerVersion: in.ChunkerVersion, ParentTokens: in.ParentTokens,
			CreatedBy:        uuid.NullUUID{UUID: a.UserID, Valid: true},
			OutputDimensions: in.OutputDimensions, DefaultVectorWeight: vw, DefaultKeywordWeight: kw, CandidateOf: candidateOf,
		})
		if apperr.IsUniqueViolation(err, "embedding_profiles_key_key") {
			return apperr.Conflict("key_taken", "An embedding profile with that key already exists")
		} else if err != nil {
			return err
		}
		if in.Contextual {
			if err := q.SetProfileContextual(ctx, dbgen.SetProfileContextualParams{ID: p.ID, Contextual: true}); err != nil {
				return err
			}
			p.Contextual = true
		}
		if isDefault {
			if err := q.ClearDefaultEmbeddingProfile(ctx, p.ID); err != nil {
				return err
			}
			if p, err = q.UpdateEmbeddingProfile(ctx, dbgen.UpdateEmbeddingProfileParams{
				ID: p.ID, Name: p.Name, Description: p.Description, Status: p.Status, IsDefault: true,
				DefaultVectorWeight: p.DefaultVectorWeight, DefaultKeywordWeight: p.DefaultKeywordWeight,
			}); err != nil {
				return err
			}
		}
		action := "platform.embedding_profile_create"
		if candidateOf.Valid {
			action = "platform.embedding_profile_candidate_create"
		}
		e := a.Audit(action, "embedding_profile", p.ID.String())
		e.After = profileSnapshot(p)
		out = Profile{EmbeddingProfile: p, Model: m}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

func (s *Service) UpdateProfile(ctx context.Context, a authz.Actor, id uuid.UUID, in ProfileUpdate, expectedRevision int64) (Profile, error) {
	if !a.IsPlatformAdmin() {
		return Profile{}, errAdminOnly
	}
	var out Profile
	err := s.inTx(ctx, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockModelConfig(ctx); err != nil {
			return err
		}
		cur, err := q.LockEmbeddingProfile(ctx, id)
		if err != nil {
			return notFound(err, errNoProfile)
		}
		if cur.CandidateOf.Valid {
			return errIsCandidate
		}
		if cur.Revision != expectedRevision {
			return apperr.Stale()
		}
		p, err := profileUpdate(cur, in)
		if err != nil {
			return err
		}
		if p.IsDefault && !cur.IsDefault {
			if err := q.ClearDefaultEmbeddingProfile(ctx, id); err != nil {
				return err
			}
		}
		updated, err := q.UpdateEmbeddingProfile(ctx, p)
		if err != nil {
			return err
		}
		e := a.Audit("platform.embedding_profile_update", "embedding_profile", id.String())
		e.Before, e.After = profileSnapshot(cur), profileSnapshot(updated)
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		m, err := q.GetModel(ctx, updated.ModelID)
		out = Profile{EmbeddingProfile: updated, Model: m}
		return err
	})
	return out, err
}

// DeleteProfile removes an unused profile. Profiles referenced by data
// sources are protected by foreign keys (Phase 1); retire them instead.
func (s *Service) DeleteProfile(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if !a.IsPlatformAdmin() {
		return errAdminOnly
	}
	return s.inTx(ctx, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockModelConfig(ctx); err != nil {
			return err
		}
		cur, err := q.LockEmbeddingProfile(ctx, id)
		if err != nil {
			return notFound(err, errNoProfile)
		}
		if cur.CandidateOf.Valid {
			return errIsCandidate
		}
		if cur.IsDefault {
			n, err := q.CountEmbeddingProfiles(ctx)
			if err != nil {
				return err
			}
			if n > 1 {
				return apperr.Conflict("default_required", "Make another profile the default before deleting this one")
			}
		}
		// Deleting it would also delete the profile migrations from or to it (AD-15).
		if n, err := q.CountProfileMigrations(ctx, id); err != nil {
			return err
		} else if n > 0 {
			return apperr.Conflict("profile_in_migrations", "Profile migrations refer to this profile, and deleting it would delete their history. Retire it instead.")
		}
		if err := q.DeleteEmbeddingProfile(ctx, id); apperr.IsForeignKeyViolation(err, "") {
			return apperr.Conflict("profile_in_use", "This profile is in use. Retire it instead.")
		} else if err != nil {
			return err
		}
		e := a.Audit("platform.embedding_profile_delete", "embedding_profile", id.String())
		e.Before = profileSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
}
