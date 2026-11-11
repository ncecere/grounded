package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/migrations"
)

// Migration 00070 (ADR-0035): the database no longer lists the source types. A source and a classification level accept
// any well-formed type key, and still refuse a malformed one and an empty list. The two types the previous release
// writes stay valid, and the migration goes down and up again while they are the only ones.
func TestMigration00070OpensSourceTypes(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	var profile string
	if err := pool.QueryRow(ctx, `WITH c AS (INSERT INTO model_connections (name, base_url) VALUES ('m70', 'http://x/v1') RETURNING id),
		m AS (INSERT INTO models (connection_id, key, upstream_model, display_name, kind, max_classification, dimensions)
			SELECT id, 'm70', 'e', 'E', 'embedding', 'open', 8 FROM c RETURNING id)
		INSERT INTO embedding_profiles (key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap)
		SELECT 'm70', 'M70', id, 8, 'halfvec', 512, 0 FROM m RETURNING id::text`).Scan(&profile); err != nil {
		t.Fatal(err)
	}
	insert := func(name, typ string) error {
		_, err := pool.Exec(ctx, `INSERT INTO data_sources (name, type, classification, embedding_profile_id)
			VALUES ($1, $2, 'open', $3::uuid)`, name, typ, profile)
		return err
	}
	for _, typ := range []string{"upload", "web", "sharepoint", "google_drive"} {
		if err := insert("m70 "+typ, typ); err != nil {
			t.Errorf("a source of type %q: %v", typ, err)
		}
	}
	for _, typ := range []string{"", "Share Point", "9lives", "a", "drop;table"} {
		if err := insert("m70 bad "+typ, typ); err == nil {
			t.Errorf("a source of the malformed type %q was accepted", typ)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE classification_levels SET allowed_source_types = '{upload,web,sharepoint}'`); err != nil {
		t.Errorf("a level allowing a new type: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE classification_levels SET allowed_source_types = '{}'`); err == nil {
		t.Error("a level allowing no type was accepted")
	}
	var on bool
	if err := pool.QueryRow(ctx, `INSERT INTO source_type_settings (type, enabled) VALUES ('sharepoint', true) RETURNING enabled`).Scan(&on); err != nil || !on {
		t.Errorf("a type's switch: %v %v", on, err)
	}

	// Down and up again, as an install that only ever had the two types.
	if _, err := pool.Exec(ctx, `DELETE FROM data_sources WHERE type NOT IN ('upload', 'web');
		UPDATE classification_levels SET allowed_source_types = '{upload,web}'`); err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.DownTo(ctx, 69); err != nil {
		t.Fatalf("down: %v", err)
	}
	if err := insert("m70 after down", "sharepoint"); err == nil {
		t.Error("after going down, the list of types is back")
	}
	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("up again: %v", err)
	}
	if err := insert("m70 after up", "sharepoint"); err != nil {
		t.Errorf("after going up again: %v", err)
	}
}
