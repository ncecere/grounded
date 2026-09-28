// Package vectorstore stores chunk embeddings and runs filtered nearest
// neighbour search (ADR-0004). The interface allows another engine (e.g.
// Qdrant) if the pgvector benchmark gate fails; v1 uses pgvector.
package vectorstore

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgvector "github.com/pgvector/pgvector-go"
)

// Profile identifies an embedding profile's vector space.
type Profile struct {
	ID          uuid.UUID
	Dimensions  int
	StorageType string // "halfvec" or "vector"
}

// Record is one chunk's embedding.
type Record struct {
	ChunkID  uuid.UUID
	SourceID uuid.UUID
	Vector   []float32
}

// Filter scopes a search. SourceIDs is required: every search is limited to
// a knowledge base's sources. Estimated is the approximate number of vectors
// in those sources; it selects the search strategy (0 = unknown, searched
// exactly). Docs optionally restricts results by document metadata.
type Filter struct {
	SourceIDs []uuid.UUID
	Estimated int64
	Docs      DocFilter
}

// DocFilter restricts results by document metadata (docs/phase3-agents.md
// §3). Empty fields do not filter. Kinds are document kinds (pdf, docx, pptx,
// html, markdown, text); Tags match any; URLPrefixes match the start of the
// document URL (web pages); the dates bound documents.updated_at.
type DocFilter struct {
	Kinds         []string
	Tags          []string
	URLPrefixes   []string
	UpdatedAfter  *time.Time
	UpdatedBefore *time.Time
}

// IsZero reports whether the filter matches every document.
func (f DocFilter) IsZero() bool {
	return len(f.Kinds) == 0 && len(f.Tags) == 0 && len(f.URLPrefixes) == 0 && f.UpdatedAfter == nil && f.UpdatedBefore == nil
}

// SQL renders the filter as a boolean expression over the documents table
// aliased as alias. Placeholders start at $next; it returns the expression
// ("true" when the filter is empty) and its arguments.
func (f DocFilter) SQL(alias string, next int) (string, []any) {
	var conds []string
	var args []any
	add := func(format string, v any) {
		conds = append(conds, fmt.Sprintf(format, alias, next))
		args = append(args, v)
		next++
	}
	if len(f.Kinds) > 0 {
		add("%s.kind = ANY($%d::text[])", f.Kinds)
	}
	if len(f.Tags) > 0 {
		add("%s.tags && $%d::text[]", f.Tags)
	}
	if len(f.URLPrefixes) > 0 {
		add("EXISTS (SELECT 1 FROM unnest($%[2]d::text[]) p WHERE left(%[1]s.url, length(p)) = p)", f.URLPrefixes)
	}
	if f.UpdatedAfter != nil {
		add("%s.updated_at >= $%d", *f.UpdatedAfter)
	}
	if f.UpdatedBefore != nil {
		add("%s.updated_at < $%d", *f.UpdatedBefore)
	}
	if len(conds) == 0 {
		return "true", nil
	}
	return strings.Join(conds, " AND "), args
}

// Hit is a search result; Distance is cosine distance (0 = identical).
type Hit struct {
	ChunkID  uuid.UUID
	Distance float64
}

// Store is the vector storage interface.
type Store interface {
	EnsureProfile(ctx context.Context, p Profile) error
	// Upsert writes vectors inside tx, so vectors commit with their chunks.
	Upsert(ctx context.Context, tx pgx.Tx, p Profile, recs []Record) error
	Search(ctx context.Context, p Profile, q []float32, f Filter, k int) ([]Hit, error)
	// Distances returns the distance from q to each of the given chunks that
	// has a vector (chunks without one are absent from the map).
	Distances(ctx context.Context, p Profile, q []float32, chunkIDs []uuid.UUID) (map[uuid.UUID]float64, error)
}

// ErrNoSources is returned when a search has no sources to scope it.
var ErrNoSources = errors.New("vectorstore: search needs at least one source")

// ErrDimensions is returned when a vector's length does not match the profile.
var ErrDimensions = errors.New("vector dimensions do not match the embedding profile")

// PGVector keeps one table per profile: emb_<profile id>(chunk_id, source_id,
// embedding) with an HNSW cosine index. Rows are removed with their chunks
// (ON DELETE CASCADE), so documents need no separate vector cleanup.
type PGVector struct {
	Pool *pgxpool.Pool
	// EfSearch is the HNSW candidate list size (recall vs latency). 0 = 400.
	EfSearch int
	// ExactThreshold is the largest filtered set searched exactly (read via
	// the source_id index and sorted): perfect recall at ~0.3 ms per 1,000
	// real vectors (16 ms for 57.6k). Larger sets use the HNSW index.
	// 0 = 100,000. See docs/benchmarks/vector-gate.md.
	ExactThreshold int64
	// IterativeScan selects how filtered HNSW searches keep recall: nil
	// detects the installed pgvector (iterative index scans need >= 0.8);
	// false forces the fallback (over-fetch OverFetch x k, then filter).
	IterativeScan *bool

	detectOnce sync.Once
	iterative  bool
}

// OverFetch is the candidate multiplier of the fallback filtered HNSW search
// (pgvector < 0.8).
const OverFetch = 10

// iterativeScans reports whether filtered HNSW searches can use pgvector's
// iterative index scans.
func (s *PGVector) iterativeScans(ctx context.Context) bool {
	if s.IterativeScan != nil {
		return *s.IterativeScan
	}
	s.detectOnce.Do(func() {
		var v string
		if err := s.Pool.QueryRow(ctx, "SELECT extversion FROM pg_extension WHERE extname = 'vector'").Scan(&v); err == nil {
			s.iterative = VersionAtLeast(v, 0, 8)
		}
	})
	return s.iterative
}

// VersionAtLeast compares a "major.minor[.patch]" version.
func VersionAtLeast(v string, major, minor int) bool {
	parts := strings.SplitN(v, ".", 3)
	if len(parts) < 2 {
		return false
	}
	ma, err1 := strconv.Atoi(parts[0])
	mi, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return false
	}
	return ma > major || (ma == major && mi >= minor)
}

func tableName(id uuid.UUID) string {
	return "emb_" + strings.ReplaceAll(id.String(), "-", "")
}

func columnType(p Profile) (string, error) {
	switch {
	case p.StorageType == "halfvec" && p.Dimensions >= 1 && p.Dimensions <= 4000:
		return "halfvec(" + strconv.Itoa(p.Dimensions) + ")", nil
	case p.StorageType == "vector" && p.Dimensions >= 1 && p.Dimensions <= 2000:
		return "vector(" + strconv.Itoa(p.Dimensions) + ")", nil
	}
	return "", fmt.Errorf("vectorstore: unsupported profile %s(%d)", p.StorageType, p.Dimensions)
}

// EnsureProfile creates the profile's table and indexes if missing. It is
// idempotent and safe to call concurrently.
func (s *PGVector) EnsureProfile(ctx context.Context, p Profile) error {
	col, err := columnType(p)
	if err != nil {
		return err
	}
	t := pgx.Identifier{tableName(p.ID)}.Sanitize()
	ops := p.StorageType + "_cosine_ops"
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		// Serialise DDL for this profile across workers.
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", tableName(p.ID)); err != nil {
			return err
		}
		stmts := []string{
			fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
				chunk_id  uuid PRIMARY KEY REFERENCES chunks (id) ON DELETE CASCADE,
				source_id uuid NOT NULL,
				embedding %s NOT NULL)`, t, col),
			fmt.Sprintf(`CREATE INDEX IF NOT EXISTS %s ON %s USING hnsw (embedding %s) WITH (m = 16, ef_construction = 64)`,
				pgx.Identifier{tableName(p.ID) + "_hnsw"}.Sanitize(), t, ops),
			fmt.Sprintf(`CREATE INDEX IF NOT EXISTS %s ON %s (source_id)`,
				pgx.Identifier{tableName(p.ID) + "_source"}.Sanitize(), t),
		}
		for _, stmt := range stmts {
			if _, err := tx.Exec(ctx, stmt); err != nil {
				return fmt.Errorf("ensure vector table: %w", err)
			}
		}
		return nil
	})
}

func literal(p Profile, v []float32) (string, error) {
	if len(v) != p.Dimensions {
		return "", fmt.Errorf("%w: got %d, expected %d", ErrDimensions, len(v), p.Dimensions)
	}
	if p.StorageType == "halfvec" {
		return pgvector.NewHalfVector(v).String(), nil
	}
	return pgvector.NewVector(v).String(), nil
}

// Upsert inserts or replaces vectors in one statement per batch.
func (s *PGVector) Upsert(ctx context.Context, tx pgx.Tx, p Profile, recs []Record) error {
	if len(recs) == 0 {
		return nil
	}
	col, err := columnType(p)
	if err != nil {
		return err
	}
	ids := make([]uuid.UUID, len(recs))
	sources := make([]uuid.UUID, len(recs))
	vecs := make([]string, len(recs))
	for i, r := range recs {
		if vecs[i], err = literal(p, r.Vector); err != nil {
			return err
		}
		ids[i], sources[i] = r.ChunkID, r.SourceID
	}
	q := fmt.Sprintf(`INSERT INTO %s (chunk_id, source_id, embedding)
		SELECT id, src, vec::%s FROM unnest($1::uuid[], $2::uuid[], $3::text[]) AS u(id, src, vec)
		ON CONFLICT (chunk_id) DO UPDATE SET source_id = EXCLUDED.source_id, embedding = EXCLUDED.embedding`,
		pgx.Identifier{tableName(p.ID)}.Sanitize(), col)
	_, err = tx.Exec(ctx, q, ids, sources, vecs)
	return err
}

// Search returns the k nearest chunks among the filter's sources, limited
// to documents matching f.Docs.
//
// Small filtered sets are searched exactly, joining chunks and documents in
// the same scan. Larger ones use the HNSW index: with pgvector >= 0.8 the
// scan is iterative (relaxed order) and the whole filter, including a
// correlated document check, is evaluated on the index scan node, so the
// scan keeps going until k rows match. Older pgvector over-fetches
// OverFetch x k source-scoped candidates and filters those.
func (s *PGVector) Search(ctx context.Context, p Profile, q []float32, f Filter, k int) ([]Hit, error) {
	if len(f.SourceIDs) == 0 {
		return nil, ErrNoSources
	}
	col, err := columnType(p)
	if err != nil {
		return nil, err
	}
	vec, err := literal(p, q)
	if err != nil {
		return nil, err
	}
	ef := s.EfSearch
	if ef <= 0 {
		ef = 400
	}
	ef = max(ef, k)
	threshold := s.ExactThreshold
	if threshold <= 0 {
		threshold = 100_000
	}
	exact := f.Estimated <= threshold
	table := pgx.Identifier{tableName(p.ID)}.Sanitize()
	docSQL, docArgs := f.Docs.SQL("d", 4)
	filtered := !f.Docs.IsZero()
	args := append([]any{vec, f.SourceIDs, k}, docArgs...)

	sql, settings := s.searchSQL(ctx, col, table, docSQL, exact, filtered)
	hits, err := s.runSearch(ctx, ef, settings, sql, args)
	if err != nil {
		if isUndefinedTable(err) { // nothing indexed yet
			return nil, nil
		}
		return nil, err
	}
	// relaxed_order may return results slightly out of order.
	sortHits(hits)
	return hits, nil
}

// searchSQL chooses the search query and the planner settings: an exact
// scan for small filtered sets, the HNSW index with an iterative scan, or
// (pgvector < 0.8) over-fetching then filtering.
func (s *PGVector) searchSQL(ctx context.Context, col, table, docSQL string, exact, filtered bool) (sql, settings string) {
	switch {
	case exact:
		// Bitmap scan on source_id, then sort; documents joined in the scan.
		settings = "SET LOCAL enable_indexscan = off"
		if filtered {
			sql = fmt.Sprintf(`SELECT e.chunk_id, e.embedding <=> $1::%s AS distance
				FROM %s e JOIN chunks c ON c.id = e.chunk_id JOIN documents d ON d.id = c.document_id
				WHERE e.source_id = ANY($2::uuid[]) AND %s
				ORDER BY distance LIMIT $3`, col, table, docSQL)
		} else {
			sql = fmt.Sprintf(`SELECT chunk_id, embedding <=> $1::%s AS distance
				FROM %s WHERE source_id = ANY($2::uuid[])
				ORDER BY distance LIMIT $3`, col, table)
		}
	case !filtered || s.iterativeScans(ctx):
		// Hide the filter from the source_id index (CASE) so the HNSW index
		// drives the scan; iterative scanning keeps returning rows until k
		// match. The document check is a correlated subquery on the same node.
		settings = "SET LOCAL enable_seqscan = off; SET LOCAL enable_bitmapscan = off"
		cond := "source_id = ANY($2::uuid[])"
		if filtered {
			// Postgres may run this once as a hashed subplan (the matching
			// chunk IDs), so it is scoped to the sources as well.
			cond += fmt.Sprintf(` AND EXISTS (SELECT 1 FROM chunks c JOIN documents d ON d.id = c.document_id
				WHERE c.id = e.chunk_id AND c.source_id = ANY($2::uuid[]) AND %s)`, docSQL)
		}
		sql = fmt.Sprintf(`SELECT e.chunk_id, e.embedding <=> $1::%s AS distance
			FROM %s e WHERE CASE WHEN %s THEN true END
			ORDER BY distance LIMIT $3`, col, table, cond)
	default:
		// pgvector < 0.8: over-fetch source-scoped candidates, then filter.
		settings = "SET LOCAL enable_seqscan = off; SET LOCAL enable_bitmapscan = off"
		sql = fmt.Sprintf(`SELECT cand.chunk_id, cand.distance FROM (
				SELECT chunk_id, embedding <=> $1::%s AS distance
				FROM %s WHERE CASE WHEN source_id = ANY($2::uuid[]) THEN true END
				ORDER BY distance LIMIT $3 * %d) cand
			JOIN chunks c ON c.id = cand.chunk_id JOIN documents d ON d.id = c.document_id
			WHERE %s
			ORDER BY cand.distance LIMIT $3`, col, table, OverFetch, docSQL)
	}
	return sql, settings
}

// runSearch runs the query with the HNSW search settings in a transaction.
func (s *PGVector) runSearch(ctx context.Context, ef int, settings, sql string, args []any) ([]Hit, error) {
	var hits []Hit
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT set_config('hnsw.ef_search', $1, true), set_config('hnsw.iterative_scan', 'relaxed_order', true)", strconv.Itoa(ef)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, settings); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		hits, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Hit, error) {
			var h Hit
			return h, r.Scan(&h.ChunkID, &h.Distance)
		})
		return err
	})
	return hits, err
}

func isUndefinedTable(err error) bool {
	var pgErr interface{ SQLState() string }
	return errors.As(err, &pgErr) && pgErr.SQLState() == "42P01"
}

// Distances implements Store.
func (s *PGVector) Distances(ctx context.Context, p Profile, q []float32, chunkIDs []uuid.UUID) (map[uuid.UUID]float64, error) {
	out := map[uuid.UUID]float64{}
	if len(chunkIDs) == 0 {
		return out, nil
	}
	col, err := columnType(p)
	if err != nil {
		return nil, err
	}
	vec, err := literal(p, q)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, fmt.Sprintf(`SELECT chunk_id, embedding <=> $1::%s FROM %s WHERE chunk_id = ANY($2::uuid[])`,
		col, pgx.Identifier{tableName(p.ID)}.Sanitize()), vec, chunkIDs)
	if err != nil {
		if isUndefinedTable(err) {
			return out, nil
		}
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var d float64
		if err := rows.Scan(&id, &d); err != nil {
			return nil, err
		}
		out[id] = d
	}
	return out, rows.Err()
}

func sortHits(h []Hit) {
	for i := 1; i < len(h); i++ {
		for j := i; j > 0 && h[j].Distance < h[j-1].Distance; j-- {
			h[j], h[j-1] = h[j-1], h[j]
		}
	}
}
