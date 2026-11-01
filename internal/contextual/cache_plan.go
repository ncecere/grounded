package contextual

import (
	"bytes"
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// CachePlan is bounded current input identity for one document/profile. Its
// references precede generation, so concurrent profiles retain each other's
// in-flight artifacts. Identical plans still share document-scoped artifacts.
type CachePlan struct {
	DocumentID, SourceID, ProfileID uuid.UUID
	Version                         int32
	Keys                            [][32]byte
}

func requestCachePlan(req Request, keys [][32]byte) CachePlan {
	return CachePlan{DocumentID: req.DocumentID, SourceID: req.SourceID, ProfileID: req.ProfileID, Version: req.Version, Keys: keys}
}

func validateCachePlan(p CachePlan) error {
	if p.DocumentID == uuid.Nil || p.SourceID == uuid.Nil || p.ProfileID == uuid.Nil || p.Version <= 0 || len(p.Keys) > MaxUnitsPerDocument {
		return errors.New("contextual cache plan requires current document/profile identity and bounded keys")
	}
	return nil
}

func cachePlanStopped() error {
	return &StopError{Reason: "the contextual cache plan is no longer current"}
}

// RetainCachePlan changes references and prunes in one short transaction. Lock
// order is source settings then document, matching cache settlement. No model
// or network operation runs while these metadata locks are held.
func (s *PGStore) RetainCachePlan(ctx context.Context, p CachePlan) error {
	if err := validateCachePlan(p); err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		settings, err := q.LockSourceContextual(ctx, p.SourceID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !settings.Enabled) {
			return cachePlanStopped()
		}
		if err != nil {
			return err
		}
		current, err := planDocumentCurrent(ctx, q, p.DocumentID, p.SourceID, p.Version)
		if err != nil {
			return err
		}
		if !current {
			return cachePlanStopped()
		}
		_, err = q.LockContextualPlanSet(ctx, dbgen.LockContextualPlanSetParams{SourceID: p.SourceID, ProfileID: p.ProfileID})
		if errors.Is(err, pgx.ErrNoRows) {
			return cachePlanStopped()
		}
		if err != nil {
			return err
		}
		if err := q.UpsertContextualCachePlan(ctx, dbgen.UpsertContextualCachePlanParams{
			DocumentID: p.DocumentID, SourceID: p.SourceID, ProfileID: p.ProfileID, Version: p.Version, Keys: byteKeys(p.Keys),
		}); err != nil {
			return err
		}
		if err := q.DeleteStaleContextualCachePlans(ctx, dbgen.DeleteStaleContextualCachePlansParams{DocumentID: p.DocumentID, Version: p.Version}); err != nil {
			return err
		}
		_, err = q.PruneContextualCache(ctx, p.DocumentID)
		return err
	})
}

func planDocumentCurrent(ctx context.Context, q *dbgen.Queries, document, source uuid.UUID, version int32) (bool, error) {
	d, err := q.LockContextualPlanDocument(ctx, document)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return d.SourceID == source && d.Version == version, nil
}

// Paid usage must survive discarded/replaced work, but its text must not
// repopulate a vanished or stale plan. Caller already holds the source lock.
func cachePlanAllows(ctx context.Context, q *dbgen.Queries, e CacheEntry) (bool, error) {
	current, err := planDocumentCurrent(ctx, q, e.DocumentID, e.SourceID, e.Version)
	if err != nil || !current {
		return false, err
	}
	p, err := q.LockContextualCachePlan(ctx, dbgen.LockContextualCachePlanParams{DocumentID: e.DocumentID, ProfileID: e.ProfileID})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if p.SourceID != e.SourceID || p.Version != e.Version {
		return false, nil
	}
	for _, key := range p.Keys {
		if bytes.Equal(key, e.Key[:]) {
			return true, nil
		}
	}
	return false, nil
}
