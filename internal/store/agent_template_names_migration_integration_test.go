package store_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/migrations"
)

// Template names are unique ignoring case for every script (#140), also in a cluster created with --locale=C, where the database's own
// lower() changes ASCII letters only: "qa über" and "QA ÜBER" were two templates and the picker showed two that look alike.
//
// What this test asserts changed with #195. It used to expect the DATABASE to refuse the Unicode twin (a UNIQUE index in migration 00054).
// That is a tighter constraint shipped in the same release as the code, which ADR-0013 forbids: the previous release's pods know only
// agent_templates_name_key, so a violation of a new index was a 500 for their admins during a rollout. The rule is now enforced by the
// service under a lock (internal/agents, internal/httpapi: TestTemplateNamesUniqueUnderConcurrency...), and the database must NOT refuse
// the twin yet, so a v0.6.2 pod gets an ordinary answer. The uniqueness assertions moved there and are stricter (concurrent writers,
// renames, HTTP 409); this one pins the staging: the old index still catches what it always caught, there is a lookup index, and no
// unique index on the folded name exists until the later release adds it.
func TestMigration00054AddsNoStricterTemplateConstraint(t *testing.T) {
	pool, _ := testutil.NewDBInCLocale(t)
	ctx := context.Background()
	insert := func(name string) error {
		_, err := pool.Exec(ctx, `INSERT INTO agent_templates (name, config) VALUES ($1, '{}')`, name)
		return err
	}
	if err := insert("qa über"); err != nil {
		t.Fatal(err)
	}
	// What the previous release's index always refused (the database's lower(): ASCII only in this cluster) is still refused, under the
	// name that release's code recognises.
	err := insert("QA über")
	if !apperr.IsUniqueViolation(err, "agent_templates_name_key") {
		t.Errorf("an ASCII-case twin = %v, want a violation of agent_templates_name_key", err)
	}
	// A twin that differs beyond ASCII is accepted by the database: a violation of a new index would be unknown to the previous release.
	for _, twin := range []string{"QA ÜBER"} {
		if err := insert(twin); err != nil {
			t.Errorf("the database refused %q: a stricter constraint belongs to a later release (ADR-0013): %v", twin, err)
		}
	}
	if err := insert("é"); err != nil {
		t.Fatal(err)
	}
	if err := insert("É"); err != nil {
		t.Errorf("the database refused É next to é: %v", err)
	}
	var unique, plain int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE indisunique), count(*) FILTER (WHERE NOT indisunique)
		FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
		WHERE i.indrelid = 'agent_templates'::regclass AND pg_get_indexdef(i.indexrelid) LIKE '%und-x-icu%'`).Scan(&unique, &plain); err != nil {
		t.Fatal(err)
	}
	if unique != 0 || plain != 1 {
		t.Errorf("folded-name indexes: %d unique, %d plain; want no unique one and the lookup index", unique, plain)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM pg_indexes WHERE tablename = 'agent_templates' AND indexname = 'agent_templates_name_fold_idx'`); n != 1 {
		t.Errorf("agent_templates_name_fold_idx exists %d times", n)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM pg_indexes WHERE tablename = 'agent_templates' AND indexname = 'agent_templates_name_key'`); n != 1 {
		t.Errorf("the previous release's index agent_templates_name_key must stay until a contract release: %d", n)
	}
}

func countRows(t *testing.T, pool *pgxpool.Pool, query string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), query).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
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
