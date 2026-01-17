/**
 * W3C Trace Context Utilities
 * 
 * Provides OpenTelemetry-compatible trace context for distributed tracing.
 * Generates trace IDs and span IDs in OTel format, and parses/generates
 * W3C traceparent headers.
 * 
 * @see https://www.w3.org/TR/trace-context/
 */

// ============================================================================
// Types
// ============================================================================

export interface TraceContext {
  /** 32-character hex trace ID */
  traceId: string;
  /** 16-character hex span ID */
  spanId: string;
  /** Parent span ID (if this is a child span) */
  parentSpanId?: string;
  /** Trace flags (01 = sampled) */
  traceFlags: string;
}

export interface ParsedTraceparent {
  version: string;
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a 32-character hex trace ID (128-bit).
 * Compatible with OpenTelemetry trace ID format.
 */
export function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a 16-character hex span ID (64-bit).
 * Compatible with OpenTelemetry span ID format.
 */
export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// W3C Traceparent Header
// ============================================================================

/**
 * Parse a W3C traceparent header.
 * Format: {version}-{trace-id}-{parent-id}-{trace-flags}
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 * 
 * @returns Parsed traceparent or null if invalid
 */
export function parseTraceparent(header: string): ParsedTraceparent | null {
  if (!header) return null;

  const parts = header.trim().split("-");
  if (parts.length !== 4) return null;

  const [version, traceId, parentSpanId, traceFlags] = parts;

  // Validate version (must be 2 hex chars, we support version 00)
  if (!/^[0-9a-f]{2}$/.test(version)) return null;

  // Validate trace ID (32 hex chars, not all zeros)
  if (!/^[0-9a-f]{32}$/.test(traceId)) return null;
  if (traceId === "00000000000000000000000000000000") return null;

  // Validate parent span ID (16 hex chars, not all zeros)
  if (!/^[0-9a-f]{16}$/.test(parentSpanId)) return null;
  if (parentSpanId === "0000000000000000") return null;

  // Validate trace flags (2 hex chars)
  if (!/^[0-9a-f]{2}$/.test(traceFlags)) return null;

  return { version, traceId, parentSpanId, traceFlags };
}

/**
 * Generate a W3C traceparent header value.
 * Format: {version}-{trace-id}-{parent-id}-{trace-flags}
 */
export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

// ============================================================================
// Trace Context Management
// ============================================================================

/**
 * Create a new root trace context (no parent).
 */
export function createTraceContext(): TraceContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    traceFlags: "01", // sampled
  };
}

/**
 * Create a child trace context from a parent.
 * Inherits the trace ID and sets the parent span ID.
 */
export function createChildContext(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
    traceFlags: parent.traceFlags,
  };
}

/**
 * Create a trace context from an incoming traceparent header.
 * If the header is invalid or missing, creates a new root context.
 */
export function contextFromTraceparent(header: string | null | undefined): TraceContext {
  if (!header) {
    return createTraceContext();
  }

  const parsed = parseTraceparent(header);
  if (!parsed) {
    return createTraceContext();
  }

  // Create a new span as a child of the incoming parent
  return {
    traceId: parsed.traceId,
    spanId: generateSpanId(),
    parentSpanId: parsed.parentSpanId,
    traceFlags: parsed.traceFlags,
  };
}

/**
 * Check if a trace ID looks like an OTel-compatible format (32 hex chars).
 * Legacy UUIDs will not match this format.
 */
export function isOtelTraceId(traceId: string): boolean {
  return /^[0-9a-f]{32}$/.test(traceId);
}

/**
 * Convert a UUID to OTel trace ID format (remove hyphens).
 * If already in OTel format, returns as-is.
 */
export function normalizeTraceId(traceId: string): string {
  // Already OTel format
  if (isOtelTraceId(traceId)) {
    return traceId;
  }

  // UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) -> remove hyphens
  const normalized = traceId.replace(/-/g, "").toLowerCase();
  if (normalized.length === 32 && /^[0-9a-f]{32}$/.test(normalized)) {
    return normalized;
  }

  // Unknown format, generate new
  return generateTraceId();
}
