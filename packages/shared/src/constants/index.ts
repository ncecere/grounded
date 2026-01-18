// ============================================================================
// Chunking Constants
// ============================================================================

export const CHUNK_SIZE_TOKENS = 800;
export const CHUNK_OVERLAP_TOKENS = 120;

// ============================================================================
// Retrieval Constants
// ============================================================================

export const DEFAULT_TOP_K = 8;
export const DEFAULT_CANDIDATE_K = 40;

// ============================================================================
// Session Constants
// ============================================================================

export const CONVERSATION_TTL_SECONDS = 60 * 60; // 1 hour
export const MAX_CONVERSATION_TURNS = 20;

// ============================================================================
// Retention Constants
// ============================================================================

export const SOFT_DELETE_RETENTION_DAYS = 30;
export const MAX_SOURCE_RUN_VERSIONS = 5;

// ============================================================================
// Rate Limiting Constants
// ============================================================================

export const CHAT_RATE_LIMIT_REQUESTS = 60;
export const CHAT_RATE_LIMIT_WINDOW_SECONDS = 60;

// ============================================================================
// Scraping Constants
// ============================================================================

export const MAX_CRAWL_DEPTH = 10;
export const DEFAULT_CRAWL_DEPTH = 3;
export const SCRAPE_TIMEOUT_MS = 30000;
export const MAX_PAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// ============================================================================
// HTML Content-Type Allowlist
// ============================================================================

/**
 * Allowed MIME types for HTML content during fetch.
 * Only pages with these content types will be processed.
 * Non-HTML content (PDFs, images, binaries) will be skipped.
 *
 * Note: Content-type values may include charset suffix (e.g., "text/html; charset=utf-8")
 * so validation should check if the content type starts with one of these values.
 */
export const HTML_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "application/xml", // Some servers return XML for HTML pages
  "text/xml", // Alternative XML content type
] as const;

/**
 * MIME types that are explicitly non-HTML and should be skipped.
 * These are common binary/document types that may be linked from web pages.
 */
export const NON_HTML_CONTENT_TYPES = [
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
  // Audio/Video
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/ogg",
  // Archives
  "application/zip",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/gzip",
  "application/x-tar",
  // Binaries
  "application/octet-stream",
  "application/x-executable",
  // Data formats (not HTML)
  "application/json",
  "text/plain",
  "text/css",
  "text/javascript",
  "application/javascript",
  "text/csv",
] as const;

/**
 * Environment variable to override HTML content-type enforcement.
 * Set to "true" or "1" to disable content-type validation (not recommended).
 */
export const HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR =
  "HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED";

// Tracking params to strip from URLs
export const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "msclkid",
  "ref",
  "_ga",
];

// ============================================================================
// Queue Constants
// ============================================================================

export const QUEUE_NAMES = {
  SOURCE_RUN: "source-run",
  PAGE_FETCH: "page-fetch",
  PAGE_PROCESS: "page-process",
  EMBED_CHUNKS: "embed-chunks",
  ENRICH_PAGE: "enrich-page",
  DELETION: "deletion",
  KB_REINDEX: "kb-reindex",
} as const;

export const JOB_RETRY_ATTEMPTS = 3;
export const JOB_RETRY_DELAY_MS = 5000;
export const JOB_BACKOFF_TYPE = "exponential" as const;

// ============================================================================
// Ingestion Stage Constants
// ============================================================================

/**
 * Ordered list of ingestion pipeline stages.
 * Pages flow through these stages sequentially.
 */
export const INGESTION_STAGES = [
  "discover",
  "fetch",
  "extract",
  "chunk",
  "embed",
  "index",
] as const;

/**
 * Maximum retry attempts per stage.
 * After exhausting retries, stage is marked as failed_permanent.
 */
export const STAGE_MAX_RETRIES = {
  discover: 2,
  fetch: 3,
  extract: 2,
  chunk: 1,
  embed: 3,
  index: 3,
} as const;

/**
 * Base delay (ms) for exponential backoff per stage.
 */
export const STAGE_RETRY_DELAY_MS = {
  discover: 5000,
  fetch: 10000,
  extract: 2000,
  chunk: 1000,
  embed: 5000,
  index: 5000,
} as const;

/**
 * Maps each ingestion stage to its primary queue.
 * Some stages may share queues or use specialized queues.
 */
export const STAGE_QUEUE_MAPPING = {
  discover: QUEUE_NAMES.SOURCE_RUN,
  fetch: QUEUE_NAMES.PAGE_FETCH,
  extract: QUEUE_NAMES.PAGE_PROCESS,
  chunk: QUEUE_NAMES.PAGE_PROCESS,
  embed: QUEUE_NAMES.EMBED_CHUNKS,
  index: QUEUE_NAMES.EMBED_CHUNKS, // Index happens as part of embed completion
} as const;

/**
 * Default concurrency limits per stage.
 * These can be overridden via environment variables.
 *
 * Rationale:
 * - discover: Low concurrency to avoid overwhelming source servers during sitemap/domain discovery
 * - fetch: Higher concurrency for network-bound operations, but limited to be polite to target servers
 * - extract: CPU-bound, can parallelize well on multi-core systems
 * - chunk: CPU-bound, lightweight operation
 * - embed: API-bound, limited by external provider rate limits
 * - index: Database-bound, limited to avoid connection pool exhaustion
 */
export const STAGE_DEFAULT_CONCURRENCY = {
  discover: 2,
  fetch: 5,
  extract: 10,
  chunk: 10,
  embed: 4,
  index: 8,
} as const;

/**
 * Environment variable names for per-stage concurrency overrides.
 */
export const STAGE_CONCURRENCY_ENV_VARS = {
  discover: "DISCOVER_CONCURRENCY",
  fetch: "FETCH_CONCURRENCY",
  extract: "EXTRACT_CONCURRENCY",
  chunk: "CHUNK_CONCURRENCY",
  embed: "EMBED_CONCURRENCY",
  index: "INDEX_CONCURRENCY",
} as const;

/**
 * Queue-level default concurrency settings.
 * Used when stages share a queue.
 */
export const QUEUE_DEFAULT_CONCURRENCY = {
  [QUEUE_NAMES.SOURCE_RUN]: 5,
  [QUEUE_NAMES.PAGE_FETCH]: 5,
  [QUEUE_NAMES.PAGE_PROCESS]: 5,
  [QUEUE_NAMES.EMBED_CHUNKS]: 4,
  [QUEUE_NAMES.ENRICH_PAGE]: 2,
  [QUEUE_NAMES.DELETION]: 2,
  [QUEUE_NAMES.KB_REINDEX]: 1,
} as const;

/**
 * Environment variable names for per-queue concurrency overrides.
 */
export const QUEUE_CONCURRENCY_ENV_VARS = {
  [QUEUE_NAMES.SOURCE_RUN]: "SOURCE_RUN_CONCURRENCY",
  [QUEUE_NAMES.PAGE_FETCH]: "PAGE_FETCH_CONCURRENCY",
  [QUEUE_NAMES.PAGE_PROCESS]: "PAGE_PROCESS_CONCURRENCY",
  [QUEUE_NAMES.EMBED_CHUNKS]: "EMBED_CHUNKS_CONCURRENCY",
  [QUEUE_NAMES.ENRICH_PAGE]: "ENRICH_PAGE_CONCURRENCY",
  [QUEUE_NAMES.DELETION]: "DELETION_CONCURRENCY",
  [QUEUE_NAMES.KB_REINDEX]: "KB_REINDEX_CONCURRENCY",
} as const;

// ============================================================================
// Tenant and Domain Concurrency Limits
// ============================================================================

/**
 * Default per-tenant concurrency limit for fetch/crawl jobs.
 * Can be overridden per-tenant via TenantQuotas.maxCrawlConcurrency.
 *
 * Rationale:
 * - Prevents a single tenant from consuming all worker capacity
 * - Ensures fair resource distribution across tenants
 * - Can be increased for enterprise tenants
 */
export const DEFAULT_TENANT_CONCURRENCY = 5;

/**
 * Default per-domain concurrency limit for fetch jobs.
 * Applies globally regardless of tenant to prevent overwhelming target servers.
 *
 * Rationale:
 * - Limits concurrent connections to any single domain
 * - Prevents accidental DDoS behavior on target servers
 * - Respects common rate limiting practices (2-5 concurrent requests)
 */
export const DEFAULT_DOMAIN_CONCURRENCY = 3;

/**
 * Environment variable to override the default domain concurrency limit.
 */
export const DOMAIN_CONCURRENCY_ENV_VAR = "DOMAIN_CONCURRENCY";

/**
 * Redis key prefixes for concurrency tracking.
 */
export const CONCURRENCY_KEY_PREFIXES = {
  /** Tracks active jobs per tenant: concurrency:tenant:{tenantId} */
  TENANT: "concurrency:tenant:",
  /** Tracks active jobs per domain: concurrency:domain:{domain} */
  DOMAIN: "concurrency:domain:",
  /** Tracks active jobs per tenant+domain: concurrency:tenant_domain:{tenantId}:{domain} */
  TENANT_DOMAIN: "concurrency:tenant_domain:",
} as const;

/**
 * TTL for concurrency tracking keys in seconds.
 * Jobs should complete or fail within this time, after which keys auto-expire.
 * Set conservatively high to handle long-running jobs.
 */
export const CONCURRENCY_KEY_TTL_SECONDS = 300; // 5 minutes

/**
 * Delay in milliseconds when a job is rate-limited and should be retried.
 * Used for re-queuing jobs that exceed concurrency limits.
 */
export const CONCURRENCY_RETRY_DELAY_MS = 5000;

// ============================================================================
// Embed Backpressure Constants
// ============================================================================

/**
 * Default threshold for embed queue depth before applying backpressure.
 * When the embed queue has more than this many pending jobs, the process
 * queue will delay adding more embed jobs to prevent unbounded queue growth.
 *
 * Rationale:
 * - Embedding is typically the slowest stage (API-bound)
 * - Unbounded queuing can cause memory issues and long processing times
 * - This threshold allows some buffering while preventing runaway growth
 */
export const DEFAULT_EMBED_QUEUE_THRESHOLD = 100;

/**
 * Default threshold for embed lag (chunks awaiting embedding) before applying backpressure.
 * This uses the database counter (chunksToEmbed - chunksEmbedded) rather than queue depth.
 *
 * Rationale:
 * - Provides a more accurate measure of actual embedding backlog
 * - Works even if queue metrics are temporarily unavailable
 * - Accounts for chunks in-flight (queued but not yet started)
 */
export const DEFAULT_EMBED_LAG_THRESHOLD = 500;

/**
 * Delay in milliseconds to wait when embed backpressure is detected.
 * The page-process job will pause for this duration before rechecking.
 *
 * Rationale:
 * - Gives the embed workers time to catch up
 * - Short enough to not significantly slow down normal processing
 * - Long enough to be meaningful (embed job takes ~1-5s typically)
 */
export const EMBED_BACKPRESSURE_DELAY_MS = 2000;

/**
 * Maximum number of backpressure wait cycles before proceeding anyway.
 * Prevents jobs from being delayed indefinitely during temporary issues.
 *
 * Rationale:
 * - Total max wait = EMBED_BACKPRESSURE_DELAY_MS * EMBED_BACKPRESSURE_MAX_WAIT_CYCLES
 * - With defaults: 2000ms * 10 = 20 seconds max wait
 * - Balances backpressure effectiveness with job completion time
 */
export const EMBED_BACKPRESSURE_MAX_WAIT_CYCLES = 10;

/**
 * Environment variable names for embed backpressure configuration.
 */
export const EMBED_BACKPRESSURE_ENV_VARS = {
  /** Override the queue depth threshold */
  QUEUE_THRESHOLD: "EMBED_QUEUE_THRESHOLD",
  /** Override the lag threshold */
  LAG_THRESHOLD: "EMBED_LAG_THRESHOLD",
  /** Override the delay between checks */
  DELAY_MS: "EMBED_BACKPRESSURE_DELAY_MS",
  /** Override the max wait cycles */
  MAX_WAIT_CYCLES: "EMBED_BACKPRESSURE_MAX_WAIT_CYCLES",
  /** Disable backpressure entirely (set to "true" or "1") */
  DISABLED: "EMBED_BACKPRESSURE_DISABLED",
} as const;

/**
 * Redis key for tracking global embed queue depth.
 * Used for backpressure calculations when BullMQ queue metrics are unavailable.
 */
export const EMBED_BACKPRESSURE_KEY = "backpressure:embed:pending";

/**
 * TTL for the embed backpressure tracking key in seconds.
 */
export const EMBED_BACKPRESSURE_KEY_TTL_SECONDS = 600; // 10 minutes

// ============================================================================
// Playwright Configuration Constants
// ============================================================================

/**
 * Environment variable to disable Playwright download prevention.
 * Set to "true" or "1" to allow downloads during crawl (not recommended).
 *
 * By default, downloads are disabled during crawling to:
 * - Prevent disk space consumption from unexpected file downloads
 * - Avoid slow page loading due to download triggers
 * - Reduce security risks from downloading untrusted files
 */
export const PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR = "PLAYWRIGHT_DOWNLOADS_DISABLED";

/**
 * Environment variable to enable download event logging during crawl.
 * Set to "true" or "1" to log when downloads are blocked.
 *
 * This is useful for debugging and monitoring which pages attempt downloads.
 */
export const PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR = "PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS";

/**
 * Default setting for download prevention: true (downloads disabled by default).
 * This is the safest default for web crawling operations.
 */
export const PLAYWRIGHT_DOWNLOADS_DISABLED_DEFAULT = true;

/**
 * Default setting for logging blocked downloads: true.
 * Logs are useful for debugging and understanding crawl behavior.
 */
export const PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_DEFAULT = true;

// ============================================================================
// Exponential Backoff Configuration
// ============================================================================

/**
 * Default base delay for exponential backoff in milliseconds.
 * The actual delay for attempt N is: baseDelayMs * (multiplier ^ (N-1)) + jitter
 */
export const DEFAULT_BACKOFF_BASE_DELAY_MS = 1000;

/**
 * Default maximum delay cap in milliseconds.
 * Prevents delays from growing unbounded.
 */
export const DEFAULT_BACKOFF_MAX_DELAY_MS = 60000; // 1 minute

/**
 * Default multiplier for exponential backoff.
 * Each retry multiplies the delay by this factor.
 */
export const DEFAULT_BACKOFF_MULTIPLIER = 2;

/**
 * Default maximum jitter ratio (0-1).
 * Jitter is added as: delay * random(0, jitterRatio)
 * 0.3 means up to 30% additional random delay.
 */
export const DEFAULT_BACKOFF_JITTER_RATIO = 0.3;

/**
 * Default maximum retry attempts for operations.
 */
export const DEFAULT_MAX_RETRY_ATTEMPTS = 3;

/**
 * Environment variable names for backoff configuration overrides.
 */
export const BACKOFF_ENV_VARS = {
  /** Override base delay in ms */
  BASE_DELAY_MS: "BACKOFF_BASE_DELAY_MS",
  /** Override max delay in ms */
  MAX_DELAY_MS: "BACKOFF_MAX_DELAY_MS",
  /** Override multiplier */
  MULTIPLIER: "BACKOFF_MULTIPLIER",
  /** Override jitter ratio (0-1) */
  JITTER_RATIO: "BACKOFF_JITTER_RATIO",
  /** Override max retry attempts */
  MAX_ATTEMPTS: "BACKOFF_MAX_ATTEMPTS",
} as const;

/**
 * Stage-specific backoff configurations.
 * Different stages may need different retry behavior based on their characteristics:
 * - discover: Lower delays, failures often due to network issues
 * - fetch: Higher delays for rate limiting, respect Retry-After headers
 * - extract: Lower delays, CPU-bound operations
 * - chunk: Minimal delays, usually memory-related
 * - embed: Higher delays for API rate limits
 * - index: Moderate delays for database contention
 */
export const STAGE_BACKOFF_CONFIG = {
  discover: {
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    multiplier: 2,
    jitterRatio: 0.25,
  },
  fetch: {
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    multiplier: 2,
    jitterRatio: 0.3,
  },
  extract: {
    baseDelayMs: 1000,
    maxDelayMs: 15000,
    multiplier: 2,
    jitterRatio: 0.2,
  },
  chunk: {
    baseDelayMs: 500,
    maxDelayMs: 5000,
    multiplier: 2,
    jitterRatio: 0.1,
  },
  embed: {
    baseDelayMs: 3000,
    maxDelayMs: 60000,
    multiplier: 2,
    jitterRatio: 0.35,
  },
  index: {
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    multiplier: 2,
    jitterRatio: 0.25,
  },
} as const;

// ============================================================================
// API Versions
// ============================================================================

export const API_VERSION = "v1";
export const API_BASE_PATH = `/api/${API_VERSION}`;
