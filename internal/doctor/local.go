// Configuration, safety, warnings, and the in-cluster dependencies:
// Postgres, Valkey and object storage.

package doctor

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/app"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/preflight"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// configuration reports the production safety checks, then the rest of
// the validation of the mode's configuration.
func (r *runner) configuration() {
	safety := r.cfg.SafetyErrors(r.opts.Mode)
	seen := map[string]bool{}
	for _, e := range safety {
		seen[e.Error()] = true
		r.add(Check{Group: "safety", Name: "production", Status: Fail, Detail: e.Error()})
	}
	var other []error
	for _, e := range splitErrors(r.cfg.Validate(r.opts.Mode)) {
		if !seen[e.Error()] {
			other = append(other, e)
		}
	}
	for _, e := range other {
		r.add(Check{Group: "configuration", Name: r.opts.Mode, Status: Fail, Detail: e.Error()})
	}
	switch {
	case len(safety) == 0 && r.cfg.LoopbackAppURL():
		r.add(Check{Group: "safety", Name: "production", Status: Info,
			Detail: "APP_URL is loopback (" + r.cfg.AppURL + "): development install, production checks not applied"})
	case len(safety) == 0:
		r.add(Check{Group: "safety", Name: "production", Status: OK,
			Detail: "no example keys, DEV_AUTH off, APP_URL is https"})
	}
	if len(other) == 0 {
		r.add(Check{Group: "configuration", Name: r.opts.Mode, Status: OK, Detail: "valid for grounded " + r.opts.Mode})
	}
}

// warnings reports the production-readiness warnings; without a database
// only those that need no database.
func (r *runner) warnings(ctx context.Context, pool *pgxpool.Pool) {
	findings := preflight.ConfigFindings(r.cfg)
	if pool != nil {
		cctx, cancel := r.ctx(ctx)
		all, err := preflight.Check(cctx, r.cfg, dbgen.New(pool))
		cancel()
		if err != nil {
			r.add(Check{Group: "warnings", Name: "database", Status: Fail, Detail: err.Error()})
		} else {
			findings = all
		}
	}
	for _, f := range findings {
		st := Warn
		if f.Severity == preflight.Info {
			st = Info
		}
		r.add(Check{Group: "warnings", Name: f.Code, Status: st, Detail: f.Message, Fix: f.Fix})
	}
	if len(findings) == 0 {
		r.add(Check{Group: "warnings", Name: "none", Status: OK, Detail: "no production-readiness warnings"})
	}
}

// postgres connects and reports the server version, pgvector and the
// migration state. It returns the pool (nil when unavailable).
func (r *runner) postgres(ctx context.Context) *pgxpool.Pool {
	if r.cfg.DatabaseURL == "" {
		r.add(Check{Group: "postgres", Name: "connect", Status: Fail, Detail: "DATABASE_URL is not set"})
		return nil
	}
	cctx, cancel := r.ctx(ctx)
	defer cancel()
	start := time.Now()
	pool, err := store.Open(cctx, r.cfg.DatabaseURL)
	if err != nil {
		r.add(Check{Group: "postgres", Name: "connect", Status: Fail, Detail: err.Error(), DurationMs: millis(time.Since(start))})
		return nil
	}
	var version string
	err = pool.QueryRow(cctx, "SHOW server_version").Scan(&version)
	c := Check{Group: "postgres", Name: "connect", Status: OK, Detail: "PostgreSQL " + version, DurationMs: millis(time.Since(start))}
	if err != nil {
		c.Status, c.Detail = Fail, "server version: "+err.Error()
	}
	r.add(c)
	r.pgvector(cctx, pool)
	r.migrations(cctx, pool)
	return pool
}

func (r *runner) pgvector(ctx context.Context, pool *pgxpool.Pool) {
	var v string
	err := pool.QueryRow(ctx, "SELECT coalesce((SELECT extversion FROM pg_extension WHERE extname = 'vector'), '')").Scan(&v)
	switch {
	case err != nil:
		r.add(Check{Group: "postgres", Name: "pgvector", Status: Fail, Detail: err.Error()})
	case v == "":
		r.add(Check{Group: "postgres", Name: "pgvector", Status: Fail, Detail: "the vector extension is not installed",
			Fix: "Use a PostgreSQL image with pgvector (for example pgvector/pgvector:pg17) and run grounded migrate, which creates it"})
	default:
		r.add(Check{Group: "postgres", Name: "pgvector", Status: OK, Detail: "vector " + v})
	}
}

func (r *runner) migrations(ctx context.Context, pool *pgxpool.Pool) {
	st, err := store.Migrations(ctx, pool)
	c := Check{Group: "postgres", Name: "migrations", Status: OK}
	switch {
	case err != nil:
		c.Status, c.Detail = Fail, err.Error()
	case st.Pending:
		c.Status = Fail
		c.Detail = fmt.Sprintf("pending: the database is at version %d, this binary has %d", st.Current, st.Latest)
		c.Fix = "Run grounded migrate (on Kubernetes the init containers do this on every rollout)"
	case st.Current > st.Latest:
		c.Status = Warn
		c.Detail = fmt.Sprintf("the database (version %d) is newer than this binary (%d): an older binary during a rollout?", st.Current, st.Latest)
	default:
		c.Detail = fmt.Sprintf("current (version %d)", st.Current)
	}
	r.add(c)
}

// valkey connects and times a few PINGs.
func (r *runner) valkey(ctx context.Context) {
	if r.cfg.ValkeyURL == "" {
		r.add(Check{Group: "valkey", Name: "PING", Status: Fail, Detail: "VALKEY_URL is not set"})
		return
	}
	cctx, cancel := r.ctx(ctx)
	defer cancel()
	s, err := kv.Open(cctx, r.cfg.ValkeyURL, r.cfg.ValkeyPrefix)
	if err != nil {
		r.add(Check{Group: "valkey", Name: "PING", Status: Fail, Detail: err.Error()})
		return
	}
	defer s.Close()
	const n = 3
	start := time.Now()
	for range n {
		if err := s.Ping(cctx); err != nil {
			r.add(Check{Group: "valkey", Name: "PING", Status: Fail, Detail: err.Error()})
			return
		}
	}
	avg := time.Since(start) / n
	r.add(Check{Group: "valkey", Name: "PING", Status: OK, Detail: fmt.Sprintf("PONG (average of %d)", n), DurationMs: millis(avg)})
}

// storage writes, reads back and deletes a probe object.
func (r *runner) storage(ctx context.Context) {
	cctx, cancel := r.ctx(ctx)
	defer cancel()
	where := "fs " + r.cfg.BlobDir
	if r.cfg.BlobBackend == "s3" {
		where = fmt.Sprintf("s3 bucket %s at %s", r.cfg.S3.Bucket, r.cfg.S3.Endpoint)
	}
	fail := func(step string, err error) {
		r.add(Check{Group: "storage", Name: "probe object", Status: Fail, Detail: where + ": " + step + ": " + err.Error()})
	}
	start := time.Now()
	st, err := app.NewBlobStore(cctx, r.cfg)
	if err != nil {
		fail("open", err)
		return
	}
	payload := make([]byte, 32)
	_, _ = rand.Read(payload)
	key := "doctor/probe-" + hex.EncodeToString(payload[:8])
	if err := st.Put(cctx, key, bytes.NewReader(payload), int64(len(payload)), "application/octet-stream"); err != nil {
		fail("write", err)
		return
	}
	defer func() { _ = st.Delete(context.WithoutCancel(cctx), key) }()
	rc, err := st.Get(cctx, key)
	if err != nil {
		fail("read", err)
		return
	}
	got, err := io.ReadAll(rc)
	rc.Close()
	if err != nil || !bytes.Equal(got, payload) {
		fail("read", fmt.Errorf("the object read back differs (%v)", err))
		return
	}
	if err := st.Delete(cctx, key); err != nil {
		fail("delete", err)
		return
	}
	r.add(Check{Group: "storage", Name: "probe object", Status: OK, Detail: where + ": write, read and delete", DurationMs: millis(time.Since(start))})
}
