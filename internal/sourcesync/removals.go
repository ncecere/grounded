package sourcesync

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Removing documents the provider no longer has.
//
// A sync collects what it would remove: the items the provider said were deleted, and, after a complete listing, the
// documents the listing did not mention. They are removed when the sync ends, unless that would empty the source or
// remove a large share of it. Then nothing is removed, and the sync's removals wait for an editor. A wrong folder, a
// revoked permission or an outage that looks like an empty listing must not delete a knowledge base on its own.

// hold says why a sync's removals wait for an editor ("" when they don't).
func (s *Service) hold(removals, total int64) string {
	switch {
	case removals == 0:
		return ""
	case removals >= total:
		return "The sync found none of this source's documents in the provider, so removing them would empty the source."
	case removals >= int64(s.HoldMinimum) && removals*100 > total*int64(s.HoldPercent):
		return fmt.Sprintf("The sync would remove %d of this source's %d documents, more than %d%%.", removals, total, s.HoldPercent)
	}
	return ""
}

// settleRemovals removes what the sync found gone, or holds it. It fills the removal fields of p.
func (s *Service) settleRemovals(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, run dbgen.SourceSync, complete bool, p *dbgen.FinishSourceSyncParams) ([]dbgen.DeleteSyncRemovalsRow, error) {
	if complete {
		if err := q.AddUnseenSyncRemovals(ctx, dbgen.AddUnseenSyncRemovalsParams{SyncID: run.ID, SourceID: src.ID}); err != nil {
			return nil, err
		}
	}
	n, err := q.CountSyncRemovals(ctx, run.ID)
	if err != nil || n == 0 {
		return nil, err
	}
	total, err := q.CountSourceDocuments(ctx, src.ID)
	if err != nil {
		return nil, err
	}
	if why := s.hold(n, total); why != "" {
		p.Removals, p.RemovalsPending, p.RemovalsReason = RemovalsPending, int32(n), why
		return nil, nil
	}
	removed, err := s.remove(ctx, q, src, run.ID)
	p.ItemsRemoved = int32(len(removed))
	return removed, err
}

// remove deletes a sync's collected documents and records their stored files for deletion when the deleted-files
// retention says (docs/operations/retention.md).
func (s *Service) remove(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, syncID uuid.UUID) ([]dbgen.DeleteSyncRemovalsRow, error) {
	removed, err := q.DeleteSyncRemovals(ctx, syncID)
	if err != nil {
		return nil, err
	}
	for _, d := range removed {
		if err := retention.RecordDeletedFiles(ctx, q, retention.DeletedContent{
			TeamID: src.TeamID, SourceID: src.ID, DocumentID: uuid.NullUUID{UUID: d.ID, Valid: true},
			Prefix: ingest.DocumentPrefix(src.TeamID, src.ID, d.ID), CreatedAt: d.CreatedAt,
		}); err != nil {
			return nil, err
		}
	}
	return removed, nil
}

// HeldRemovals lists the first documents a sync's held removals would remove.
func (s *Service) HeldRemovals(ctx context.Context, sourceID, syncID uuid.UUID, limit int32) (dbgen.SourceSync, []dbgen.SyncRemovalSampleRow, error) {
	run, err := s.q.GetSourceSync(ctx, syncID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && run.SourceID != sourceID) {
		return run, nil, errNoSync
	} else if err != nil {
		return run, nil, err
	}
	rows, err := s.q.SyncRemovalSample(ctx, dbgen.SyncRemovalSampleParams{SyncID: syncID, PageSize: limit})
	return run, rows, err
}

// DecideRemovals confirms (the documents are removed) or dismisses (they stay) a sync's held removals, inside the
// caller's transaction, which holds the source row's lock.
func (s *Service) DecideRemovals(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, syncID uuid.UUID, confirm bool) (dbgen.SourceSync, error) {
	run, err := q.LockSourceSync(ctx, syncID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && run.SourceID != src.ID) {
		return run, errNoSync
	} else if err != nil {
		return run, err
	}
	if run.Removals != RemovalsPending {
		return run, apperr.Conflict("removals_decided", "This sync has no removals waiting for a decision")
	}
	decision, removed := RemovalsDismissed, 0
	if confirm {
		rows, err := s.remove(ctx, q, src, run.ID)
		if err != nil {
			return run, err
		}
		decision, removed = RemovalsConfirmed, len(rows)
	}
	if err := q.ClearSyncRemovals(ctx, run.ID); err != nil {
		return run, err
	}
	return q.DecideSourceSyncRemovals(ctx, dbgen.DecideSourceSyncRemovalsParams{ID: run.ID, Removals: decision, Removed: int32(removed)})
}
