package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgvector "github.com/pgvector/pgvector-go"
)

func openPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	if dsn == "" {
		return nil, errors.New("set -dsn or $BENCH_DATABASE_URL (the benchmark instance's database)")
	}
	return pgxpool.New(ctx, dsn)
}

func stripDashes(id string) string { return strings.ReplaceAll(id, "-", "") }

// exactDocs returns document filenames (as BEIR IDs) of the nearest chunks in
// one source, by exact search: the source_id index is read and the rows are
// sorted, as Grounded does for KBs under VECTOR_EXACT_THRESHOLD.
func exactDocs(ctx context.Context, pool *pgxpool.Pool, table, sourceID string, q []float32, limit int) ([]string, error) {
	var out []string
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET LOCAL enable_indexscan = off"); err != nil {
			return err
		}
		sql := fmt.Sprintf(`SELECT d.filename FROM (
			SELECT chunk_id, embedding <=> $1::halfvec(%d) AS dist FROM %s
			WHERE source_id = $2 ORDER BY dist LIMIT $3) e
			JOIN chunks c ON c.id = e.chunk_id JOIN documents d ON d.id = c.document_id
			ORDER BY e.dist`, len(q), pgx.Identifier{table}.Sanitize())
		rows, err := tx.Query(ctx, sql, pgvector.NewHalfVector(q).String(), sourceID, limit)
		if err != nil {
			return err
		}
		names, err := pgx.CollectRows(rows, pgx.RowTo[string])
		for _, n := range names {
			out = append(out, docIDFromFilename(n))
		}
		return err
	})
	return out, err
}

// vectorLine is the JSONL format shared with vecbench -query-vectors.
type vectorLine struct {
	ID     string    `json:"id"`
	Vector []float32 `json:"vector"`
}

func writeVectors(path string, queries []beirQuery, vecs [][]float32) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	enc := json.NewEncoder(w)
	for i, q := range queries {
		if err := enc.Encode(vectorLine{ID: q.ID, Vector: vecs[i]}); err != nil {
			f.Close()
			return err
		}
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func cmdStats(args []string) error {
	fset := flag.NewFlagSet("stats", flag.ExitOnError)
	var c commonFlags
	c.register(fset)
	dsn := fset.String("dsn", os.Getenv("BENCH_DATABASE_URL"), "Grounded database URL (read-only use)")
	blobDir := fset.String("blob-dir", "/tmp/ragbench/blobs", "Grounded BLOB_DIR (fs backend)")
	fset.Usage = func() {
		fmt.Fprintln(fset.Output(), "usage: ragbench stats [flags]\n\nPrints document states, chunk and token totals, ingest timing (first upload\nto last document processed), embedding tokens from the usage ledger, and\ndatabase, table and blob sizes.")
		fset.PrintDefaults()
	}
	_ = fset.Parse(args)
	st, err := loadState(c.state)
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := openPool(ctx, *dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := printDocumentStats(ctx, pool, st.SourceID); err != nil {
		return err
	}
	if err := printStorageStats(ctx, pool, "emb_"+stripDashes(st.ProfileID), *blobDir); err != nil {
		return err
	}
	if !st.UploadStart.IsZero() {
		fmt.Printf("upload API: %d documents in %s\n", st.Uploaded, st.UploadEnd.Sub(st.UploadStart).Round(time.Millisecond))
	}
	return nil
}

// printDocumentStats prints document states, ingest totals and timing, and
// embedding tokens from the usage ledger.
func printDocumentStats(ctx context.Context, pool *pgxpool.Pool, sourceID string) error {
	rows, err := pool.Query(ctx, `SELECT status, coalesce(nullif(error_code, ''), '-'), count(*) FROM documents WHERE source_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, sourceID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var status, code string
		var n int64
		if err := rows.Scan(&status, &code, &n); err != nil {
			return err
		}
		fmt.Printf("documents %-10s %-20s %d\n", status, code, n)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	var docs, chunks, tokens, bytes int64
	var first, last time.Time
	if err := pool.QueryRow(ctx, `SELECT count(*), coalesce(sum(chunk_count), 0), coalesce(sum(token_count), 0), coalesce(sum(size_bytes), 0),
		min(created_at), max(processed_at) FROM documents WHERE source_id = $1 AND status = 'ready'`, sourceID).
		Scan(&docs, &chunks, &tokens, &bytes, &first, &last); err != nil {
		return err
	}
	el := last.Sub(first)
	fmt.Printf("ready: %d documents, %d chunks (%.2f/doc), %d chunk tokens, %.1f MiB of originals\n",
		docs, chunks, float64(chunks)/float64(max(docs, 1)), tokens, float64(bytes)/(1<<20))
	fmt.Printf("first upload -> last ready: %s (%.1f docs/min, %.1f chunks/min)\n", el.Round(time.Second),
		float64(docs)/el.Minutes(), float64(chunks)/el.Minutes())
	var embedTokens, embedEvents int64
	if err := pool.QueryRow(ctx, `SELECT coalesce(sum(quantity), 0), count(*) FROM usage_events WHERE kind = 'embed_tokens' AND source_id = $1`, sourceID).Scan(&embedTokens, &embedEvents); err != nil {
		return err
	}
	fmt.Printf("usage ledger: %d embed tokens over %d documents (gateway-reported)\n", embedTokens, embedEvents)
	var p50, p95, pmax float64
	if err := pool.QueryRow(ctx, `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s), percentile_cont(0.95) WITHIN GROUP (ORDER BY s), max(s)
		FROM (SELECT extract(epoch FROM processed_at - created_at) s FROM documents WHERE source_id = $1 AND status = 'ready') x`, sourceID).Scan(&p50, &p95, &pmax); err != nil {
		return err
	}
	fmt.Printf("upload -> ready per document: p50=%.0fs p95=%.0fs max=%.0fs (includes queueing)\n", p50, p95, pmax)
	return nil
}

// printStorageStats prints table, database and blob sizes.
func printStorageStats(ctx context.Context, pool *pgxpool.Pool, table, blobDir string) error {
	for _, t := range []string{"documents", "chunks", table, "usage_events", "river_job"} {
		var total, idx int64
		var n int64
		if err := pool.QueryRow(ctx, `SELECT pg_total_relation_size($1::regclass), pg_indexes_size($1::regclass)`, t).Scan(&total, &idx); err != nil {
			return fmt.Errorf("%s: %w", t, err)
		}
		_ = pool.QueryRow(ctx, "SELECT count(*) FROM "+pgx.Identifier{t}.Sanitize()).Scan(&n)
		fmt.Printf("table %-40s rows=%-8d total=%7.1f MiB (indexes %6.1f MiB)\n", t, n, float64(total)/(1<<20), float64(idx)/(1<<20))
	}
	var dbSize int64
	if err := pool.QueryRow(ctx, "SELECT pg_database_size(current_database())").Scan(&dbSize); err != nil {
		return err
	}
	fmt.Printf("database total: %.1f MiB\n", float64(dbSize)/(1<<20))
	if blobDir != "" {
		var size, files int64
		err := filepath.WalkDir(blobDir, func(_ string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			info, err := d.Info()
			if err == nil {
				size += info.Size()
				files++
			}
			return err
		})
		if err != nil {
			return err
		}
		fmt.Printf("blobs: %d files, %.1f MiB in %s\n", files, float64(size)/(1<<20), blobDir)
	}
	return nil
}
