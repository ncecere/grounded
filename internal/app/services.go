package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apikeys"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/captcha"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/ocr"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/profilemig"
	"github.com/ncecere/grounded/internal/public"
	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/retention"
	"github.com/ncecere/grounded/internal/sources"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/vectorstore"
	"github.com/ncecere/grounded/internal/web"
)

// Services are the domain services shared by the API and worker.
type Services struct {
	Teams    *teams.Service
	Platform *platform.Service
	Catalog  *catalog.Service
	Sources  *sources.Service
	Web      *web.Service
	KBs      *kbs.Service
	APIKeys  *apikeys.Service
	Limits   *limits.Service
	Agents   *agents.Service
	Notify   *notify.Service
	// Mail sends notification email (nil: SMTP_HOST unset).
	Mail notify.Sender
	// Moderation stores the moderation policies and runs checks (ADR-0019).
	Moderation *moderation.Service
	// SystemOne stores the platform SystemOne settings (ADR-0020).
	SystemOne *systemone.Service
	// Public serves public agents to anonymous visitors and the widget.
	Public *public.Service
	// BreakGlass runs break-glass sessions (ADR-0024).
	BreakGlass *breakglass.Service
	Blob       blob.Store
	Vectors    vectorstore.Store
	Parser     *parse.Router
	builtin    *parse.Builtin

	// Retention administers retention periods, runs and legal holds; its
	// metrics are recorded by the worker's retention job.
	Retention        *retention.Service
	RetentionMetrics *retention.Metrics

	// ProfileMigrations moves KBs between embedding profiles (P2).
	ProfileMigrations *profilemig.Service

	// Evaluations runs evaluation sets (docs/evaluations.md).
	Evaluations *evals.Service
	// Costs prices usage, reports spend and enforces budgets (E2).
	Costs *costs.Service
	// OCR is Admin -> Parsing and ingestion's OCR (docs/ocr.md).
	OCR *ocr.Service
	// jobs enqueues River jobs (may be insert-only).
	jobs *jobs.Client
	pool *pgxpool.Pool
	log  *slog.Logger
}

// NewBlobStore builds the configured object store.
func NewBlobStore(ctx context.Context, cfg config.Config) (blob.Store, error) {
	if cfg.BlobBackend == "s3" {
		return blob.NewS3(ctx, blob.S3Config{
			Endpoint: cfg.S3.Endpoint, Region: cfg.S3.Region, Bucket: cfg.S3.Bucket,
			AccessKey: cfg.S3.AccessKey, SecretKey: cfg.S3.SecretKey, ForcePathStyle: cfg.S3.ForcePathStyle,
			CAFile: cfg.S3.CAFile, Prefix: cfg.S3.Prefix,
		})
	}
	return blob.NewFS(cfg.BlobDir)
}

// NewParser builds the parse router: built-in parsers, plus Tika when configured.
func NewParser(cfg config.Config, log *slog.Logger) (*parse.Router, *parse.Builtin) {
	b := parse.NewBuiltin(parse.Limits{}, cfg.PDFWorkers)
	r := &parse.Router{Builtin: b, Log: log, PreferTika: map[parse.Kind]bool{}}
	if cfg.TikaURL != "" {
		r.Tika = parse.NewTika(cfg.TikaURL, cfg.TikaTimeout, parse.Limits{})
		for _, k := range cfg.TikaPreferKinds {
			r.PreferTika[parse.Kind(strings.ToLower(k))] = true
		}
	}
	return r, b
}

// NewFetcher builds the crawler's HTTP client: SSRF-guarded, robots.txt
// respecting, and paced per origin across all processes through Valkey.
func NewFetcher(cfg config.Config, kvs *kv.Store) *crawl.Fetcher {
	return crawl.NewFetcher(crawl.FetcherConfig{
		UserAgent:            cfg.CrawlUserAgent(),
		Timeout:              cfg.Crawl.Timeout,
		MaxBodyBytes:         cfg.Crawl.MaxBodyBytes,
		Pacer:                crawl.NewValkeyPacer(kvs.Client, kvs.Key("crawl", "pace")+":", cfg.Crawl.OriginInterval),
		RespectRobots:        true,
		AllowPrivateForTests: cfg.Crawl.AllowPrivateAddressesForTests,
	})
}

// SeedFirstRun applies the one-time first-run configuration (ADR-0018):
// CRAWL_ALLOWLIST_SEED. Each step runs at most once per database.
func SeedFirstRun(ctx context.Context, cfg config.Config, pool *pgxpool.Pool, log *slog.Logger) error {
	_, err := web.SeedAllowlist(ctx, pool, cfg.Crawl.AllowlistSeed, log)
	return err
}

// NewServices wires domain services. jobs may be an insert-only client.
func NewServices(ctx context.Context, cfg config.Config, pool *pgxpool.Pool, jobsClient *jobs.Client, kvs *kv.Store, log *slog.Logger) (*Services, error) {
	box, err := NewSecretBox(cfg)
	if err != nil {
		return nil, err
	}
	store, err := NewBlobStore(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("object storage: %w", err)
	}
	s := &Services{
		Teams:    teams.NewService(pool),
		Platform: platform.NewService(pool),
		Catalog:  catalog.NewService(pool, box),
		Blob:     store,
		Vectors:  &vectorstore.PGVector{Pool: pool, EfSearch: cfg.VectorEfSearch, ExactThreshold: cfg.VectorExactThreshold},
	}
	if kvs != nil {
		s.Catalog.Pacer = &ratelimit.Pacer{KV: kvs}
	}
	s.Catalog.Log = log
	s.Limits = limits.New(pool, s.Teams, kvs, limits.Options{IngestJobsDefault: cfg.IngestMaxInflightTeam})
	s.Web = web.New(pool, s.Teams, jobsClient, store, NewFetcher(cfg, kvs), cfg.Crawl.MaxPages, cfg.Crawl.MaxBodyBytes, log)
	s.Web.Limits = s.Limits
	s.Limits.OnChange = s.limitsChanged // a raised limit wakes waiting crawls and documents
	s.Web.Maintenance = s.Platform.Gate
	s.Sources = sources.New(pool, s.Teams, s.Catalog, store, jobsClient, s.Web, cfg.MaxUploadBytes, log)
	s.Sources.Limits = s.Limits
	s.Sources.Boilerplate = cfg.Boilerplate
	s.Sources.Maintenance = s.Platform.Gate
	s.KBs = kbs.New(pool, s.Teams, s.Catalog, s.Vectors)
	s.KBs.Limits = s.Limits
	s.KBs.Weights = kbs.Weights{Vector: cfg.RetrievalVectorWeight, Keyword: cfg.RetrievalKeywordWeight}
	peppers, err := NewPeppers(cfg)
	if err != nil {
		return nil, err
	}
	pepper := peppers.Current
	if pepper != nil {
		s.APIKeys = apikeys.New(pool, s.Teams, pepper)
		s.APIKeys.PreviousPepper = peppers.Previous
	}
	s.Moderation = moderation.New(pool, s.Catalog, cfg.ModerationTimeout, log)
	s.Agents = agents.New(pool, s.Teams, s.KBs, s.Catalog, s.Limits, pepper, log)
	s.Agents.OrgName = cfg.Instance.OrgName
	s.Notify = notify.New(pool, jobsClient, cfg.SMTP.Enabled(), log)
	s.Mail = NewMailSender(cfg)
	s.BreakGlass = breakglass.New(pool, s.Teams, s.Notify, log)
	s.Sources.BreakGlass, s.Agents.BreakGlass = s.BreakGlass, s.BreakGlass
	wireNotify(s)
	s.Agents.Moderation = s.Moderation
	s.SystemOne = systemone.New(pool, s.Catalog, log)
	s.Agents.SystemOne, s.KBs.SystemOne = s.SystemOne, s.SystemOne
	s.Agents.PublicEnabled = s.Platform.PublicAgentsEnabled
	guard := &public.Guard{}
	if kvs != nil {
		guard.Counters = public.ValkeyCounters{KV: kvs}
	}
	s.Public = public.New(pool, s.Agents, s.Teams, s.Limits, guard, captcha.New(cfg.Public), pepper, cfg.Public.AnonSessionTTL, log)
	s.Public.PreviousPepper = peppers.Previous
	wireCosts(s, pool, jobsClient, log)
	s.Retention = retention.New(pool, jobsClient, cfg.Retention, log)
	s.RetentionMetrics = retention.NewMetrics()
	s.Parser, s.builtin = NewParser(cfg, log)
	tika, _ := s.Parser.Tika.(*parse.Tika)
	s.OCR = ocr.New(pool, s.Catalog, s.Limits, ocr.Config{
		TesseractURL: cfg.OCR.TesseractURL, Timeout: cfg.OCR.Timeout, Tika: tika,
		MaxPagesPerDocument: cfg.OCR.MaxPagesPerDocument, Concurrency: cfg.OCR.Concurrency,
	}, log)
	s.Sources.OCR = s.OCR
	s.jobs, s.pool, s.log = jobsClient, pool, log
	s.ProfileMigrations = profilemig.New(pool, s.Catalog, s.Teams, s.Notify, jobsClient, profilemig.Options{
		GraceDays: cfg.ProfileMigrationGraceDays, BatchSize: cfg.EmbedBatchSize, BatchTokens: cfg.EmbedBatchTokens,
	}, log)
	s.Evaluations = evals.New(pool, s.Teams, s.KBs, s.Agents, s.Limits, s.Notify, jobsClient, log)
	s.Evaluations.Concurrency = cfg.EvaluationConcurrency
	// Automatic evaluation runs: after a publish and a profile switch.
	s.Agents.OnPublished, s.ProfileMigrations.OnSwitched = s.Evaluations.QueueForAgent, s.Evaluations.QueueForKB
	return s, nil
}

// limitsChanged is the limits service's OnChange hook: crawls and documents
// waiting for a daily limit check it again. Failures only delay them (to
// their next recheck, or the next UTC day).
func (s *Services) limitsChanged(ctx context.Context, team uuid.NullUUID) {
	s.Web.LimitsChanged(ctx, team)
	n, err := ingest.WakeOCRWaiting(context.WithoutCancel(ctx), s.pool, s.jobs, team)
	if err != nil {
		s.log.WarnContext(ctx, "could not wake documents waiting for the daily OCR page limit", "team", team.UUID, "err", err)
	} else if n > 0 {
		s.log.InfoContext(ctx, "woke documents waiting for the daily OCR page limit", "team", team.UUID, "documents", n)
	}
}

// Close releases the PDF engine.
func (s *Services) Close() {
	if s.builtin != nil {
		_ = s.builtin.Close()
	}
}

// IngestRegistration registers the ingestion, web crawl and notification
// workers, their queues and periodic jobs.
func IngestRegistration(cfg config.Config, pool *pgxpool.Pool, s *Services, log *slog.Logger) (jobs.Registration, error) {
	counter, err := chunk.NewTokenCounter()
	if err != nil {
		return jobs.Registration{}, err
	}
	proc := &ingest.Processor{
		Pool: pool, Blob: s.Blob, Parser: s.Parser, Counter: counter, Catalog: s.Catalog,
		Vectors: s.Vectors, EmbedBatch: cfg.EmbedBatchSize, MaxBytes: cfg.MaxUploadBytes, Log: log,
		Boilerplate: cfg.Boilerplate, Maintenance: s.Platform.Gate, OCR: s.OCR,
		Batcher: &ingest.Batcher{
			MaxInputs: cfg.EmbedBatchSize, MaxTokens: cfg.EmbedBatchTokens, Linger: cfg.EmbedBatchWait,
			Counter: counter, Log: log,
		},
	}
	dispatch := &ingest.DispatchWorker{Pool: pool, Log: log, Team: s.Limits, Maintenance: s.Platform.Gate, Budget: s.Costs, Limits: ingest.Limits{
		MaxInflight: cfg.IngestMaxInflight, MaxInflightTeam: cfg.IngestMaxInflightTeam,
	}}
	proc.Dispatcher = dispatch
	return jobs.Registration{
		Register: func(w *river.Workers) {
			river.AddWorker(w, dispatch)
			river.AddWorker(w, &ingest.ProcessWorker{P: proc})
			river.AddWorker(w, &ingest.RecoverWorker{Queries: dbgen.New(pool), Log: log})
			river.AddWorker(w, &ingest.RefreshWorker{P: proc})
			river.AddWorker(w, &ingest.SweepWorker{Queries: dbgen.New(pool)})
			river.AddWorker(w, &web.CrawlWorker{S: s.Web})
			river.AddWorker(w, &web.ScheduleWorker{S: s.Web})
			registerNotify(w, cfg, pool, s, s.Mail, log)
			river.AddWorker(w, &breakglass.SweepWorker{S: s.BreakGlass})
			river.AddWorker(w, &costs.RollupWorker{S: s.Costs})
			profilemig.Register(w, s.ProfileMigrations, proc)
			retention.Register(w, &retention.Runner{
				Pool: pool, Blob: s.Blob, Env: cfg.Retention, Log: log, Metrics: s.RetentionMetrics,
			})
			evals.Register(w, s.Evaluations)
		},
		Queues: map[string]river.QueueConfig{
			ingest.Queue: {MaxWorkers: cfg.IngestConcurrency},
			web.Queue:    {MaxWorkers: cfg.Crawl.Concurrency},
			evals.Queue:  {MaxWorkers: 2},
		},
		Periodic: []*river.PeriodicJob{
			river.NewPeriodicJob(river.PeriodicInterval(5*time.Second),
				func() (river.JobArgs, *river.InsertOpts) { return ingest.DispatchArgs{}, nil },
				&river.PeriodicJobOpts{RunOnStart: true}),
			river.NewPeriodicJob(river.PeriodicInterval(10*time.Minute),
				func() (river.JobArgs, *river.InsertOpts) { return ingest.RecoverArgs{}, nil }, nil),
			river.NewPeriodicJob(river.PeriodicInterval(time.Minute),
				func() (river.JobArgs, *river.InsertOpts) { return ingest.SweepArgs{}, nil },
				&river.PeriodicJobOpts{RunOnStart: true}),
			river.NewPeriodicJob(river.PeriodicInterval(time.Minute),
				func() (river.JobArgs, *river.InsertOpts) { return web.ScheduleArgs{}, nil },
				&river.PeriodicJobOpts{RunOnStart: true}),
			profilemig.SweepPeriodic(),
			profilemig.CleanupPeriodic(),
			notifyPeriodic(),
			breakglass.Periodic(),
			retention.Periodic(),
			costs.RollupPeriodic(),
			evals.Periodic(),
		},
	}, nil
}
