// Index preview (#18): a hidden candidate profile with the changed settings, and a held migration into it.

package profilemig

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/store"
)

// PreviewInput is an index preview: the knowledge base, the settings that change (nil keeps the knowledge base's current profile's), and
// the grace period used if the preview is switched (nil: the install default).
type PreviewInput struct {
	KBID      uuid.UUID
	Changes   catalog.CandidateChanges
	GraceDays *int32
}

var errKBNotFound = apperr.NotFound("kb_not_found", "Knowledge base not found")

// Preview copies the knowledge base's profile with the changes as a hidden candidate and starts a held migration into it: the new index is
// built while the live one keeps answering, and the migration waits as ready for an admin to switch or discard it. If the migration is
// refused (the preflight's blockers, another active migration), no candidate is left behind.
func (s *Service) Preview(ctx context.Context, a authz.Actor, in PreviewInput) (Migration, error) {
	if !a.IsPlatformAdmin() {
		return Migration{}, errAdminOnly
	}
	kb, err := s.q.GetKB(ctx, in.KBID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Migration{}, errKBNotFound
	} else if err != nil {
		return Migration{}, err
	}
	cand, err := s.Catalog.CreateCandidate(ctx, a, kb.EmbeddingProfileID, in.Changes)
	if err != nil {
		return Migration{}, err
	}
	m, err := s.Start(ctx, a, StartInput{KBID: kb.ID, TargetProfileID: cand.ID, GraceDays: in.GraceDays, Hold: true})
	if err != nil {
		// Nothing refers to the candidate yet (a refused start records no migration), so it can be deleted, not retired.
		if _, derr := s.Pool.Exec(ctx, `DELETE FROM embedding_profiles p WHERE p.id = $1 AND p.candidate_of IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM profile_migrations m WHERE m.to_profile_id = p.id OR m.from_profile_id = p.id)`, cand.ID); derr != nil {
			s.Log.ErrorContext(ctx, "index preview: could not remove the candidate of a refused start", "profile", cand.ID, "err", derr)
		}
		return Migration{}, err
	}
	return m, nil
}
