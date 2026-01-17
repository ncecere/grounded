import type { Context, MiddlewareHandler } from "hono";
import { WideEventBuilder, shouldSample } from "../logger";
import type { SamplingConfig, TenantContext, UserContext } from "../types";
import {
  contextFromTraceparent,
  formatTraceparent,
  generateSpanId,
  type TraceContext,
} from "../tracing";

// ============================================================================
// Types
// ============================================================================

declare module "hono" {
  interface ContextVariableMap {
    wideEvent: WideEventBuilder;
    requestId: string;
    traceId: string;
    spanId: string;
    traceContext: TraceContext;
  }
}

export interface WideEventMiddlewareOptions {
  /** Service name for logging */
  service: "api";
  /** Sampling configuration */
  sampling?: Partial<SamplingConfig>;
  /** Function to extract tenant context from request */
  getTenant?: (c: Context) => TenantContext | undefined;
  /** Function to extract user context from request */
  getUser?: (c: Context) => UserContext | undefined;
  /** Paths to skip logging (e.g., health checks) */
  skipPaths?: string[];
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Hono middleware for wide event logging.
 * 
 * Creates a WideEventBuilder at the start of each request,
 * makes it available via c.get("wideEvent"), and emits
 * a comprehensive log at the end of the request.
 * 
 * Usage:
 * ```ts
 * app.use(wideEventMiddleware({ service: "api" }));
 * 
 * app.get("/users/:id", (c) => {
 *   const event = c.get("wideEvent");
 *   event.setOperation("get_user");
 *   event.addFields({ userId: c.req.param("id") });
 *   // ... handler logic
 * });
 * ```
 */
export function wideEventMiddleware(options: WideEventMiddlewareOptions): MiddlewareHandler {
  const { service, sampling, getTenant, getUser, skipPaths = [] } = options;

  const samplingConfig: SamplingConfig = {
    baseSampleRate: sampling?.baseSampleRate ?? 0.1,
    alwaysLogErrors: sampling?.alwaysLogErrors ?? true,
    slowRequestThresholdMs: sampling?.slowRequestThresholdMs ?? 2000,
    alwaysLogOperations: sampling?.alwaysLogOperations,
  };

  return async (c, next) => {
    const path = c.req.path;

    // Skip logging for certain paths
    if (skipPaths.some((skip) => path.startsWith(skip))) {
      await next();
      return;
    }

    // Get or generate request ID
    const requestId = c.get("requestId") || c.req.header("X-Request-ID") || crypto.randomUUID();
    
    // Parse W3C traceparent header or create new trace context
    // Supports both W3C traceparent and legacy X-Trace-ID headers
    const traceparent = c.req.header("traceparent");
    const legacyTraceId = c.req.header("X-Trace-ID");
    
    let traceContext: TraceContext;
    if (traceparent) {
      // W3C standard traceparent header
      traceContext = contextFromTraceparent(traceparent);
    } else if (legacyTraceId) {
      // Legacy X-Trace-ID header - create context with provided trace ID
      traceContext = {
        traceId: legacyTraceId.replace(/-/g, "").toLowerCase().padEnd(32, "0").slice(0, 32),
        spanId: generateSpanId(),
        traceFlags: "01",
      };
    } else {
      // No trace context provided - start new trace
      traceContext = contextFromTraceparent(null);
    }

    // Create the wide event builder with full trace context
    const event = new WideEventBuilder(service, requestId);
    event.setTraceContext(traceContext);

    // Set HTTP context
    event.setHttp({
      method: c.req.method,
      path: c.req.path,
      userAgent: c.req.header("User-Agent"),
      ip: c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP"),
    });

    // Store in context for handlers to access
    c.set("wideEvent", event);
    c.set("requestId", requestId);
    c.set("traceId", traceContext.traceId);
    c.set("spanId", traceContext.spanId);
    c.set("traceContext", traceContext);
    
    // Set response headers for trace correlation
    c.header("X-Trace-ID", traceContext.traceId);
    c.header("X-Span-ID", traceContext.spanId);
    c.header("traceparent", formatTraceparent(traceContext));

    try {
      await next();

      // Update HTTP context with response status
      event.setHttp({
        method: c.req.method,
        path: c.req.path,
        statusCode: c.res.status,
        userAgent: c.req.header("User-Agent"),
        ip: c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP"),
      });

      // Extract tenant/user context (may be set by auth middleware)
      if (getTenant) {
        const tenant = getTenant(c);
        if (tenant) event.setTenant(tenant);
      }
      if (getUser) {
        const user = getUser(c);
        if (user) event.setUser(user);
      }

      // Mark as success or error based on status code
      if (c.res.status >= 500) {
        event.setError({
          type: "HttpError",
          code: String(c.res.status),
          message: `HTTP ${c.res.status}`,
        });
      } else if (c.res.status >= 400) {
        event.addFields({ httpError: c.res.status });
        event.success(); // Client errors are still "successful" from server perspective
      } else {
        event.success();
      }
    } catch (err) {
      // Handle uncaught errors
      event.setHttp({
        method: c.req.method,
        path: c.req.path,
        statusCode: 500,
        userAgent: c.req.header("User-Agent"),
        ip: c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP"),
      });

      if (err instanceof Error) {
        event.setError(err);
      } else {
        event.setError({
          type: "UnknownError",
          message: String(err),
        });
      }

      throw err;
    } finally {
      // Apply tail sampling
      const eventData = event.getEvent();
      if (shouldSample(eventData, samplingConfig)) {
        event.emit();
      }
    }
  };
}

/**
 * Helper to get the wide event from a Hono context.
 * Throws if the middleware is not installed.
 */
export function getWideEvent(c: Context): WideEventBuilder {
  const event = c.get("wideEvent");
  if (!event) {
    throw new Error("Wide event not found. Did you install wideEventMiddleware?");
  }
  return event;
}
