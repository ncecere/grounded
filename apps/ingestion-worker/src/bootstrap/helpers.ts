/**
 * Ingestion Worker Helper Module
 *
 * Centralized logging and error handling for the ingestion worker.
 * Provides consistent patterns across all job processors and queue handlers.
 */

import { createWorkerLogger, createJobLogger } from "@grounded/logger/worker";
import { log, shouldSample, createSamplingConfig } from "@grounded/logger";
import type { SamplingConfig } from "@grounded/logger";

// ============================================================================
// Worker Logger
// ============================================================================

/** Logger type inferred from createWorkerLogger */
export type WorkerLogger = ReturnType<typeof createWorkerLogger>;

// Singleton logger instance for the ingestion worker
let _workerLogger: WorkerLogger | null = null;

/**
 * Get the shared logger instance for the ingestion worker.
 * Use this for non-job-related logs (startup, shutdown, settings changes).
 *
 * Returns a singleton child logger bound to "ingestion-worker" service name.
 */
export function getWorkerLogger(): WorkerLogger {
  if (!_workerLogger) {
    _workerLogger = createWorkerLogger("ingestion-worker");
  }
  return _workerLogger;
}

/**
 * Convenience re-export of createJobLogger for job-level wide event logging.
 */
export { createJobLogger };

// ============================================================================
// Inline Logging Helpers
// ============================================================================

/**
 * Pre-bound logging functions for the ingestion worker service.
 * Use these for inline logging within job processors where wide events
 * are not needed.
 *
 * @example
 * ```ts
 * import { ingestLog } from "../bootstrap/helpers";
 *
 * ingestLog.info("Processing page", { url, depth });
 * ingestLog.error("Failed to fetch", { url, error: error.message });
 * ```
 */
export const ingestLog = {
  trace: (msg: string, data?: Record<string, unknown>) =>
    log.trace("ingestion-worker", msg, data),
  debug: (msg: string, data?: Record<string, unknown>) =>
    log.debug("ingestion-worker", msg, data),
  info: (msg: string, data?: Record<string, unknown>) =>
    log.info("ingestion-worker", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) =>
    log.warn("ingestion-worker", msg, data),
  error: (msg: string, data?: Record<string, unknown>) =>
    log.error("ingestion-worker", msg, data),
  fatal: (msg: string, data?: Record<string, unknown>) =>
    log.fatal("ingestion-worker", msg, data),
};

// ============================================================================
// Sampling Configuration
// ============================================================================

/**
 * Default sampling configuration for ingestion worker jobs.
 * - 100% sample rate (log all jobs by default)
 * - Always log errors
 * - 30s threshold for slow jobs
 */
export const workerSamplingConfig: SamplingConfig = createSamplingConfig({
  baseSampleRate: 1.0, // Log all jobs by default
  slowRequestThresholdMs: 30000, // 30s is slow for a job
});

/**
 * Re-export shouldSample for use in job handlers.
 */
export { shouldSample };

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Base error class for ingestion worker errors.
 * Provides consistent error structure across all processors.
 */
export class IngestionError extends Error {
  /** Error code for categorization and metrics */
  readonly code: string;
  /** Whether this error is retriable */
  readonly retriable: boolean;
  /** Additional context for debugging */
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code: string;
      retriable?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "IngestionError";
    this.code = options.code;
    this.retriable = options.retriable ?? false;
    this.context = options.context;
  }
}

/**
 * Error thrown when a required resource is not found.
 */
export class NotFoundError extends IngestionError {
  constructor(
    resourceType: string,
    resourceId: string,
    context?: Record<string, unknown>
  ) {
    super(`${resourceType} ${resourceId} not found`, {
      code: `NOT_FOUND_${resourceType.toUpperCase().replace(/\s+/g, "_")}`,
      retriable: false,
      context: { resourceType, resourceId, ...context },
    });
    this.name = "NotFoundError";
  }
}

/**
 * Error thrown when configuration is invalid or missing.
 */
export class ConfigurationError extends IngestionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: "CONFIG_ERROR",
      retriable: false,
      context,
    });
    this.name = "ConfigurationError";
  }
}

/**
 * Error thrown during content processing (extraction, parsing, etc.).
 */
export class ProcessingError extends IngestionError {
  constructor(
    message: string,
    options?: {
      code?: string;
      retriable?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, {
      code: options?.code ?? "PROCESSING_ERROR",
      retriable: options?.retriable ?? true,
      context: options?.context,
      cause: options?.cause,
    });
    this.name = "ProcessingError";
  }
}

/**
 * Error thrown during embedding generation.
 */
export class EmbeddingError extends IngestionError {
  constructor(
    message: string,
    options?: {
      code?: string;
      retriable?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, {
      code: options?.code ?? "EMBED_ERROR",
      retriable: options?.retriable ?? true,
      context: options?.context,
      cause: options?.cause,
    });
    this.name = "EmbeddingError";
  }
}

/**
 * Error thrown when embedding dimensions don't match the knowledge base configuration.
 */
export class EmbeddingDimensionMismatchError extends EmbeddingError {
  constructor(expected: number, actual: number, kbId: string) {
    super(
      `Embedding dimension mismatch for KB ${kbId}: ` +
        `expected ${expected} dimensions but got ${actual}. ` +
        `The KB was created with a different embedding model. ` +
        `Either use the same model or re-create the KB with the new model.`,
      {
        code: "CONFIG_EMBEDDING_DIMENSION_MISMATCH",
        retriable: false,
        context: { expected, actual, kbId },
      }
    );
    this.name = "EmbeddingDimensionMismatchError";
  }
}

/**
 * Error thrown when a stage transition fails.
 */
export class StageTransitionError extends IngestionError {
  constructor(
    runId: string,
    fromStage: string,
    toStage: string,
    reason: string,
    context?: Record<string, unknown>
  ) {
    super(`Stage transition failed for run ${runId}: ${fromStage} -> ${toStage}: ${reason}`, {
      code: "STAGE_TRANSITION_ERROR",
      retriable: true,
      context: { runId, fromStage, toStage, reason, ...context },
    });
    this.name = "StageTransitionError";
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Normalize an error to a consistent error object format.
 * Use this in job handlers to convert unknown errors to a loggable format.
 *
 * @example
 * ```ts
 * try {
 *   await processPage(data);
 * } catch (error) {
 *   const normalizedError = normalizeError(error);
 *   ingestLog.error("Processing failed", normalizedError);
 *   throw error;
 * }
 * ```
 */
export function normalizeError(error: unknown): {
  type: string;
  message: string;
  code?: string;
  retriable?: boolean;
  stack?: string;
} {
  if (error instanceof IngestionError) {
    return {
      type: error.name,
      message: error.message,
      code: error.code,
      retriable: error.retriable,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      code: (error as any).code,
      retriable: (error as any).retriable,
      stack: error.stack,
    };
  }

  return {
    type: "UnknownError",
    message: String(error),
  };
}

/**
 * Extract error message from an unknown error.
 * Simpler version of normalizeError when you just need the message.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Check if an error is retriable based on its type and properties.
 */
export function isRetriableError(error: unknown): boolean {
  if (error instanceof IngestionError) {
    return error.retriable;
  }

  // Non-retriable error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("not found") ||
      message.includes("not configured") ||
      message.includes("invalid") ||
      message.includes("dimension mismatch")
    ) {
      return false;
    }
  }

  // Default to retriable for unknown errors
  return true;
}

/**
 * Wrap a job handler with standard error logging.
 * Use when you need manual control over the job execution
 * but want consistent error handling.
 *
 * @example
 * ```ts
 * await withErrorLogging(
 *   { jobName: "page_process", runId, url },
 *   async () => {
 *     await processPage(data);
 *   }
 * );
 * ```
 */
export async function withErrorLogging<T>(
  context: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const normalized = normalizeError(error);
    ingestLog.error("Job failed", {
      ...context,
      error: normalized.message,
      errorType: normalized.type,
      errorCode: normalized.code,
      retriable: normalized.retriable,
    });
    throw error;
  }
}
