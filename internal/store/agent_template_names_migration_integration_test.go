package store_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/migrations"
)

// Template names are unique ignoring case for every script (#140, migration 00054), also in a cluster created with --locale=C, where the
// database's own lower() changes ASCII letters only: "qa über" and "QA ÜBER" were two templates and the picker showed two that look alike.
func TestTemplateNamesAreUniqueIgnoringUnicodeCase(t *testing.T) {
	pool, _ := testutil.NewDBInCLocale(t)
	ctx := context.Background()
	insert := func(name string) error {
		_, err := pool.Exec(ctx, `INSERT INTO agent_templates (name, config) VALUES ($1, '{}')`, name)
		return err
	}
	if err := insert("qa über"); err != nil {
		t.Fatal(err)
	}
	for _, dup := range []string{"QA ÜBER", "Qa Über", "qa über"} {
		if err := insert(dup); err == nil {
			t.Errorf("a second template named %q was saved next to %q", dup, "qa über")
		}
	}
	if err := insert("é"); err != nil {
		t.Fatal(err)
	}
	if err := insert("É"); err == nil {
		t.Error("é and É were both saved")
	}
	if _, err := pool.Exec(ctx, `UPDATE agent_templates SET name = 'ÖÖ' WHERE name = 'qa über'`); err != nil {
		t.Errorf("renaming to a free name: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE agent_templates SET name = 'É' WHERE name = 'é'`); err != nil {
		t.Errorf("a template may change the case of its own name: %v", err)
	}
	if err := insert("qa über"); err != nil {
		t.Errorf("a free name after the rename: %v", err)
	}
}

// A cluster that already holds names which differ only in case beyond ASCII is migrated without losing a template: the oldest keeps its
// name and each later one gets a numbered suffix (within the 80-character limit and clear of every name in use).
func TestTemplateNameMigrationRenamesExistingDuplicates(t *testing.T) {
	pool, _ := testutil.NewDBInCLocale(t)
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.DownTo(ctx, 53); err != nil {
		t.Fatalf("down to 53: %v", err)
	}
	long := strings.Repeat("é", 80)
	for i, name := range []string{"über é", "Über é", "über É", "über é (2)", long, strings.ToUpper(long), "Plain"} {
		// created_at decides who keeps the name.
		if _, err := pool.Exec(ctx, `INSERT INTO agent_templates (name, config, created_at) VALUES ($1, jsonb_build_object('n', $2::int), now() - make_interval(secs => 100 - $2::int))`, name, i); err != nil {
			t.Fatalf("insert %q: %v", name, err)
		}
	}
	if _, err := p.UpTo(ctx, 54); err != nil {
		t.Fatalf("up to 54: %v", err)
	}
	rows, err := pool.Query(ctx, `SELECT name, (config->>'n')::int FROM agent_templates ORDER BY (config->>'n')::int`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	seen := map[string]bool{}
	for rows.Next() {
		var name string
		var n int
		if err := rows.Scan(&name, &n); err != nil {
			t.Fatal(err)
		}
		if l := len([]rune(name)); l < 1 || l > 80 {
			t.Errorf("template %d is %d characters long", n, l)
		}
		if key := strings.ToLower(name); seen[key] {
			t.Errorf("%q is still taken twice", name)
		} else {
			seen[key] = true
		}
		got = append(got, name)
	}
	if len(got) != 7 {
		t.Fatalf("%d templates after the migration, want all 7: %q", len(got), got)
	}
	// The database's own lower() (the old index) cannot tell these apart, so they could all be saved; only Plain has no duplicate.
	want := map[int]string{0: "über é", 1: "Über é (3)", 2: "über É (4)", 3: "über é (2)", 4: long, 6: "Plain"}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("template %d = %q, want %q", i, got[i], w)
		}
	}
	if !strings.HasPrefix(got[5], "É") || !strings.HasSuffix(got[5], " (2)") {
		t.Errorf("the long duplicate = %q, want it cut and numbered", got[5])
	}
}
