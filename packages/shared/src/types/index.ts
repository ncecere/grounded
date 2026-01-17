import { z } from "zod";

// ============================================================================
// Enums
// ============================================================================

export const TenantRole = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  VIEWER: "viewer",
} as const;
export type TenantRole = (typeof TenantRole)[keyof typeof TenantRole];

export const SystemRole = {
  SYSTEM_ADMIN: "system_admin",
} as const;
export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole];

export const SourceType = {
  WEB: "web",
  UPLOAD: "upload",
} as const;
export type SourceType = (typeof SourceType)[keyof typeof SourceType];

export const ScrapeMode = {
  SINGLE: "single",
  LIST: "list",
  SITEMAP: "sitemap",
  DOMAIN: "domain",
} as const;
export type ScrapeMode = (typeof ScrapeMode)[keyof typeof ScrapeMode];

export const SourceRunStatus = {
  PENDING: "pending",
  RUNNING: "running",
  PARTIAL: "partial",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
} as const;
export type SourceRunStatus =
  (typeof SourceRunStatus)[keyof typeof SourceRunStatus];

export const SourceRunTrigger = {
  MANUAL: "manual",
  SCHEDULED: "scheduled",
} as const;
export type SourceRunTrigger =
  (typeof SourceRunTrigger)[keyof typeof SourceRunTrigger];

export const PageStatus = {
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SKIPPED_UNCHANGED: "skipped_unchanged",
} as const;
export type PageStatus = (typeof PageStatus)[keyof typeof PageStatus];

export const ChatChannel = {
  ADMIN_UI: "admin_ui",
  WIDGET: "widget",
  API: "api",
  CHAT_ENDPOINT: "chat_endpoint",
} as const;
export type ChatChannel = (typeof ChatChannel)[keyof typeof ChatChannel];

export const ChatEndpointType = {
  API: "api",
  HOSTED: "hosted",
} as const;
export type ChatEndpointType = (typeof ChatEndpointType)[keyof typeof ChatEndpointType];

export const ChatStatus = {
  OK: "ok",
  ERROR: "error",
  RATE_LIMITED: "rate_limited",
} as const;
export type ChatStatus = (typeof ChatStatus)[keyof typeof ChatStatus];

export const DeletionObjectType = {
  KB: "kb",
  SOURCE: "source",
  AGENT: "agent",
  TENANT: "tenant",
} as const;
export type DeletionObjectType =
  (typeof DeletionObjectType)[keyof typeof DeletionObjectType];

export const DeletionJobStatus = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;
export type DeletionJobStatus =
  (typeof DeletionJobStatus)[keyof typeof DeletionJobStatus];

export const RerankerType = {
  HEURISTIC: "heuristic",
  CROSS_ENCODER: "cross_encoder",
} as const;
export type RerankerType = (typeof RerankerType)[keyof typeof RerankerType];

export const FetchMode = {
  AUTO: "auto",
  HTML: "html",
  HEADLESS: "headless",
  FIRECRAWL: "firecrawl",
} as const;
export type FetchMode = (typeof FetchMode)[keyof typeof FetchMode];

// ============================================================================
// Zod Schemas
// ============================================================================

export const sourceConfigSchema = z.object({
  mode: z.enum(["single", "list", "sitemap", "domain"]),
  urls: z.array(z.string().url()).optional(),
  url: z.string().url().optional(),
  depth: z.number().int().min(1).max(10).default(3),
  includePatterns: z.array(z.string()).default([]),
  excludePatterns: z.array(z.string()).default([]),
  includeSubdomains: z.boolean().default(false),
  schedule: z.enum(["daily", "weekly"]).nullable().default(null),
  firecrawlEnabled: z.boolean().default(false),
  respectRobotsTxt: z.boolean().default(true),
});
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export const retrievalConfigSchema = z.object({
  topK: z.number().int().min(1).max(50).default(8),
  candidateK: z.number().int().min(1).max(200).default(40),
  rerankerEnabled: z.boolean().default(true),
  rerankerType: z.enum(["heuristic", "cross_encoder"]).default("heuristic"),
});
export type RetrievalConfig = z.infer<typeof retrievalConfigSchema>;

export const ButtonStyle = {
  CIRCLE: "circle",
  PILL: "pill",
  SQUARE: "square",
} as const;
export type ButtonStyle = (typeof ButtonStyle)[keyof typeof ButtonStyle];

export const ButtonSize = {
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large",
} as const;
export type ButtonSize = (typeof ButtonSize)[keyof typeof ButtonSize];

export const ButtonIcon = {
  CHAT: "chat",
  HELP: "help",
  QUESTION: "question",
  MESSAGE: "message",
} as const;
export type ButtonIcon = (typeof ButtonIcon)[keyof typeof ButtonIcon];

export const defaultWidgetTheme = {
  primaryColor: "#0066cc",
  backgroundColor: "#ffffff",
  textColor: "#1a1a1a",
  buttonPosition: "bottom-right" as const,
  borderRadius: 12,
  buttonStyle: "circle" as const,
  buttonSize: "medium" as const,
  buttonText: "Chat with us",
  buttonIcon: "chat" as const,
  buttonColor: "#2563eb",
  customIconUrl: null as string | null,
  customIconSize: null as number | null,
};

export const widgetThemeSchema = z.object({
  primaryColor: z.string().default(defaultWidgetTheme.primaryColor),
  backgroundColor: z.string().default(defaultWidgetTheme.backgroundColor),
  textColor: z.string().default(defaultWidgetTheme.textColor),
  buttonPosition: z.enum(["bottom-right", "bottom-left"]).default(defaultWidgetTheme.buttonPosition),
  borderRadius: z.number().default(defaultWidgetTheme.borderRadius),
  buttonStyle: z.enum(["circle", "pill", "square"]).default(defaultWidgetTheme.buttonStyle),
  buttonSize: z.enum(["small", "medium", "large"]).default(defaultWidgetTheme.buttonSize),
  buttonText: z.string().default(defaultWidgetTheme.buttonText),
  buttonIcon: z.enum(["chat", "help", "question", "message"]).default(defaultWidgetTheme.buttonIcon),
  buttonColor: z.string().default(defaultWidgetTheme.buttonColor),
  customIconUrl: z.string().url().nullable().default(defaultWidgetTheme.customIconUrl),
  customIconSize: z.number().min(12).max(64).nullable().default(defaultWidgetTheme.customIconSize),
});
export type WidgetTheme = z.infer<typeof widgetThemeSchema>;

export const widgetConfigSchema = z.object({
  isPublic: z.boolean().default(true),
  allowedDomains: z.array(z.string()).default([]),
  oidcRequired: z.boolean().default(false),
  theme: widgetThemeSchema.default(() => defaultWidgetTheme),
});
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

// ============================================================================
// API Types
// ============================================================================

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface User {
  id: string;
  primaryEmail: string | null;
  createdAt: Date;
  disabledAt: Date | null;
}

export interface UserIdentity {
  id: string;
  userId: string;
  issuer: string;
  subject: string;
  email: string | null;
  createdAt: Date;
}

export interface TenantMembership {
  tenantId: string;
  userId: string;
  role: TenantRole;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface KnowledgeBase {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  isGlobal: boolean;
  publishedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface Source {
  id: string;
  tenantId: string;
  kbId: string;
  type: SourceType;
  name: string;
  config: SourceConfig;
  enrichmentEnabled: boolean;
  createdBy: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface SourceRun {
  id: string;
  tenantId: string;
  sourceId: string;
  status: SourceRunStatus;
  trigger: SourceRunTrigger;
  startedAt: Date | null;
  finishedAt: Date | null;
  stats: SourceRunStats;
  error: string | null;
  createdAt: Date;
}

export interface SourceRunStats {
  pagesSeen: number;
  pagesIndexed: number;
  pagesFailed: number;
  pagesSkipped?: number;
  tokensEstimated: number;
}

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  systemPrompt: string;
  rerankerEnabled: boolean;
  citationsEnabled: boolean;
  createdBy: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface Citation {
  index: number; // The citation number (1, 2, 3, etc.) as used in the text
  title: string | null;
  url: string | null;
  snippet: string;
  chunkId: string;
}

export interface ChatRequest {
  agentId: string;
  message: string;
  conversationId?: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  conversationId: string;
}

export interface ChatEndpointToken {
  id: string;
  tenantId: string;
  agentId: string;
  token: string;
  name: string | null;
  endpointType: ChatEndpointType;
  createdBy: string;
  createdAt: Date;
  revokedAt: Date | null;
}

// ============================================================================
// Job Types
// ============================================================================

/**
 * Base interface for all job types.
 * requestId allows correlating worker logs with the originating API request.
 * traceId enables distributed tracing across API and worker services.
 */
export interface BaseJob {
  /** Request ID from the originating API request (for log correlation) */
  requestId?: string;
  /** Trace ID for distributed tracing across services */
  traceId?: string;
}

export interface SourceRunStartJob extends BaseJob {
  tenantId: string;
  sourceId: string;
  runId: string;
}

export interface SourceDiscoverUrlsJob extends BaseJob {
  tenantId: string;
  runId: string;
}

export interface PageFetchJob extends BaseJob {
  tenantId: string;
  runId: string;
  url: string;
  fetchMode: FetchMode;
  depth?: number; // Current depth in the crawl (0 = starting page)
}

export interface PageProcessJob extends BaseJob {
  tenantId: string;
  runId: string;
  url: string;
  html: string;
  title: string | null;
  depth?: number; // Current depth in the crawl (0 = starting page)
}

export interface EmbedChunksBatchJob extends BaseJob {
  tenantId: string;
  kbId: string;
  chunkIds: string[];
  runId?: string; // Source run ID for tracking embedding progress
}

export interface EnrichPageJob extends BaseJob {
  tenantId: string;
  kbId: string;
  chunkIds: string[];
}

export interface SourceRunFinalizeJob extends BaseJob {
  tenantId: string;
  runId: string;
}

export interface HardDeleteObjectJob extends BaseJob {
  tenantId: string;
  objectType: DeletionObjectType;
  objectId: string;
}

export interface KbReindexJob extends BaseJob {
  tenantId: string | null; // null for global KBs
  kbId: string;
  newEmbeddingModelId: string;
  newEmbeddingDimensions: number;
}

// ============================================================================
// Quota Types
// ============================================================================

export interface TenantQuotas {
  maxKbs: number;
  maxAgents: number;
  maxUploadedDocsPerMonth: number;
  maxScrapedPagesPerMonth: number;
  maxCrawlConcurrency: number;
}

export const DEFAULT_QUOTAS: TenantQuotas = {
  maxKbs: 10,
  maxAgents: 10,
  maxUploadedDocsPerMonth: 1000,
  maxScrapedPagesPerMonth: 1000,
  maxCrawlConcurrency: 5,
};
