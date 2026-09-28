package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// allowlistSeedKey marks, in bootstrap_state, that CRAWL_ALLOWLIST_SEED has
// been applied.
const allowlistSeedKey = "crawl_allowlist_seed"

// seedNote is the note stored with seeded patterns.
const seedNote = "Added from CRAWL_ALLOWLIST_SEED on first start"

// SeedAllowlist adds the configured patterns (CRAWL_ALLOWLIST_SEED) to the
// platform allowlist once: the first start with a non-empty seed records
// that it ran, and later starts do nothing, even if every pattern has since
// been deleted. Patterns already on the allowlist are skipped. Each addition
// is audited as a system action. Safe to call from several processes at once.
// It reports how many patterns it added.
func SeedAllowlist(ctx context.Context, pool *pgxpool.Pool, patterns []string, log *slog.Logger) (int, error) {
	if len(patterns) == 0 {
		return 0, nil
	}
	normalized := make([]string, 0, len(patterns))
	for _, p := range patterns {
		n, err := NormalizePattern(p, true)
		if err != nil {
			return 0, fmt.Errorf("CRAWL_ALLOWLIST_SEED: invalid pattern %q", p)
		}
		normalized = append(normalized, n)
	}
	details, err := json.Marshal(map[string]any{"patterns": normalized})
	if err != nil {
		return 0, err
	}
	added := 0
	err = store.InTx(ctx, pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		added = 0
		// The primary key serialises concurrent starts: the second insert
		// waits for the first transaction, then finds the row.
		n, err := q.InsertBootstrapState(ctx, dbgen.InsertBootstrapStateParams{Key: allowlistSeedKey, Details: details})
		if err != nil || n == 0 {
			return err
		}
		for _, p := range normalized {
			row, err := q.SeedAllowlist(ctx, dbgen.SeedAllowlistParams{Pattern: p, Note: seedNote})
			if errors.Is(err, pgx.ErrNoRows) {
				continue // already on the allowlist
			} else if err != nil {
				return err
			}
			added++
			if err := audit.Record(ctx, q, audit.Entry{
				ActorKind: audit.ActorSystem, Action: "crawl.allowlist_seed", TargetType: "crawl_allowlist", TargetID: row.ID.String(),
				After: allowSnapshot(row), Metadata: map[string]any{"source": "CRAWL_ALLOWLIST_SEED"},
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("seed crawl allowlist: %w", err)
	}
	if added > 0 && log != nil {
		log.Info("crawl allowlist seeded", "patterns", added)
	}
	return added, nil
}
