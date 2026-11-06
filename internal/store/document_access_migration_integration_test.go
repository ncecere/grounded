package store_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/testutil"
)

// Migration 00068's trigger: a new document of a source restricted by hand gets the source's restriction, a document
// that brings its own keeps it, and either marks the source as having restricted documents (which search relies on).
func TestDocumentAccessTrigger(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := t.Context()
	var conn, model, team, profile, source string
	for _, s := range []struct {
		q    string
		args []any
		out  *string
	}{
		{`INSERT INTO model_connections (name, base_url) VALUES ('c', 'http://x/v1') RETURNING id`, nil, &conn},
		{`INSERT INTO models (connection_id, key, upstream_model, display_name, kind, max_classification, dimensions)
			VALUES ($1, 'e', 'e', 'E', 'embedding', 'open', 4) RETURNING id`, []any{&conn}, &model},
		{`INSERT INTO embedding_profiles (key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap)
			VALUES ('p', 'P', $1, 4, 'halfvec', 512, 0) RETURNING id`, []any{&model}, &profile},
		{`INSERT INTO teams (slug, name, max_classification) VALUES ('t-acl', 'T', 'restricted') RETURNING id`, nil, &team},
		{`INSERT INTO data_sources (team_id, name, type, classification, embedding_profile_id)
			VALUES ($1, 'HR', 'upload', 'open', $2) RETURNING id`, []any{&team, &profile}, &source},
	} {
		args := make([]any, len(s.args))
		for i, a := range s.args {
			args[i] = *(a.(*string))
		}
		if err := pool.QueryRow(ctx, s.q, args...).Scan(s.out); err != nil {
			t.Fatalf("%s: %v", s.q, err)
		}
	}
	doc := func(name string, acl any) (out []string) {
		t.Helper()
		if err := pool.QueryRow(ctx, `INSERT INTO documents (source_id, external_id, title, acl_principals) VALUES ($1, $2, $2, $3)
			RETURNING acl_principals`, source, name, acl).Scan(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	flag := func() (b bool) {
		_ = pool.QueryRow(ctx, `SELECT restricted_documents FROM data_sources WHERE id = $1`, source).Scan(&b)
		return b
	}
	if got := doc("open", nil); got != nil || flag() {
		t.Fatalf("a document of an unrestricted source = %v, marked %v", got, flag())
	}
	if _, err := pool.Exec(ctx, `UPDATE data_sources SET acl_principals = '{group:hr}' WHERE id = $1`, source); err != nil {
		t.Fatal(err)
	}
	if got := doc("inherits", nil); len(got) != 1 || got[0] != "group:hr" || !flag() {
		t.Fatalf("a new document of a restricted source = %v, marked %v", got, flag())
	}
	if got := doc("own", []string{"user:x"}); len(got) != 1 || got[0] != "user:x" {
		t.Fatalf("a document with its own permissions = %v", got)
	}
	var valid bool
	if err := pool.QueryRow(ctx, `SELECT indisvalid FROM pg_index WHERE indexrelid = 'documents_acl_principals_idx'::regclass`).Scan(&valid); err != nil || !valid {
		t.Fatalf("documents_acl_principals_idx valid = %v (%v)", valid, err)
	}
}
