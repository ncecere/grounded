/**
 * Wide Event Types for Grounded
 * 
 * Based on the "canonical log line" / "wide event" pattern:
 * - One comprehensive event per request/job
 * - All context needed for debugging in a single log line
 * - High cardinality fields for powerful querying
 */

// ============================================================================
// Service Types
// ============================================================================

export type ServiceName = "api" | "ingestion-worker" | "scraper-worker";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type Outcome = "success" | "error" | "partial";

// ============================================================================
// Context Types
// ============================================================================

/** Tenant context for multi-tenancy */
export interface TenantContext {
  id: string;
  name?: string;
  slug?: string;
}

/** User context */
export interface UserContext {
  id: string;
  email?: string;
  role?: string;
  isSystemAdmin?: boolean;
}

/** HTTP request context */
export interface HttpContext {
  method: string;
  path: string;
  statusCode?: number;
  userAgent?: string;
  ip?: string;
}

/** Background job context */
export interface JobContext {
  id: string;
  name: string;
  queue: string;
  attempt?: number;
  maxAttempts?: number;
}

/** Knowledge base context */
export interface KnowledgeBaseContext {
  id: string;
  name?: string;
  isGlobal?: boolean;
}

/** Source context */
export interface SourceContext {
  id: string;
  name?: string;
  type?: "web" | "upload";
}

/** Source run context */
export interface SourceRunContext {
  id: string;
  status?: string;
  trigger?: "manual" | "scheduled";
}

/** Agent context */
export interface AgentContext {
  id: string;
  name?: string;
}

/** Error context */
export interface ErrorContext {
  type: string;
  code?: string;
  message: string;
  stack?: string;
  retriable?: boolean;
}

// ============================================================================
// Wide Event
// ============================================================================

/**
 * The canonical wide event structure.
 * This is what gets logged for every request/job.
 */
export interface WideEvent {
  // ---- Identifiers ----
  /** Unique request/operation ID */
  requestId: string;
  /** Distributed trace ID - 32-char hex for OTel compatibility */
  traceId?: string;
  /** Current span ID - 16-char hex for OTel compatibility */
  spanId?: string;
  /** Parent span ID (for nested operations) - 16-char hex */
  parentSpanId?: string;

  // ---- Timing ----
  /** ISO timestamp */
  timestamp: string;
  /** Duration in milliseconds */
  durationMs?: number;

  // ---- Service Info ----
  /** Service that emitted this event */
  service: ServiceName;
  /** Service version */
  version?: string;
  /** Deployment/pod ID */
  deploymentId?: string;
  /** Environment (development, staging, production) */
  env?: string;

  // ---- Multi-tenant Context ----
  tenant?: TenantContext;
  user?: UserContext;

  // ---- Request/Job Context ----
  http?: HttpContext;
  job?: JobContext;

  // ---- Business Context ----
  knowledgeBase?: KnowledgeBaseContext;
  source?: SourceContext;
  sourceRun?: SourceRunContext;
  agent?: AgentContext;

  // ---- Operation Details ----
  /** What operation is being performed */
  operation?: string;
  /** Outcome of the operation */
  outcome?: Outcome;
  /** Error details if outcome is error */
  error?: ErrorContext;

  // ---- Metrics ----
  /** Database queries executed */
  dbQueries?: number;
  /** External API calls made */
  externalCalls?: number;
  /** Cache hit/miss */
  cacheHit?: boolean;
  /** Bytes processed/transferred */
  bytesProcessed?: number;
  /** Items processed (chunks, pages, etc.) */
  itemsProcessed?: number;

  // ---- Feature Flags ----
  featureFlags?: Record<string, boolean | string>;

  // ---- Custom Fields ----
  /** Additional context specific to the operation */
  [key: string]: unknown;
}

// ============================================================================
// Builder Types
// ============================================================================

/** Partial wide event for building incrementally */
export type PartialWideEvent = Partial<WideEvent> & {
  requestId: string;
  timestamp: string;
  service: ServiceName;
};

// ============================================================================
// Sampling Types
// ============================================================================

export interface SamplingConfig {
  /** Base sample rate for successful requests (0-1) */
  baseSampleRate: number;
  /** Always log errors */
  alwaysLogErrors: boolean;
  /** Always log slow requests above this threshold (ms) */
  slowRequestThresholdMs: number;
  /** Always log specific operations */
  alwaysLogOperations?: string[];
}

export const defaultSamplingConfig: SamplingConfig = {
  baseSampleRate: 0.1, // 10% of successful requests
  alwaysLogErrors: true,
  slowRequestThresholdMs: 2000, // 2 seconds
  alwaysLogOperations: [],
};

/**
 * Create a sampling config from environment variables.
 * 
 * Environment variables:
 * - LOG_SAMPLE_RATE: Base sample rate (0-1), default 0.1
 * - LOG_ALWAYS_ERRORS: Always log errors (true/false), default true
 * - LOG_SLOW_THRESHOLD_MS: Slow request threshold in ms, default 2000
 * - LOG_ALWAYS_OPERATIONS: Comma-separated list of operations to always log
 */
export function createSamplingConfig(overrides?: Partial<SamplingConfig>): SamplingConfig {
  const envSampleRate = process.env.LOG_SAMPLE_RATE;
  const envAlwaysErrors = process.env.LOG_ALWAYS_ERRORS;
  const envSlowThreshold = process.env.LOG_SLOW_THRESHOLD_MS;
  const envAlwaysOps = process.env.LOG_ALWAYS_OPERATIONS;

  return {
    baseSampleRate: overrides?.baseSampleRate 
      ?? (envSampleRate ? parseFloat(envSampleRate) : defaultSamplingConfig.baseSampleRate),
    alwaysLogErrors: overrides?.alwaysLogErrors 
      ?? (envAlwaysErrors ? envAlwaysErrors === "true" : defaultSamplingConfig.alwaysLogErrors),
    slowRequestThresholdMs: overrides?.slowRequestThresholdMs 
      ?? (envSlowThreshold ? parseInt(envSlowThreshold, 10) : defaultSamplingConfig.slowRequestThresholdMs),
    alwaysLogOperations: overrides?.alwaysLogOperations 
      ?? (envAlwaysOps ? envAlwaysOps.split(",").map(s => s.trim()) : defaultSamplingConfig.alwaysLogOperations),
  };
}
