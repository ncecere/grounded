package testutil

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/migrations"
)

// The template database: one migrated database per schema, which every test's
// database is copied from. Migrating a new database takes several hundred
// statements; copying one takes a fraction of that, and most integration tests
// create a database each.
//
// Its name carries a fingerprint of the migrations, so a checkout with other
// migrations (another branch, another worktree) has its own template and never
// reads a stale one. Test binaries run in parallel, one process per package, so
// building it is serialised by an advisory lock on the server. Nothing can
// connect to a finished template, which is what copying it requires.

const (
	templatePrefix = "grounded_test_tmpl_"
	// templateLockKey serialises building the template across test processes ("gtmp").
	templateLockKey int64 = 0x67746d70
	// templatesKept is how many templates of other schemas stay on the server
	// when a new one is built: enough for the branches being worked on at once.
	templatesKept = 3
	// busyWait bounds the retries while the server still counts a session that
	// has just closed against the database.
	busyWait = 10 * time.Second
)

var template struct {
	once sync.Once
	name string
	err  error
}

// templateDB returns the name of the migrated template, building it when this
// schema has none yet. A test process asks the server once.
func templateDB(adminURL string) (string, error) {
	template.once.Do(func() {
		template.name, template.err = ensureTemplate(context.Background(), adminURL)
	})
	return template.name, template.err
}

func ensureTemplate(ctx context.Context, adminURL string) (string, error) {
	sum, err := schemaFingerprint()
	if err != nil {
		return "", err
	}
	name := templatePrefix + sum
	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		return "", fmt.Errorf("connect admin db: %w", err)
	}
	defer admin.Close(ctx)
	// The session lock goes with the connection, so a process that dies while
	// building does not block the others.
	if _, err := admin.Exec(ctx, "SELECT pg_advisory_lock($1)", templateLockKey); err != nil {
		return "", fmt.Errorf("template lock: %w", err)
	}
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&exists); err != nil {
		return "", err
	}
	if exists {
		return name, nil
	}
	if err := buildTemplate(ctx, admin, adminURL, name); err != nil {
		return "", err
	}
	pruneTemplates(ctx, admin, name)
	return name, nil
}

// buildTemplate migrates a database under a temporary name and renames it when
// it is complete, so a template that exists is always whole.
func buildTemplate(ctx context.Context, admin *pgx.Conn, adminURL, name string) error {
	building := name + "_b" + randomSuffix()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+building); err != nil {
		return fmt.Errorf("create template: %w", err)
	}
	err := migrateTemplate(ctx, adminURL, building)
	if err == nil {
		_, err = admin.Exec(ctx, "ALTER DATABASE "+building+" WITH ALLOW_CONNECTIONS false")
	}
	if err == nil {
		err = whileBusy(ctx, func() error {
			_, err := admin.Exec(ctx, "ALTER DATABASE "+building+" RENAME TO "+name)
			return err
		})
	}
	if err != nil {
		_, _ = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+building+" WITH (FORCE)")
		return fmt.Errorf("build template: %w", err)
	}
	return nil
}

func migrateTemplate(ctx context.Context, adminURL, name string) error {
	dbURL, err := databaseURL(adminURL, name)
	if err != nil {
		return err
	}
	pool, err := store.Open(ctx, dbURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	return store.Migrate(ctx, pool, Logger())
}

// pruneTemplates drops the oldest templates of other schemas, and what a build
// that died left behind. Errors are ignored: a template that is being copied or
// built is in use and stays.
func pruneTemplates(ctx context.Context, admin *pgx.Conn, keep string) {
	rows, err := admin.Query(ctx,
		"SELECT datname FROM pg_database WHERE datname LIKE $1 AND datname <> $2 ORDER BY oid DESC OFFSET $3",
		templatePrefix+"%", keep, templatesKept)
	if err != nil {
		return
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return
	}
	for _, n := range names {
		_, _ = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{n}.Sanitize())
	}
}

// createDatabase runs CREATE DATABASE, waiting out a template the server still
// counts as in use.
func createDatabase(ctx context.Context, admin *pgx.Conn, name, options string) error {
	return whileBusy(ctx, func() error {
		_, err := admin.Exec(ctx, "CREATE DATABASE "+name+options)
		return err
	})
}

// whileBusy retries fn while it fails with object_in_use (55006): a session on
// the database has closed but its backend has not exited yet.
func whileBusy(ctx context.Context, fn func() error) error {
	deadline := time.Now().Add(busyWait)
	for {
		err := fn()
		var pgErr *pgconn.PgError
		if err == nil || !errors.As(err, &pgErr) || pgErr.Code != "55006" || time.Now().After(deadline) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
}

// schemaFingerprint identifies what store.Migrate would apply: the application
// migrations and the job queue's own.
func schemaFingerprint() (string, error) {
	h := sha256.New()
	err := fs.WalkDir(migrations.FS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(migrations.FS, path)
		if err != nil {
			return err
		}
		fmt.Fprintf(h, "%s\x00%d\x00", path, len(b))
		h.Write(b)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("read migrations: %w", err)
	}
	migrator, err := rivermigrate.New(riverpgxv5.New(nil), &rivermigrate.Config{Logger: Logger()})
	if err != nil {
		return "", fmt.Errorf("river migrator: %w", err)
	}
	for _, m := range migrator.AllVersions() {
		fmt.Fprintf(h, "river\x00%d\x00%d\x00%s", m.Version, len(m.SQLUp), m.SQLUp)
	}
	return hex.EncodeToString(h.Sum(nil))[:16], nil
}
