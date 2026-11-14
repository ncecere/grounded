// The rows the answer path reads on every question (#251): the chat model and its connection, the rerank and SystemOne
// models and theirs, and the query-embedding profile of each knowledge base. They are kept for a few seconds
// (internal/ttlcache): a change made through this process (every write in this package) drops them at once; a change
// made through another process applies within the TTL. So disabling a model or a connection, rotating a connection's
// key or lowering a rerank or SystemOne model's classification ceiling reaches the other processes within 5 seconds.
//
// Not cached: the moderation provider (ModerationTarget reads its model and connection every time, as the moderation
// policy is read every time: moderation fails closed, DESIGN.md §7.5), the agent's classification checks
// (internal/agents/policy.go) and every admin screen, which read the rows themselves.

package catalog

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/ttlcache"
)

// rowCache holds the cached rows.
type rowCache struct {
	models   ttlcache.Map[uuid.UUID, dbgen.Model]
	conns    ttlcache.Map[uuid.UUID, dbgen.ModelConnection]
	profiles ttlcache.Map[uuid.UUID, dbgen.GetEmbeddingProfileRow]
}

func (c *rowCache) invalidate() {
	c.models.Invalidate()
	c.conns.Invalidate()
	c.profiles.Invalidate()
}

func (s *Service) cachedModel(ctx context.Context, id uuid.UUID) (dbgen.Model, error) {
	return s.rows.models.Get(ctx, id, func(ctx context.Context) (dbgen.Model, error) { return s.q.GetModel(ctx, id) })
}

func (s *Service) cachedConnection(ctx context.Context, id uuid.UUID) (dbgen.ModelConnection, error) {
	return s.rows.conns.Get(ctx, id, func(ctx context.Context) (dbgen.ModelConnection, error) { return s.q.GetConnection(ctx, id) })
}

func (s *Service) cachedProfile(ctx context.Context, id uuid.UUID) (dbgen.GetEmbeddingProfileRow, error) {
	return s.rows.profiles.Get(ctx, id, func(ctx context.Context) (dbgen.GetEmbeddingProfileRow, error) {
		return s.q.GetEmbeddingProfile(ctx, id)
	})
}

// RowsChanged drops the cached rows: for writes to models, connections or profiles made outside this package.
func (s *Service) RowsChanged() { s.rows.invalidate() }

// inTx is store.InTx for this package's writes: the cached rows are dropped once it ends.
func (s *Service) inTx(ctx context.Context, fn func(q *dbgen.Queries, tx pgx.Tx) error) error {
	defer s.rows.invalidate()
	return store.InTx(ctx, s.pool, fn)
}
