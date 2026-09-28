// The atomic switch (and switch back): a KB's profile flips in one
// transaction, so retrieval uses the new profile from the next query.

package profilemig

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Advance switches a running migration's KB when every source has vectors
// for the target profile; otherwise it does nothing. It is idempotent and
// runs after each source completes, after a start, and from the sweep.
func (s *Service) Advance(ctx context.Context, id uuid.UUID) error {
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if err := q.LockProfileMigrations(ctx); err != nil {
			return err
		}
		m, err := q.LockProfileMigration(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && m.Status != StatusRunning) {
			return nil
		} else if err != nil {
			return err
		}
		kb, err := q.LockKB(ctx, m.KBID)
		if err != nil {
			return err
		}
		if kb.EmbeddingProfileID != m.FromProfileID {
			return fmt.Errorf("profile migration %s: the knowledge base no longer uses the source profile", m.ID)
		}
		done, _, err := complete(ctx, q, kb.ID, m.ToProfileID)
		if err != nil || !done {
			return err
		}
		sources, err := s.flip(ctx, q, kb, m.ToProfileID)
		if err != nil {
			return err
		}
		if m, err = q.SwitchProfileMigration(ctx, m.ID); err != nil {
			return err
		}
		e := audit.Entry{ActorKind: audit.ActorSystem, TeamID: kb.TeamID, Action: "kb.profile_switch",
			TargetType: "knowledge_base", TargetID: kb.ID.String(),
			Metadata: s.meta(m, map[string]any{"sources": sources, "graceDays": m.GraceDays})}
		if err := audit.Record(ctx, q, e); err != nil {
			return err
		}
		if err := s.notifySwitch(ctx, q, tx, m, kb, false); err != nil {
			return err
		}
		if m.GraceDays == 0 {
			return s.kickCleanup(ctx, tx)
		}
		return nil
	})
}

// flip points the KB at the profile and moves its sources' own profile
// there when every KB using them has: the old one becomes an extra set,
// which the cleanup job deletes once nothing needs it. It returns how many
// sources the KB has.
func (s *Service) flip(ctx context.Context, q *dbgen.Queries, kb dbgen.KnowledgeBase, profileID uuid.UUID) (int, error) {
	if _, err := q.SetKBProfile(ctx, dbgen.SetKBProfileParams{ID: kb.ID, ProfileID: profileID}); err != nil {
		return 0, err
	}
	sources, err := q.KBSources(ctx, kb.ID)
	if err != nil {
		return 0, err
	}
	for _, src := range sources {
		if err := q.MarkEmbeddingSetReady(ctx, dbgen.MarkEmbeddingSetReadyParams{SourceID: src.ID, ProfileID: profileID}); err != nil {
			return 0, err
		}
	}
	moving, err := q.SourcesMovingTo(ctx, dbgen.SourcesMovingToParams{KBID: kb.ID, ProfileID: profileID})
	if err != nil {
		return 0, err
	}
	for _, src := range moving {
		if _, err := q.InsertEmbeddingSet(ctx, dbgen.InsertEmbeddingSetParams{SourceID: src.ID, ProfileID: src.EmbeddingProfileID, Status: "ready"}); err != nil {
			return 0, err
		}
		if err := q.DropEmbeddingSetRow(ctx, dbgen.DropEmbeddingSetRowParams{SourceID: src.ID, ProfileID: profileID}); err != nil {
			return 0, err
		}
		if err := q.SetSourceProfile(ctx, dbgen.SetSourceProfileParams{ID: src.ID, ProfileID: profileID}); err != nil {
			return 0, err
		}
		if err := q.RecountSourceChunks(ctx, dbgen.RecountSourceChunksParams{SourceID: src.ID, ProfileID: profileID}); err != nil {
			return 0, err
		}
	}
	return len(sources), nil
}

var errNoSwitchBack = apperr.Conflict("switch_back_unavailable", "The grace period is over: the old vectors are gone. Start a new migration instead.")

// SwitchBack returns a switched KB to its previous profile within the grace
// period. The old vectors were kept current meanwhile (new documents are
// embedded for both), so it is immediate.
func (s *Service) SwitchBack(ctx context.Context, a authz.Actor, id uuid.UUID, rev int64) (Migration, error) {
	return s.change(ctx, a, id, rev, func(q *dbgen.Queries, tx pgx.Tx, m dbgen.ProfileMigration) error {
		if m.Status != StatusSwitched || m.OldVectorsUntil == nil || !m.OldVectorsUntil.After(timeNow()) {
			return errNoSwitchBack
		}
		kb, err := q.LockKB(ctx, m.KBID)
		if err != nil {
			return err
		}
		if kb.EmbeddingProfileID != m.ToProfileID {
			return apperr.Conflict("switch_back_unavailable", "The knowledge base no longer uses this migration's profile")
		}
		done, missing, err := complete(ctx, q, kb.ID, m.FromProfileID)
		if err != nil {
			return err
		}
		if !done {
			return apperr.Conflict("switch_back_unavailable", fmt.Sprintf(
				"%d documents don't have vectors for the previous profile yet (they changed since the switch). Try again in a minute.", missing))
		}
		sources, err := s.flip(ctx, q, kb, m.FromProfileID)
		if err != nil {
			return err
		}
		if m, err = q.FinishProfileMigration(ctx, dbgen.FinishProfileMigrationParams{Status: StatusSwitchedBack, ID: m.ID,
			FinishedBy: uuid.NullUUID{UUID: a.UserID, Valid: a.UserID != uuid.Nil}}); err != nil {
			return err
		}
		if err := s.record(ctx, q, a, "kb.profile_switch_back", m, map[string]any{"sources": sources}); err != nil {
			return err
		}
		if err := s.notifySwitch(ctx, q, tx, m, kb, true); err != nil {
			return err
		}
		return s.kickCleanup(ctx, tx)
	})
}

// notifySwitch tells the team's admins and owners, and (for a switch) the
// platform admins.
func (s *Service) notifySwitch(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, m dbgen.ProfileMigration, kb dbgen.KnowledgeBase, back bool) error {
	if s.Notify == nil {
		return nil
	}
	team, err := q.GetTeamByID(ctx, kb.TeamID)
	if err != nil {
		return err
	}
	from, err := q.GetEmbeddingProfile(ctx, m.FromProfileID)
	if err != nil {
		return err
	}
	to, err := q.GetEmbeddingProfile(ctx, m.ToProfileID)
	if err != nil {
		return err
	}
	ref := notify.TeamRef{ID: team.ID, Slug: team.Slug, Name: team.Name}
	fromName, toName := from.EmbeddingProfile.Name, to.EmbeddingProfile.Name
	if back {
		fromName, toName = toName, fromName
	}
	if err := s.Notify.Emit(ctx, tx, notify.KBProfileChangedEvent(ref, kb.ID, kb.Name, fromName, toName, back).By(m.FinishedBy.UUID)); err != nil {
		return err
	}
	if back {
		return nil
	}
	admins, err := q.ActivePlatformAdminIDs(ctx)
	if err != nil || len(admins) == 0 {
		return err
	}
	return s.Notify.Emit(ctx, tx, notify.ProfileSwitchedEvent(admins, ref, m.ID, kb.Name, fromName, toName, *m.OldVectorsUntil))
}

// notifyAttention tells the platform admins, once per episode, that a
// running migration has failed documents.
func (s *Service) notifyAttention(ctx context.Context, id uuid.UUID) error {
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		m, err := q.LockProfileMigration(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			return nil
		} else if err != nil || m.Status != StatusRunning || m.AttentionAt != nil {
			return err
		}
		mv, err := s.view(ctx, dbgen.ListProfileMigrationViewsRow{ProfileMigration: m}, false)
		if err != nil || mv.Progress.Failed == 0 {
			return err
		}
		now := timeNow()
		if err := q.SetMigrationAttention(ctx, dbgen.SetMigrationAttentionParams{ID: m.ID, AttentionAt: &now}); err != nil {
			return err
		}
		if s.Notify == nil {
			return nil
		}
		kb, err := q.GetKB(ctx, m.KBID)
		if err != nil {
			return err
		}
		team, err := q.GetTeamByID(ctx, m.TeamID)
		if err != nil {
			return err
		}
		to, err := q.GetEmbeddingProfile(ctx, m.ToProfileID)
		if err != nil {
			return err
		}
		admins, err := q.ActivePlatformAdminIDs(ctx)
		if err != nil || len(admins) == 0 {
			return err
		}
		ref := notify.TeamRef{ID: team.ID, Slug: team.Slug, Name: team.Name}
		return s.Notify.Emit(ctx, tx, notify.ProfileAttentionEvent(admins, ref, m.ID, kb.Name, to.EmbeddingProfile.Name, mv.Progress.Failed, now))
	})
}
