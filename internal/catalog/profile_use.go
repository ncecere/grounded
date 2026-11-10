package catalog

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

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
	if row.EmbeddingProfile.CandidateOf.Valid {
		// A candidate belongs to an index preview until an admin switches it: nothing else may use it.
		return Profile{}, apperr.Invalid("unknown_profile", "Unknown embedding profile")
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
