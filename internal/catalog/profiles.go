package catalog

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store"
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

// Profile is an embedding profile with its model.
type Profile struct {
	dbgen.EmbeddingProfile
	Model dbgen.Model
}

// ProfileInput creates a profile. Everything except name, description,
// status and the default flag is immutable afterwards (ADR-0007).
type ProfileInput struct {
	Key, Name, Description      string
	ModelID                     uuid.UUID
	StorageType                 string
	DocumentPrefix, QueryPrefix string
	ChunkSize, ChunkOverlap     int32
	IsDefault                   bool
	// OutputDimensions stores fewer dimensions than the model's
	// (Matryoshka truncation, DESIGN.md §10); nil = the model's.
	OutputDimensions *int32
	// DefaultWeights are the fusion weights of the profile's KBs that set
	// none (DESIGN.md §6); nil = the platform default. Mutable.
	DefaultWeights *FusionWeights
}

// ProfileUpdate holds optional changes to the mutable fields.
// PlatformWeights removes the profile's default fusion weights.
type ProfileUpdate struct {
	Name, Description, Status *string
	IsDefault                 *bool
	DefaultWeights            *FusionWeights
	PlatformWeights           bool
}

// FusionWeights are hybrid fusion weights (kbs.Weights, which imports this
// package): each 0-1, not both 0.
type FusionWeights struct {
	Vector, Keyword float64
}

func (w *FusionWeights) validate() error {
	if w != nil && (w.Vector < 0 || w.Vector > 1 || w.Keyword < 0 || w.Keyword > 1 || w.Vector+w.Keyword <= 0) {
		return apperr.Invalid("invalid_fusion_weights", "Fusion weights must be between 0 and 1, and at least one must be above 0")
	}
	return nil
}

// columns returns the stored form (both nil = the platform default).
func (w *FusionWeights) columns() (*float64, *float64) {
	if w == nil {
		return nil, nil
	}
	v, k := w.Vector, w.Keyword
	return &v, &k
}

func profileSnapshot(p dbgen.EmbeddingProfile) map[string]any {
	return map[string]any{
		"key": p.Key, "name": p.Name, "modelId": p.ModelID, "dimensions": p.Dimensions, "storageType": p.StorageType,
		"documentPrefix": p.DocumentPrefix, "queryPrefix": p.QueryPrefix, "chunkSize": p.ChunkSize,
		"chunkOverlap": p.ChunkOverlap, "chunkerVersion": p.ChunkerVersion, "status": p.Status, "isDefault": p.IsDefault,
		"outputDimensions": p.OutputDimensions, "defaultVectorWeight": p.DefaultVectorWeight, "defaultKeywordWeight": p.DefaultKeywordWeight,
	}
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
	if !a.IsPlatformAdmin() {
		return Profile{}, errAdminOnly
	}
	limit, err := checkProfileInput(&in)
	if err != nil {
		return Profile{}, err
	}
	var out Profile
	err = store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
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
		isDefault := in.IsDefault || n == 0 // the first profile becomes the default
		p, err := q.InsertEmbeddingProfile(ctx, dbgen.InsertEmbeddingProfileParams{
			Key: in.Key, Name: in.Name, Description: in.Description, ModelID: m.ID, Dimensions: dims,
			StorageType: in.StorageType, DocumentPrefix: in.DocumentPrefix, QueryPrefix: in.QueryPrefix,
			ChunkSize: in.ChunkSize, ChunkOverlap: in.ChunkOverlap,
			CreatedBy:        uuid.NullUUID{UUID: a.UserID, Valid: true},
			OutputDimensions: in.OutputDimensions, DefaultVectorWeight: vw, DefaultKeywordWeight: kw,
		})
		if apperr.IsUniqueViolation(err, "embedding_profiles_key_key") {
			return apperr.Conflict("key_taken", "An embedding profile with that key already exists")
		} else if err != nil {
			return err
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
		e := a.Audit("platform.embedding_profile_create", "embedding_profile", p.ID.String())
		e.After = profileSnapshot(p)
		out = Profile{EmbeddingProfile: p, Model: m}
		return audit.Record(ctx, q, e)
	})
	return out, err
}

// checkProfileInput validates a new profile and applies defaults (halfvec
// storage, 512-token chunks). It returns the storage type's dimension limit.
func checkProfileInput(in *ProfileInput) (int32, error) {
	if !keyRE.MatchString(in.Key) {
		return 0, apperr.Invalid("invalid_key", "Key must be 1-63 lowercase letters, digits, dots, dashes or underscores")
	}
	in.Name = strings.TrimSpace(in.Name)
	if err := trimmedLen(in.Name, 1, 100, "invalid_name", "Name must be 1-100 characters"); err != nil {
		return 0, err
	}
	if len(in.Description) > 2000 {
		return 0, apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
	}
	if in.StorageType == "" {
		in.StorageType = "halfvec"
	}
	limit, ok := maxDimensions[in.StorageType]
	if !ok {
		return 0, apperr.Invalid("invalid_storage_type", "Storage type must be halfvec or vector")
	}
	if in.ChunkSize == 0 {
		in.ChunkSize = 512
	}
	if in.ChunkSize < 64 || in.ChunkSize > 8192 {
		return 0, apperr.Invalid("invalid_chunk_size", "Chunk size must be between 64 and 8192 tokens")
	}
	if in.ChunkOverlap < 0 || in.ChunkOverlap >= in.ChunkSize {
		return 0, apperr.Invalid("invalid_chunk_overlap", "Chunk overlap must be at least 0 and smaller than the chunk size")
	}
	if len(in.DocumentPrefix) > 200 || len(in.QueryPrefix) > 200 {
		return 0, apperr.Invalid("invalid_prefix", "Prefixes must be at most 200 characters")
	}
	return limit, in.DefaultWeights.validate()
}

// profileModel loads a profile's model: an enabled embedding model.
func profileModel(ctx context.Context, q *dbgen.Queries, id uuid.UUID) (dbgen.Model, error) {
	m, err := q.GetModel(ctx, id)
	if err != nil {
		return m, notFound(err, apperr.Invalid("unknown_model", "Unknown model"))
	}
	if m.Kind != KindEmbedding {
		return m, apperr.Invalid("not_embedding_model", "Embedding profiles need an embedding model")
	}
	if !m.Enabled {
		return m, apperr.Invalid("model_disabled", "That model is disabled")
	}
	return m, nil
}

// profileDimensions returns the dimensions a profile on m stores: out when
// set, else the model's. They must fit the storage type's index limit, and
// out can only shorten the model's vectors (Matryoshka truncation).
func profileDimensions(m dbgen.Model, out *int32, storageType string, limit int32) (int32, error) {
	dims := *m.Dimensions
	if out != nil {
		if *out < 1 || *out > dims {
			return 0, apperr.Invalid("invalid_output_dimensions",
				fmt.Sprintf("Output dimensions must be between 1 and the model's %d dimensions", dims))
		}
		dims = *out
	}
	if dims > limit {
		if out != nil {
			return 0, apperr.Invalid("dimensions_too_large",
				"Output dimensions exceed what "+storageType+" indexes support (halfvec ≤ 4000, vector ≤ 2000)")
		}
		return 0, apperr.Invalid("dimensions_too_large",
			"This model's dimensions exceed what "+storageType+" indexes support (halfvec ≤ 4000, vector ≤ 2000). "+
				"Set output dimensions if the model supports Matryoshka truncation.")
	}
	return dims, nil
}

func (s *Service) UpdateProfile(ctx context.Context, a authz.Actor, id uuid.UUID, in ProfileUpdate, expectedRevision int64) (Profile, error) {
	if !a.IsPlatformAdmin() {
		return Profile{}, errAdminOnly
	}
	var out Profile
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockModelConfig(ctx); err != nil {
			return err
		}
		cur, err := q.LockEmbeddingProfile(ctx, id)
		if err != nil {
			return notFound(err, errNoProfile)
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

// profileUpdate applies changes to a profile. The default profile stays
// active and set until another one becomes the default.
func profileUpdate(cur dbgen.EmbeddingProfile, in ProfileUpdate) (dbgen.UpdateEmbeddingProfileParams, error) {
	p := dbgen.UpdateEmbeddingProfileParams{ID: cur.ID, Name: cur.Name, Description: cur.Description, Status: cur.Status, IsDefault: cur.IsDefault,
		DefaultVectorWeight: cur.DefaultVectorWeight, DefaultKeywordWeight: cur.DefaultKeywordWeight}
	if err := applyProfileWeights(&p, in); err != nil {
		return p, err
	}
	if in.Name != nil {
		p.Name = strings.TrimSpace(*in.Name)
		if err := trimmedLen(p.Name, 1, 100, "invalid_name", "Name must be 1-100 characters"); err != nil {
			return p, err
		}
	}
	if in.Description != nil {
		if len(*in.Description) > 2000 {
			return p, apperr.Invalid("invalid_description", "Description must be at most 2000 characters")
		}
		p.Description = *in.Description
	}
	if in.Status != nil {
		if *in.Status != ProfileActive && *in.Status != ProfileRetired {
			return p, apperr.Invalid("invalid_status", "Status must be active or retired")
		}
		p.Status = *in.Status
	}
	if in.IsDefault != nil {
		p.IsDefault = *in.IsDefault
	}
	if cur.IsDefault && !p.IsDefault {
		return p, apperr.Conflict("default_required", "Make another profile the default instead of unsetting this one")
	}
	if p.IsDefault && p.Status != ProfileActive {
		return p, apperr.Conflict("default_must_be_active", "The default profile must be active. Make another profile the default first.")
	}
	return p, nil
}

// applyProfileWeights sets or removes the profile's default fusion weights.
func applyProfileWeights(p *dbgen.UpdateEmbeddingProfileParams, in ProfileUpdate) error {
	switch {
	case in.DefaultWeights != nil && in.PlatformWeights:
		return apperr.Invalid("invalid_fusion_weights", "Set default fusion weights or use the platform default, not both")
	case in.PlatformWeights:
		p.DefaultVectorWeight, p.DefaultKeywordWeight = nil, nil
	case in.DefaultWeights != nil:
		if err := in.DefaultWeights.validate(); err != nil {
			return err
		}
		p.DefaultVectorWeight, p.DefaultKeywordWeight = in.DefaultWeights.columns()
	}
	return nil
}

// DeleteProfile removes an unused profile. Profiles referenced by data
// sources are protected by foreign keys (Phase 1); retire them instead.
func (s *Service) DeleteProfile(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if !a.IsPlatformAdmin() {
		return errAdminOnly
	}
	return store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockModelConfig(ctx); err != nil {
			return err
		}
		cur, err := q.LockEmbeddingProfile(ctx, id)
		if err != nil {
			return notFound(err, errNoProfile)
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

// EmbedTarget is everything needed to embed text for one profile.
type EmbedTarget struct {
	Profile        dbgen.EmbeddingProfile
	Model          dbgen.Model
	Client         *gateway.Client
	MaxInputTokens int // 0 when the model does not declare a limit
}

// ErrProfileUnusable is returned when a profile's model or connection is
// disabled or missing, so embedding cannot run.
var ErrProfileUnusable = apperr.Conflict("profile_unusable", "The embedding model or its connection is disabled")

// EmbedTarget resolves a profile to its model, connection and a ready
// client. It is used by ingestion and retrieval, not by admin screens, so it
// performs no authorization.
func (s *Service) EmbedTarget(ctx context.Context, profileID uuid.UUID) (EmbedTarget, error) {
	row, err := s.q.GetEmbeddingProfile(ctx, profileID)
	if err != nil {
		return EmbedTarget{}, notFound(err, errNoProfile)
	}
	if !row.Model.Enabled {
		return EmbedTarget{}, ErrProfileUnusable
	}
	conn, err := s.q.GetConnection(ctx, row.Model.ConnectionID)
	if err != nil {
		return EmbedTarget{}, err
	}
	if !conn.Enabled {
		return EmbedTarget{}, ErrProfileUnusable
	}
	cl, err := s.observedClient(conn, KindEmbedding)
	if err != nil {
		return EmbedTarget{}, err
	}
	t := EmbedTarget{Profile: row.EmbeddingProfile, Model: row.Model, Client: cl}
	if row.Model.MaxInputTokens != nil {
		t.MaxInputTokens = int(*row.Model.MaxInputTokens)
	}
	return t, nil
}

// ProfileForUse returns an active profile whose model may process data of
// the given classification rank (ADR-0006 rule 4).
func (s *Service) ProfileForUse(ctx context.Context, q *dbgen.Queries, profileID uuid.UUID, classificationRank int32) (Profile, error) {
	row, err := q.GetEmbeddingProfile(ctx, profileID)
	if err != nil {
		return Profile{}, notFound(err, apperr.Invalid("unknown_profile", "Unknown embedding profile"))
	}
	if row.EmbeddingProfile.Status != ProfileActive {
		return Profile{}, apperr.Invalid("profile_retired", "That embedding profile is retired")
	}
	if !row.Model.Enabled {
		return Profile{}, ErrProfileUnusable
	}
	level, err := q.GetClassification(ctx, row.Model.MaxClassification)
	if err != nil {
		return Profile{}, err
	}
	if level.Rank < classificationRank {
		return Profile{}, apperr.Invalid("model_classification",
			"This embedding profile's model is not approved for data at this classification")
	}
	return Profile{EmbeddingProfile: row.EmbeddingProfile, Model: row.Model}, nil
}

// ListUsableProfiles returns active profiles whose model is enabled, for
// teams choosing a profile. It exposes no connection details.
func (s *Service) ListUsableProfiles(ctx context.Context) ([]Profile, error) {
	rows, err := s.q.ListEmbeddingProfiles(ctx)
	if err != nil {
		return nil, err
	}
	var out []Profile
	for _, r := range rows {
		if r.EmbeddingProfile.Status == ProfileActive && r.Model.Enabled {
			out = append(out, Profile{EmbeddingProfile: r.EmbeddingProfile, Model: r.Model})
		}
	}
	return out, nil
}
