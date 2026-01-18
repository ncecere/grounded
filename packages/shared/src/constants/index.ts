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
// API Versions
// ============================================================================

export const API_VERSION = "v1";
export const API_BASE_PATH = `/api/${API_VERSION}`;
