import { WideEventBuilder, shouldSample, createLogger } from "../logger";
import type { ServiceName, SamplingConfig, JobContext } from "../types";
import { generateSpanId, generateTraceId } from "../tracing";
import type pino from "pino";

// ============================================================================
// Types
// ============================================================================

export interface JobData {
  tenantId?: string | null;
  kbId?: string;
  sourceId?: string;
  runId?: string;
  requestId?: string;
  traceId?: string;
  [key: string]: unknown;
}

export interface JobInfo {
  id?: string;
  name: string;
  attemptsMade?: number;
  opts?: {
    attempts?: number;
  };
  data: JobData;
}

export interface JobLoggerOptions {
  /** Service name */
  service: ServiceName;
  /** Queue name */
  queue: string;
  /** Sampling configuration */
  sampling?: Partial<SamplingConfig>;
}

// ============================================================================
// Job Logger
// ============================================================================

/**
 * Creates a wide event logger for a background job.
 * 
 * Usage:
 * ```ts
 * const worker = new Worker(QUEUE_NAMES.EMBED_CHUNKS, async (job) => {
 *   const jobLogger = createJobLogger({
 *     service: "ingestion-worker",
 *     queue: QUEUE_NAMES.EMBED_CHUNKS,
 *   }, job);
 *   
 *   try {
 *     // ... do work
 *     jobLogger.addFields({ chunksProcessed: 50 });
 *     jobLogger.success();
 *   } catch (error) {
 *     jobLogger.setError(error);
 *     throw error;
 *   } finally {
 *     jobLogger.emit();
 *   }
 * });
 * ```
 */
export function createJobLogger(
  options: JobLoggerOptions,
  job: JobInfo
): WideEventBuilder {
  const { service, queue } = options;
  const { data } = job;

  // Use request ID from job data if propagated, otherwise generate new one
  const requestId = data.requestId || crypto.randomUUID();
  
  // Use trace ID from job data if propagated, otherwise generate new one
  // This maintains the trace across the entire job chain
  const traceId = data.traceId || generateTraceId();
  
  // Generate a new span ID for this job execution
  const spanId = generateSpanId();

  const event = new WideEventBuilder(service, requestId);
  
  // Set trace context
  event.setTraceContext({ traceId, spanId });

  // Set job context
  const jobContext: JobContext = {
    id: job.id || "unknown",
    name: job.name,
    queue,
    attempt: job.attemptsMade,
    maxAttempts: job.opts?.attempts,
  };
  event.setJob(jobContext);

  // Set tenant context if available
  if (data.tenantId) {
    event.setTenant({ id: data.tenantId });
  }

  // Set knowledge base context if available
  if (data.kbId) {
    event.setKnowledgeBase({ id: data.kbId });
  }

  // Set source context if available
  if (data.sourceId) {
    event.setSource({ id: data.sourceId });
  }

  // Set source run context if available
  if (data.runId) {
    event.setSourceRun({ id: data.runId });
  }

  return event;
}

/**
 * Wrapper function that handles job logging automatically.
 * 
 * Usage:
 * ```ts
 * const worker = new Worker(QUEUE_NAMES.EMBED_CHUNKS, 
 *   withJobLogging({
 *     service: "ingestion-worker",
 *     queue: QUEUE_NAMES.EMBED_CHUNKS,
 *   }, async (job, event) => {
 *     // event is already set up with job context
 *     event.addFields({ chunksProcessed: 50 });
 *     // ... do work
 *     // success/error/emit handled automatically
 *   })
 * );
 * ```
 */
export function withJobLogging<T extends JobInfo>(
  options: JobLoggerOptions,
  handler: (job: T, event: WideEventBuilder) => Promise<void>
): (job: T) => Promise<void> {
  const samplingConfig: SamplingConfig = {
    baseSampleRate: options.sampling?.baseSampleRate ?? 1.0, // Default to 100% for jobs
    alwaysLogErrors: options.sampling?.alwaysLogErrors ?? true,
    slowRequestThresholdMs: options.sampling?.slowRequestThresholdMs ?? 30000, // 30s for jobs
    alwaysLogOperations: options.sampling?.alwaysLogOperations,
  };

  return async (job: T) => {
    const event = createJobLogger(options, job);

    try {
      await handler(job, event);
      event.success();
    } catch (error) {
      if (error instanceof Error) {
        event.setError(error);
      } else {
        event.setError({
          type: "UnknownError",
          message: String(error),
        });
      }
      throw error;
    } finally {
      // Apply sampling
      const eventData = event.getEvent();
      if (shouldSample(eventData, samplingConfig)) {
        event.emit();
      }
    }
  };
}

// ============================================================================
// Simple Logger for Workers
// ============================================================================

/**
 * Create a simple child logger for a worker service.
 * Use this for non-job-related logs (startup, shutdown, etc.).
 */
export function createWorkerLogger(service: ServiceName): pino.Logger {
  return createLogger(service);
}
