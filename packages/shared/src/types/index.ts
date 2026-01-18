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

// ============================================================================
// Ingestion Stage Pipeline
// ============================================================================

/**
 * Defines the six stages in the ingestion pipeline.
 * Each URL/document flows through these stages sequentially.
 */
export const IngestionStage = {
  /** URL discovery from source config (sitemap, list, domain crawl) */
  DISCOVER: "discover",
  /** Fetch raw HTML/content from URL */
  FETCH: "fetch",
  /** Extract main content, headings, and metadata from raw HTML */
  EXTRACT: "extract",
  /** Split content into chunks with overlap */
  CHUNK: "chunk",
  /** Generate vector embeddings for chunks */
  EMBED: "embed",
  /** Store vectors in vector database for retrieval */
  INDEX: "index",
} as const;
export type IngestionStage = (typeof IngestionStage)[keyof typeof IngestionStage];

/**
 * Status of a single stage in the pipeline.
 */
export const StageStatus = {
  /** Stage not yet started */
  PENDING: "pending",
  /** Stage currently processing */
  IN_PROGRESS: "in_progress",
  /** Stage completed successfully */
  COMPLETED: "completed",
  /** Stage failed with retryable error */
  FAILED_RETRYABLE: "failed_retryable",
  /** Stage failed with permanent error */
  FAILED_PERMANENT: "failed_permanent",
  /** Stage skipped (e.g., unchanged content) */
  SKIPPED: "skipped",
} as const;
export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

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

export const RagType = {
  SIMPLE: "simple",
  ADVANCED: "advanced",
} as const;
export type RagType = (typeof RagType)[keyof typeof RagType];

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
  historyTurns: z.number().int().min(1).max(20).default(5),
  advancedMaxSubqueries: z.number().int().min(1).max(5).default(3),
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

// ============================================================================
// Ingestion Stage Contract Types
// ============================================================================

/**
 * Per-stage timestamps for tracking pipeline progress.
 * Stored in SourceRunStats for overall run timing.
 */
export interface StageTimestamps {
  /** When the stage started processing */
  startedAt?: string;
  /** When the stage completed (success or failure) */
  finishedAt?: string;
}

/**
 * Extended stats for source runs with per-stage tracking.
 * This extends SourceRunStats to maintain backwards compatibility.
 */
export interface SourceRunStatsV2 extends SourceRunStats {
  /** Per-stage aggregate counts */
  stages?: {
    discover?: {
      urlsFound: number;
      startedAt?: string;
      finishedAt?: string;
    };
    fetch?: {
      succeeded: number;
      failed: number;
      skipped: number;
      startedAt?: string;
      finishedAt?: string;
    };
    extract?: {
      succeeded: number;
      failed: number;
      startedAt?: string;
      finishedAt?: string;
    };
    chunk?: {
      chunksCreated: number;
      startedAt?: string;
      finishedAt?: string;
    };
    embed?: {
      succeeded: number;
      failed: number;
      startedAt?: string;
      finishedAt?: string;
    };
    index?: {
      vectorsStored: number;
      startedAt?: string;
      finishedAt?: string;
    };
  };
}

/**
 * Stage input/output contract definitions.
 * Documents the data flowing between each pipeline stage.
 */
export interface StageContracts {
  /**
   * DISCOVER stage
   * Input: Source configuration (URLs, sitemap URL, domain settings)
   * Output: List of URLs to process
   */
  discover: {
    input: {
      sourceId: string;
      config: {
        mode: "single" | "list" | "sitemap" | "domain";
        urls?: string[];
        url?: string;
        depth?: number;
        includePatterns?: string[];
        excludePatterns?: string[];
      };
    };
    output: {
      urls: string[];
      urlCount: number;
    };
  };

  /**
   * FETCH stage
   * Input: URL to fetch
   * Output: Raw HTML content and metadata
   */
  fetch: {
    input: {
      url: string;
      fetchMode: "auto" | "html" | "headless" | "firecrawl";
    };
    output: {
      html: string;
      title: string | null;
      httpStatus: number;
      contentType: string;
    };
  };

  /**
   * EXTRACT stage
   * Input: Raw HTML content
   * Output: Cleaned main content with structure
   */
  extract: {
    input: {
      html: string;
      url: string;
    };
    output: {
      content: string;
      title: string;
      headings: { level: number; text: string }[];
      contentHash: string;
    };
  };

  /**
   * CHUNK stage
   * Input: Extracted content
   * Output: Array of overlapping chunks
   */
  chunk: {
    input: {
      content: string;
      title: string;
      headings: { level: number; text: string }[];
      url: string;
    };
    output: {
      chunks: {
        content: string;
        chunkIndex: number;
        heading: string | null;
        sectionPath: string[];
        tokenCount: number;
      }[];
    };
  };

  /**
   * EMBED stage
   * Input: Chunk content
   * Output: Vector embedding
   */
  embed: {
    input: {
      chunkIds: string[];
      embeddingModelId: string;
    };
    output: {
      embeddings: {
        chunkId: string;
        vector: number[];
        dimensions: number;
      }[];
    };
  };

  /**
   * INDEX stage
   * Input: Chunk ID and embedding vector
   * Output: Confirmation of vector storage
   */
  index: {
    input: {
      chunkId: string;
      vector: number[];
      kbId: string;
    };
    output: {
      stored: boolean;
      vectorId: string;
    };
  };
}

/**
 * Per-page stage status tracking.
 * Records the status and timing of each stage for a specific page/URL.
 */
export interface PageStageStatus {
  /** The ingestion stage */
  stage: IngestionStage;
  /** Current status of this stage */
  status: StageStatus;
  /** When this stage started */
  startedAt?: string;
  /** When this stage finished */
  finishedAt?: string;
  /** Error message if failed */
  error?: string;
  /** Number of retry attempts */
  retryCount?: number;
  /** Output metadata (stage-specific) */
  metadata?: Record<string, unknown>;
}

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  systemPrompt: string;
  rerankerEnabled: boolean;
  citationsEnabled: boolean;
  ragType: RagType;
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
