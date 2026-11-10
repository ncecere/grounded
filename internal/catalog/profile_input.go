package catalog

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ProfileInput creates a profile. Everything except name, description,
// status and the default flag is immutable afterwards (ADR-0007).
type ProfileInput struct {
	Key, Name, Description      string
	ModelID                     uuid.UUID
	StorageType                 string
	DocumentPrefix, QueryPrefix string
	ChunkSize, ChunkOverlap     int32
	// ChunkerVersion is the chunker that cuts the profile's passages (internal/chunk): 1, the original; 2, which merges short neighbouring
	// sections; 3, which also keeps tables structured; 0 means 1. Immutable afterwards, like the sizes (ADR-0007).
	ChunkerVersion int32
	// ParentTokens is the parent size of parent/child retrieval (docs/parent-child-retrieval.md): 0, the default, means no parents; otherwise
	// at least twice ChunkSize and at most chunk.MaxParentTokens. Immutable afterwards, like the sizes (ADR-0007).
	ParentTokens int32
	IsDefault    bool
	// Contextual marks a profile whose sets are built with contextual chunks for the sources that opted in (ADR-0028). Only an index
	// preview's candidate is made with it; immutable afterwards.
	Contextual bool
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
		return 0, apperr.Invalid("invalid_chunk_size", "Passage size must be between 64 and 8192 tokens")
	}
	if in.ChunkOverlap < 0 || in.ChunkOverlap >= in.ChunkSize {
		return 0, apperr.Invalid("invalid_chunk_overlap", "Passage overlap must be at least 0 and smaller than the passage size")
	}
	if len(in.DocumentPrefix) > 200 || len(in.QueryPrefix) > 200 {
		return 0, apperr.Invalid("invalid_prefix", "Prefixes must be at most 200 characters")
	}
	if in.ChunkerVersion == 0 {
		in.ChunkerVersion = chunk.Version1
	}
	if !chunk.ValidVersion(in.ChunkerVersion) {
		return 0, apperr.Invalid("invalid_chunker_version", "The chunker version must be 1 (the original), 2 (merges short neighbouring sections), 3 (also keeps tables structured), or 4 (preserves structural boundaries)")
	}
	if err := checkParentTokens(in.ParentTokens, in.ChunkSize); err != nil {
		return 0, err
	}
	return limit, in.DefaultWeights.validate()
}

// checkParentTokens: 0 (no parents), or a parent of at least two passages and at most chunk.MaxParentTokens.
func checkParentTokens(parent, chunkSize int32) error {
	if parent == 0 {
		return nil
	}
	if parent < 0 || parent > chunk.MaxParentTokens || parent < 2*chunkSize {
		return apperr.Invalid("invalid_parent_tokens",
			fmt.Sprintf("The parent size must be 0 (no parents) or between twice the passage size (%d) and %d tokens", 2*chunkSize, chunk.MaxParentTokens))
	}
	return nil
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
