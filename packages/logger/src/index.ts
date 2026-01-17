// Core logger functionality
export {
  createLogger,
  WideEventBuilder,
  shouldSample,
  log,
  baseLogger,
} from "./logger";

// Tracing utilities
export {
  generateTraceId,
  generateSpanId,
  parseTraceparent,
  formatTraceparent,
  createTraceContext,
  createChildContext,
  contextFromTraceparent,
  isOtelTraceId,
  normalizeTraceId,
} from "./tracing";

export type { TraceContext, ParsedTraceparent } from "./tracing";

// Types
export type {
  ServiceName,
  LogLevel,
  Outcome,
  WideEvent,
  PartialWideEvent,
  TenantContext,
  UserContext,
  HttpContext,
  JobContext,
  KnowledgeBaseContext,
  SourceContext,
  SourceRunContext,
  AgentContext,
  ErrorContext,
  SamplingConfig,
} from "./types";

export { defaultSamplingConfig, createSamplingConfig } from "./types";
