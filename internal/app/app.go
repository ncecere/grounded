// Package app wires dependencies together and runs one process mode.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/buildinfo"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/web"
)

// Modes.
const (
	ModeServe   = "serve"   // api + worker in one process (local development)
	ModeAPI     = "api"     // HTTP API and embedded UI
	ModeWorker  = "worker"  // background jobs, plus health/metrics listener
	ModeMigrate = "migrate" // apply migrations and exit
)

// dbConnectWait is how long a process waits for Postgres at start-up.
const dbConnectWait = 3 * time.Minute

// Run starts the given mode and blocks until ctx is cancelled (or the mode
// completes, for migrate). A second signal is not needed: shutdown is bounded
// by SHUTDOWN_TIMEOUT.
func Run(ctx context.Context, mode string, cfg config.Config, log *slog.Logger) error {
	if err := cfg.Validate(mode); err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	log = log.With("mode", mode)
	log.Info("starting", "version", buildinfo.Version, "commit", buildinfo.Commit)
	if mode != ModeMigrate {
		defer startTracing(ctx, cfg.Tracing, mode, log)()
	}

	pool, err := store.OpenWait(ctx, cfg.DatabaseURL, dbConnectWait, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	if mode == ModeMigrate || cfg.MigrateOnStart {
		if err := store.Migrate(ctx, pool, log); err != nil {
			return err
		}
		if mode == ModeMigrate {
			log.Info("migrations complete")
			return nil
		}
	}
	if err := SeedFirstRun(ctx, cfg, pool, log); err != nil {
		return err
	}
	logPreflight(ctx, cfg, pool, log)

	kvs, err := kv.Open(ctx, cfg.ValkeyURL, cfg.ValkeyPrefix)
	if err != nil {
		return err
	}
	defer kvs.Close()

	inserter, err := jobs.NewInsertOnly(pool, log)
	if err != nil {
		return fmt.Errorf("job client: %w", err)
	}
	svc, err := NewServices(ctx, cfg, pool, inserter, kvs, log)
	if err != nil {
		return err
	}
	defer svc.Close()

	metrics := observability.NewMetrics()
	metrics.Register(svc.RetentionMetrics.Collectors()...)
	registerProcessMetrics(metrics, mode, pool, log)
	svc.Limits.OnBackendError = metrics.RateLimitErrors.Inc
	svc.Public.Guard.OnBackendError = metrics.RateLimitErrors.Inc
	health := httpapi.NewHealth(map[string]func(context.Context) error{
		"postgres": pool.Ping,
		"valkey":   kvs.Ping,
		"storage":  svc.Blob.Ping,
	})
	deps := httpapi.Deps{
		Config: cfg, Pool: pool, KV: kvs, Metrics: metrics, Health: health, Log: log,
		Teams: svc.Teams, Platform: svc.Platform, Catalog: svc.Catalog,
		Sources: svc.Sources, WebSources: svc.Web, KBs: svc.KBs, APIKeys: svc.APIKeys, Limits: svc.Limits, Costs: svc.Costs,
		Agents: svc.Agents, Notify: svc.Notify, Moderation: svc.Moderation, SystemOne: svc.SystemOne, OCR: svc.OCR, Public: svc.Public,
		Rerank:     svc.Rerank,
		Retention:  svc.Retention,
		BreakGlass: svc.BreakGlass,
	}
	deps.ProfileMigrations, deps.Evaluations, deps.MCP, deps.OAuth = svc.ProfileMigrations, svc.Evaluations, svc.MCP, svc.OAuth

	worker, err := startWorker(ctx, mode, cfg, pool, svc, log)
	if err != nil {
		return err
	}
	addr, handler := httpHandler(mode, cfg, deps, log)
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// No WriteTimeout: chat responses stream over SSE. Handlers bound
		// their own work with contexts.
		BaseContext: func(net.Listener) context.Context { return context.WithoutCancel(ctx) },
	}
	servers := []*http.Server{srv}
	if mode != ModeWorker && cfg.MetricsAddr != "" {
		ops := &http.Server{Addr: cfg.MetricsAddr, Handler: httpapi.NewOpsHandler(deps), ReadHeaderTimeout: 10 * time.Second}
		go func() {
			log.Info("metrics listening", "addr", ops.Addr)
			if err := ops.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Error("metrics listener", "err", err)
			}
		}()
		servers = append(servers, ops)
	}
	if err := serve(ctx, srv, log); err != nil {
		return err
	}
	return shutdown(cfg, log, health, worker, servers...)
}

// startWorker starts the job worker in the serve and worker modes (nil in
// the others).
func startWorker(ctx context.Context, mode string, cfg config.Config, pool *pgxpool.Pool, svc *Services, log *slog.Logger) (*jobs.Client, error) {
	if mode != ModeServe && mode != ModeWorker {
		return nil, nil
	}
	reg, err := IngestRegistration(cfg, pool, svc, log)
	if err != nil {
		return nil, err
	}
	worker, err := jobs.NewWorker(pool, log, cfg.WorkerConcurrency, reg)
	if err != nil {
		return nil, fmt.Errorf("job worker: %w", err)
	}
	// Not ctx: cancelling the start context would cancel running jobs
	// immediately. shutdown() stops the worker gracefully instead.
	if err := worker.Start(context.WithoutCancel(ctx)); err != nil {
		return nil, fmt.Errorf("start job worker: %w", err)
	}
	return worker, nil
}

// httpHandler is the mode's HTTP surface: health and metrics only for the
// worker, otherwise the API and the web UI.
func httpHandler(mode string, cfg config.Config, deps httpapi.Deps, log *slog.Logger) (string, http.Handler) {
	if mode == ModeWorker {
		return cfg.WorkerHTTPAddr, httpapi.NewOpsHandler(deps)
	}
	deps.Auth = auth.NewService(cfg, deps.Pool, deps.KV, deps.Metrics, log)
	deps.Web, deps.WebBuilt = web.Assets()
	if !deps.WebBuilt {
		log.Warn("web UI not built; run `make web` before building Grounded")
	}
	return cfg.HTTPAddr, httpapi.NewAPIHandler(deps)
}

// serve runs srv until ctx is cancelled or the server fails.
func serve(ctx context.Context, srv *http.Server, log *slog.Logger) error {
	serveErr := make(chan error, 1)
	go func() {
		log.Info("http listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
		close(serveErr)
	}()
	select {
	case err := <-serveErr:
		if err != nil {
			return fmt.Errorf("http server: %w", err)
		}
	case <-ctx.Done():
	}
	return nil
}

// shutdown drains traffic before stopping: readiness fails first so the load
// balancer removes the pod, then in-flight requests (including streams) and
// running jobs get SHUTDOWN_TIMEOUT to finish.
func shutdown(cfg config.Config, log *slog.Logger, health *httpapi.Health, worker *jobs.Client, servers ...*http.Server) error {
	log.Info("shutting down", "drain_delay", cfg.ShutdownDelay, "timeout", cfg.ShutdownTimeout)
	health.SetDraining()
	time.Sleep(cfg.ShutdownDelay)

	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	var errs []error
	for _, srv := range servers {
		if err := srv.Shutdown(ctx); err != nil {
			errs = append(errs, fmt.Errorf("http shutdown (%s): %w", srv.Addr, err))
		}
	}
	if worker != nil {
		// Soft stop lets running jobs finish; if the timeout expires, cancel
		// them (they are idempotent and River will retry them).
		if err := worker.Stop(ctx); err != nil {
			log.Warn("jobs did not finish before timeout; cancelling", "err", err)
			hardCtx, hardCancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer hardCancel()
			if err := worker.StopAndCancel(hardCtx); err != nil {
				errs = append(errs, fmt.Errorf("worker stop: %w", err))
			}
		}
	}
	if len(errs) == 0 {
		log.Info("shutdown complete")
	}
	return errors.Join(errs...)
}

// NewSecretBox builds the encryption box from ENCRYPTION_KEY (and the
// optional previous key). Configuration validation has already checked them.
func NewSecretBox(cfg config.Config) (*secrets.Box, error) {
	current, err := secrets.ParseKey(cfg.EncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("ENCRYPTION_KEY: %w", err)
	}
	var previous [][]byte
	if cfg.EncryptionKeyPrevious != "" {
		p, err := secrets.ParseKey(cfg.EncryptionKeyPrevious)
		if err != nil {
			return nil, fmt.Errorf("ENCRYPTION_KEY_PREVIOUS: %w", err)
		}
		previous = append(previous, p)
	}
	return secrets.New(current, previous...)
}

// NewPeppers parses API_KEY_PEPPER and the optional API_KEY_PEPPER_PREVIOUS
// (both empty: no pepper; API keys are then unavailable).
func NewPeppers(cfg config.Config) (secrets.Peppers, error) {
	return secrets.ParsePeppers(cfg.APIKeyPepper, cfg.APIKeyPepperPrevious)
}
