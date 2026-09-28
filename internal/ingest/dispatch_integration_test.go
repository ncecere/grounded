package ingest_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/testutil"
)

// A team with a large backlog must not starve a team with a few documents.
func TestPickFairSharesAcrossTeams(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	conn, model, prof := uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, conn)
	exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions) VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, model, conn)
	exec(`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap) VALUES ($1, 'p', 'P', $2, 4, 'halfvec', 512, 0)`, prof, model)

	teamDocs := map[string]int{"big": 50, "small": 2, "mid": 5}
	teams := map[uuid.UUID]string{}
	for name, n := range teamDocs {
		team, src := uuid.New(), uuid.New()
		teams[team] = name
		exec(`INSERT INTO teams (id, slug, name, max_classification) VALUES ($1, $2, $2, 'open')`, team, name)
		exec(`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, 's', 'upload', 'open', $3)`, src, team, prof)
		for i := 0; i < n; i++ {
			exec(`INSERT INTO documents (source_id, team_id, external_id, updated_at) VALUES ($1, $2, $3, now() - make_interval(secs => $4))`, src, team, fmt.Sprintf("d%d", i), 1000-i)
		}
	}
	// Platform-shared sources (team_id NULL) are their own "platform" bucket.
	shared := uuid.New()
	exec(`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, NULL, 'shared', 'upload', 'open', $2)`, shared, prof)
	for i := 0; i < 20; i++ {
		exec(`INSERT INTO documents (source_id, team_id, external_id, updated_at) VALUES ($1, NULL, $2, now() - make_interval(secs => $3))`, shared, fmt.Sprintf("p%d", i), 2000-i)
	}
	// "mid" already has 2 documents in flight.
	exec(`UPDATE documents SET status = 'processing' WHERE id IN (SELECT d.id FROM documents d JOIN teams t ON t.id = d.team_id WHERE t.slug = 'mid' LIMIT 2)`)

	var ceiling *int64
	pick := func(perTeam, limit int) map[string]int {
		counts := map[string]int{}
		err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			def := int64(perTeam)
			ids, err := ingest.PickFair(ctx, tx, ingest.TeamCap{Default: &def, Ceiling: ceiling}, limit)
			if err != nil {
				return err
			}
			for _, id := range ids {
				var team uuid.NullUUID
				if err := tx.QueryRow(ctx, `SELECT team_id FROM documents WHERE id = $1`, id).Scan(&team); err != nil {
					return err
				}
				if !team.Valid {
					counts["platform"]++
				} else {
					counts[teams[team.UUID]]++
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return counts
	}

	// Round-robin: with 8 slots every bucket gets a turn before "big" or the
	// platform (whose documents are oldest) get more.
	got := pick(4, 8)
	if got["small"] != 2 || got["mid"] < 1 || got["big"] > 3 || got["platform"] < 1 || got["platform"] > 3 {
		t.Fatalf("pick(4,8) = %v", got)
	}
	// Per-team cap counts documents already in flight ("mid" has 2 of 3);
	// the platform bucket has the same cap.
	got = pick(3, 100)
	if got["big"] != 3 || got["small"] != 2 || got["mid"] != 1 || got["platform"] != 3 {
		t.Fatalf("pick(3,100) = %v", got)
	}
	// Platform documents in flight count against the platform cap only.
	exec(`UPDATE documents SET status = 'queued' WHERE id IN (SELECT id FROM documents WHERE team_id IS NULL ORDER BY updated_at LIMIT 2)`)
	got = pick(3, 100)
	if got["platform"] != 1 || got["big"] != 3 {
		t.Fatalf("after platform in flight: %v", got)
	}
	// Paused shared sources wait.
	exec(`UPDATE data_sources SET status = 'paused' WHERE id = $1`, shared)
	if got = pick(3, 100); got["platform"] != 0 {
		t.Fatalf("paused shared source dispatched: %v", got)
	}

	// Team overrides of concurrent_ingest_jobs (team_limits): "big" may
	// have 6 in flight, "small" is blocked (0).
	exec(`INSERT INTO team_limits (team_id, overrides) SELECT id, '{"concurrent_ingest_jobs": 6}' FROM teams WHERE slug = 'big'`)
	exec(`INSERT INTO team_limits (team_id, overrides) SELECT id, '{"concurrent_ingest_jobs": 0}' FROM teams WHERE slug = 'small'`)
	if got = pick(3, 100); got["big"] != 6 || got["small"] != 0 || got["mid"] != 1 {
		t.Fatalf("with overrides: %v", got)
	}
	// The platform ceiling caps overrides.
	five := int64(5)
	ceiling = &five
	if got = pick(3, 100); got["big"] != 5 {
		t.Fatalf("with ceiling 5: %v", got)
	}
}
