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
// API Versions
// ============================================================================

export const API_VERSION = "v1";
export const API_BASE_PATH = `/api/${API_VERSION}`;
