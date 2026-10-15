// Candidate profiles (index preview, #18): the hidden copy of a knowledge base's embedding profile that a preview builds into.

package catalog

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
)

// CandidateChanges are the settings a preview changes; nil keeps the live profile's value. They are the profile's immutable settings
// (ADR-0007): a change means a new profile, and a candidate is that new profile, built beside the live one.
type CandidateChanges struct {
	Name                        *string
	ModelID                     *uuid.UUID
	StorageType                 *string
	DocumentPrefix, QueryPrefix *string
	ChunkSize, ChunkOverlap     *int32
	ChunkerVersion              *int32
}

// CreateCandidate copies the live profile with the changes applied, hidden (candidate_of is set, so it is in no list or picker, is never
// the default, and cannot be selected) and with a generated key. It does not start anything: the caller starts the held migration.
func (s *Service) CreateCandidate(ctx context.Context, a authz.Actor, liveID uuid.UUID, ch CandidateChanges) (Profile, error) {
	if !a.IsPlatformAdmin() {
		return Profile{}, errAdminOnly
	}
	row, err := s.q.GetEmbeddingProfile(ctx, liveID)
	if err != nil {
		return Profile{}, notFound(err, errNoProfile)
	}
	live := row.EmbeddingProfile
	if live.CandidateOf.Valid {
		return Profile{}, errIsCandidate
	}
	in := ProfileInput{
		Key:            "preview-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12],
		Name:           pick(ch.Name, truncate(live.Name+" (new settings)", 100)),
		Description:    truncate("An index preview of "+live.Name+"; not in use until an admin switches it.", 2000),
		ModelID:        pick(ch.ModelID, live.ModelID),
		StorageType:    pick(ch.StorageType, live.StorageType),
		DocumentPrefix: pick(ch.DocumentPrefix, live.DocumentPrefix),
		QueryPrefix:    pick(ch.QueryPrefix, live.QueryPrefix),
		ChunkSize:      pick(ch.ChunkSize, live.ChunkSize),
		ChunkOverlap:   pick(ch.ChunkOverlap, live.ChunkOverlap),
		ChunkerVersion: pick(ch.ChunkerVersion, live.ChunkerVersion),
		// A new model has its own dimensions: only a model that is kept keeps the live profile's truncation.
		OutputDimensions: nil,
	}
	if ch.ModelID == nil || *ch.ModelID == live.ModelID {
		in.OutputDimensions = live.OutputDimensions
	}
	if live.DefaultVectorWeight != nil && live.DefaultKeywordWeight != nil {
		in.DefaultWeights = &FusionWeights{Vector: *live.DefaultVectorWeight, Keyword: *live.DefaultKeywordWeight}
	}
	p, err := s.createProfile(ctx, a, in, uuid.NullUUID{UUID: live.ID, Valid: true})
	if err != nil {
		return Profile{}, fmt.Errorf("preview of %s: %w", live.Key, err)
	}
	return p, nil
}

func pick[T any](v *T, def T) T {
	if v == nil {
		return def
	}
	return *v
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
