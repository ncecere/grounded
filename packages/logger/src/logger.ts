import pino from "pino";
import type { ServiceName, LogLevel, WideEvent, PartialWideEvent, SamplingConfig, defaultSamplingConfig } from "./types";

// ============================================================================
// Configuration
// ============================================================================

const LOG_LEVEL = (process.env.LOG_LEVEL || "info") as LogLevel;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const SERVICE_VERSION = process.env.SERVICE_VERSION || process.env.npm_package_version || "unknown";

// ============================================================================
// Base Logger
// ============================================================================

/**
 * Create the base pino logger instance.
 * - JSON output in production for log aggregation
 * - Pretty output in development for readability
 */
function createBaseLogger() {
  const options: pino.LoggerOptions = {
    level: LOG_LEVEL,
    // Use ISO timestamps
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    // Format the level as a string
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Base context added to all logs
    base: {
      env: NODE_ENV,
      version: SERVICE_VERSION,
    },
  };

  // Pretty print in development
  if (!IS_PRODUCTION) {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          messageFormat: "{service} | {msg}",
        },
      },
    });
  }

  // JSON output in production
  return pino(options);
}

const baseLogger = createBaseLogger();

// ============================================================================
// Service Logger
// ============================================================================

/**
 * Create a logger for a specific service.
 * All logs from this logger will include the service name.
 */
export function createLogger(service: ServiceName) {
  return baseLogger.child({ service });
}

// ============================================================================
// Wide Event Builder
// ============================================================================

/**
 * Builder for constructing wide events incrementally.
 * Use this to add context throughout a request/job lifecycle,
 * then emit a single comprehensive log at the end.
 */
export class WideEventBuilder {
  private event: PartialWideEvent;
  private startTime: number;
  private logger: pino.Logger;

  constructor(service: ServiceName, requestId: string, logger?: pino.Logger) {
    this.startTime = Date.now();
    this.logger = logger || createLogger(service);
    this.event = {
      requestId,
      timestamp: new Date().toISOString(),
      service,
    };
  }

  /** Set the trace ID for distributed tracing */
  setTraceId(traceId: string): this {
    this.event.traceId = traceId;
    return this;
  }

  /** Set the span ID for this operation */
  setSpanId(spanId: string): this {
    this.event.spanId = spanId;
    return this;
  }

  /** Set the parent span ID (for child spans) */
  setParentSpanId(parentSpanId: string): this {
    this.event.parentSpanId = parentSpanId;
    return this;
  }

  /** Set full trace context (traceId, spanId, parentSpanId) */
  setTraceContext(context: { traceId: string; spanId: string; parentSpanId?: string }): this {
    this.event.traceId = context.traceId;
    this.event.spanId = context.spanId;
    if (context.parentSpanId) {
      this.event.parentSpanId = context.parentSpanId;
    }
    return this;
  }

  /** Get the current trace ID */
  getTraceId(): string | undefined {
    return this.event.traceId;
  }

  /** Get the current span ID */
  getSpanId(): string | undefined {
    return this.event.spanId;
  }

  /** Set tenant context */
  setTenant(tenant: WideEvent["tenant"]): this {
    this.event.tenant = tenant;
    return this;
  }

  /** Set user context */
  setUser(user: WideEvent["user"]): this {
    this.event.user = user;
    return this;
  }

  /** Set HTTP request context */
  setHttp(http: WideEvent["http"]): this {
    this.event.http = http;
    return this;
  }

  /** Set job context */
  setJob(job: WideEvent["job"]): this {
    this.event.job = job;
    return this;
  }

  /** Set knowledge base context */
  setKnowledgeBase(kb: WideEvent["knowledgeBase"]): this {
    this.event.knowledgeBase = kb;
    return this;
  }

  /** Set source context */
  setSource(source: WideEvent["source"]): this {
    this.event.source = source;
    return this;
  }

  /** Set source run context */
  setSourceRun(sourceRun: WideEvent["sourceRun"]): this {
    this.event.sourceRun = sourceRun;
    return this;
  }

  /** Set agent context */
  setAgent(agent: WideEvent["agent"]): this {
    this.event.agent = agent;
    return this;
  }

  /** Set the operation being performed */
  setOperation(operation: string): this {
    this.event.operation = operation;
    return this;
  }

  /** Add custom fields */
  addFields(fields: Record<string, unknown>): this {
    Object.assign(this.event, fields);
    return this;
  }

  /** Set error context */
  setError(error: Error | WideEvent["error"]): this {
    if (error instanceof Error) {
      this.event.error = {
        type: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
        retriable: (error as any).retriable,
      };
    } else {
      this.event.error = error;
    }
    this.event.outcome = "error";
    return this;
  }

  /** Mark the operation as successful */
  success(): this {
    this.event.outcome = "success";
    return this;
  }

  /** Mark the operation as partially successful */
  partial(): this {
    this.event.outcome = "partial";
    return this;
  }

  /** Get the current event (for inspection) */
  getEvent(): PartialWideEvent {
    return { ...this.event };
  }

  /** Get the request ID */
  getRequestId(): string {
    return this.event.requestId;
  }

  /**
   * Emit the wide event log.
   * Call this once at the end of the request/job.
   */
  emit(message?: string): void {
    this.event.durationMs = Date.now() - this.startTime;

    // Default outcome to success if not set and no error
    if (!this.event.outcome && !this.event.error) {
      this.event.outcome = "success";
    }

    const logMessage = message || this.buildMessage();
    const logLevel = this.event.outcome === "error" ? "error" : "info";

    this.logger[logLevel](this.event, logMessage);
  }

  /**
   * Build a descriptive message from the event context
   */
  private buildMessage(): string {
    const parts: string[] = [];

    if (this.event.http) {
      parts.push(`${this.event.http.method} ${this.event.http.path}`);
      if (this.event.http.statusCode) {
        parts.push(`-> ${this.event.http.statusCode}`);
      }
    } else if (this.event.job) {
      parts.push(`Job ${this.event.job.name}`);
    } else if (this.event.operation) {
      parts.push(this.event.operation);
    }

    if (this.event.durationMs) {
      parts.push(`(${this.event.durationMs}ms)`);
    }

    return parts.join(" ") || "Operation completed";
  }
}

// ============================================================================
// Sampling
// ============================================================================

/**
 * Determine if an event should be logged based on sampling rules.
 * Uses tail sampling - decision made after the request completes.
 */
export function shouldSample(
  event: PartialWideEvent,
  config: SamplingConfig = {
    baseSampleRate: 0.1,
    alwaysLogErrors: true,
    slowRequestThresholdMs: 2000,
  }
): boolean {
  // Always log errors
  if (config.alwaysLogErrors && event.outcome === "error") {
    return true;
  }

  // Always log slow requests
  if (event.durationMs && event.durationMs > config.slowRequestThresholdMs) {
    return true;
  }

  // Always log specific operations
  if (config.alwaysLogOperations?.includes(event.operation || "")) {
    return true;
  }

  // Random sample the rest
  return Math.random() < config.baseSampleRate;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick log for simple messages (not wide events).
 * Use sparingly - prefer wide events for request/job logging.
 */
export const log = {
  trace: (service: ServiceName, msg: string, data?: Record<string, unknown>) =>
    createLogger(service).trace(data, msg),
  debug: (service: ServiceName, msg: string, data?: Record<string, unknown>) =>
    createLogger(service).debug(data, msg),
  info: (service: ServiceName, msg: string, data?: Record<string, unknown>) =>
    createLogger(service).info(data, msg),
  warn: (service: ServiceName, msg: string, data?: Record<string, unknown>) =>
    createLogger(service).warn(data, msg),
  error: (service: ServiceName, msg: string, data?: Record<string, unknown>) =>
    createLogger(service).error(data, msg),
  fatal: (service: ServiceName, msg: string, data?: Record<string, unknown>) =>
    createLogger(service).fatal(data, msg),
};

// Export the base logger for advanced use cases
export { baseLogger };
