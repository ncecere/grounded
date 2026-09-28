package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/migrations"
)

// Migration 00018 turns moderation models with the System One provider into
// SystemOne models (ADR-0020); other moderation models and the policies
// that reference the migrated model are unchanged.
func TestSystemOneMigrationConvertsModerationModels(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.DownTo(ctx, 17); err != nil {
		t.Fatalf("down to 17: %v", err)
	}
	var conn string
	if err := pool.QueryRow(ctx, `INSERT INTO model_connections (name, base_url) VALUES ('judge', 'https://judge.example.edu') RETURNING id`).Scan(&conn); err != nil {
		t.Fatal(err)
	}
	var judge, guard string
	for _, m := range []struct {
		key, provider string
		id            *string
	}{{"jev", "system_one", &judge}, {"guard", "moderations_endpoint", &guard}} {
		if err := pool.QueryRow(ctx, `INSERT INTO models (connection_id, key, upstream_model, display_name, kind, max_classification, moderation_provider)
			VALUES ($1, $2, $2, $2, 'moderation', (SELECT key FROM classification_levels ORDER BY rank LIMIT 1), $3) RETURNING id`, conn, m.key, m.provider).Scan(m.id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO moderation_policies (audience, model_id, policy) VALUES ('team', $1, '{}')`, judge); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 18); err != nil {
		t.Fatalf("up to 18: %v", err)
	}
	kind := func(id string) (k string, provider *string) {
		if err := pool.QueryRow(ctx, `SELECT kind, moderation_provider FROM models WHERE id = $1`, id).Scan(&k, &provider); err != nil {
			t.Fatal(err)
		}
		return k, provider
	}
	if k, prov := kind(judge); k != "systemone" || prov != nil {
		t.Errorf("System One moderation model = %s %v, want systemone without a provider", k, prov)
	}
	if k, prov := kind(guard); k != "moderation" || prov == nil || *prov != "moderations_endpoint" {
		t.Errorf("other moderation model changed: %s %v", k, prov)
	}
	var policyModel string
	if err := pool.QueryRow(ctx, `SELECT model_id FROM moderation_policies WHERE audience = 'team'`).Scan(&policyModel); err != nil || policyModel != judge {
		t.Errorf("policy provider = %s %v", policyModel, err)
	}
	var maxConc int
	if err := pool.QueryRow(ctx, `SELECT max_concurrent_requests FROM model_connections WHERE id = $1`, conn).Scan(&maxConc); err != nil || maxConc != 8 {
		t.Errorf("max_concurrent_requests = %d %v, want the default 8", maxConc, err)
	}
}
