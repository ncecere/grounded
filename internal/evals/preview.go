// Index preview runs (#18): when a held migration is ready, every evaluation set of its knowledge base is run twice, retrieval only: once on
// the live index and once on the candidate's, so the comparison is like for like at the same moment. The candidate run retrieves through
// a copy of the knowledge base whose profile is the candidate's (kbs.RetrieveForEvaluation takes the knowledge base as a value).

package evals

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Sides of an index preview's comparison.
const (
	PreviewLive      = "live"
	PreviewCandidate = "candidate"
)

// PreviewRef says which index an index preview's run retrieves from: the migration, the profile, and which side of the comparison it is.
type PreviewRef struct {
	MigrationID uuid.UUID `json:"migrationId"`
	ProfileID   uuid.UUID `json:"profileId"`
	Side        string    `json:"side"`
}

var errPreviewRunning = apperr.Conflict("preview_running", "This preview's comparison is still running. Wait for it to finish")

// applyPreview points a loaded target at the index its run compares: the candidate's side searches the candidate profile (the knowledge
// base is a copy; nothing stored changes), the live side its own. The run's configuration records the marker and the profile's name.
func (s *Service) applyPreview(ctx context.Context, t *target, p *PreviewRef) error {
	t.cfg.Preview = p
	if p.Side != PreviewCandidate || t.kb == nil {
		return nil
	}
	row, err := s.q.GetEmbeddingProfile(ctx, p.ProfileID)
	if err != nil {
		return err
	}
	t.kb.EmbeddingProfileID = p.ProfileID
	for i := range t.cfg.KBs {
		if t.cfg.KBs[i].ID == t.kb.ID {
			t.cfg.KBs[i].ProfileID, t.cfg.KBs[i].Profile = p.ProfileID, row.EmbeddingProfile.Name
		}
	}
	return nil
}

// StartPreview runs every evaluation set of the knowledge base on the live profile and on the candidate (two retrieval runs per set that has
// questions), in the caller's transaction, and returns how many sets it started. It refuses while a comparison of this migration is still
// running. A knowledge base without sets starts nothing: the comparison says so. Sets of agents are not run: the preview compares the
// knowledge base's own retrieval.
func (s *Service) StartPreview(ctx context.Context, tx pgx.Tx, kbID, migrationID, liveProfile, candidateProfile uuid.UUID) (int, error) {
	q := dbgen.New(tx)
	if _, err := q.ActivePreviewRun(ctx, migrationID.String()); err == nil {
		return 0, errPreviewRunning
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	sets, err := q.PreviewSetsForKB(ctx, uuid.NullUUID{UUID: kbID, Valid: true})
	if err != nil {
		return 0, err
	}
	started := 0
	for _, set := range sets {
		n, err := q.CountEvalCases(ctx, set.ID)
		if err != nil {
			return started, err
		}
		if n == 0 {
			continue
		}
		for _, side := range []struct {
			name    string
			profile uuid.UUID
		}{{PreviewLive, liveProfile}, {PreviewCandidate, candidateProfile}} {
			t, err := s.loadTarget(ctx, set, "", false)
			if err != nil {
				return started, err
			}
			ref := &PreviewRef{MigrationID: migrationID, ProfileID: side.profile, Side: side.name}
			if err := s.applyPreview(ctx, &t, ref); err != nil {
				return started, err
			}
			raw, _ := json.Marshal(t.cfg)
			run, err := q.InsertEvalRun(ctx, dbgen.InsertEvalRunParams{SetID: set.ID, TeamID: set.TeamID, Kind: KindRetrieval,
				Trigger: TriggerIndexPreview, Config: raw, Total: int32(n)})
			if err != nil {
				return started, err
			}
			if s.Jobs != nil {
				if _, err := s.Jobs.InsertTx(ctx, tx, RunArgs{RunID: run.ID}, nil); err != nil {
					return started, err
				}
			}
		}
		started++
	}
	return started, nil
}
