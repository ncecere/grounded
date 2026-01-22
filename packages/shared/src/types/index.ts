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

export const SourceRunStage = {
  DISCOVERING: "discovering",
  SCRAPING: "scraping",
  PROCESSING: "processing",
  INDEXING: "indexing",
  EMBEDDING: "embedding",
  COMPLETED: "completed",
} as const;
export type SourceRunStage =
  (typeof SourceRunStage)[keyof typeof SourceRunStage];

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
  SKIPPED_NON_HTML: "skipped_non_html",
} as const;
export type PageStatus = (typeof PageStatus)[keyof typeof PageStatus];

// ============================================================================
// Skip Reason Tracking
// ============================================================================

/**
 * Categorized reasons for skipping a page during ingestion.
 */
export const SkipReason = {
  /** Content type is not HTML (e.g., PDF, image, JSON) */
  NON_HTML_CONTENT_TYPE: "non_html_content_type",
  /** Content unchanged since last crawl (hash match) */
  CONTENT_UNCHANGED: "content_unchanged",
  /** URL blocked by robots.txt */
  ROBOTS_BLOCKED: "robots_blocked",
  /** URL exceeds depth limit */
  DEPTH_EXCEEDED: "depth_exceeded",
  /** URL excluded by pattern filter */
  PATTERN_EXCLUDED: "pattern_excluded",
  /** URL already crawled in this run */
  ALREADY_CRAWLED: "already_crawled",
} as const;
export type SkipReason = (typeof SkipReason)[keyof typeof SkipReason];

/**
 * Detailed metadata for a skipped page.
 * Stored in sourceRunPageStages.metadata for the relevant stage.
 */
export interface PageSkipDetails {
  /** The categorized skip reason */
  reason: SkipReason;
  /** Human-readable description of why the page was skipped */
  description: string;
  /** The stage at which the skip occurred */
  stage: IngestionStage;
  /** Timestamp when the skip was recorded */
  skippedAt: string;
  /** Additional details specific to the skip reason */
  details?: {
    /** For non-HTML skips: the detected content type */
    contentType?: string;
    /** For non-HTML skips: the parsed MIME type */
    mimeType?: string;
    /** For non-HTML skips: the content category (non_html, unknown) */
    contentCategory?: "non_html" | "unknown";
    /** For content unchanged skips: the content hash */
    contentHash?: string;
    /** For depth exceeded skips: the actual depth */
    depth?: number;
    /** For depth exceeded skips: the max allowed depth */
    maxDepth?: number;
    /** For pattern excluded skips: the pattern that matched */
    pattern?: string;
    /** HTTP status code if relevant */
    httpStatus?: number;
  };
}

/**
 * Creates skip details for a non-HTML content type skip.
 *
 * @param contentType - The raw content-type header
 * @param mimeType - The parsed MIME type
 * @param contentCategory - The category of the content (non_html, unknown)
 * @param httpStatus - Optional HTTP status code
 * @returns PageSkipDetails for the non-HTML skip
 */
export function createNonHtmlSkipDetails(
  contentType: string,
  mimeType: string,
  contentCategory: "non_html" | "unknown",
  httpStatus?: number
): PageSkipDetails {
  return {
    reason: SkipReason.NON_HTML_CONTENT_TYPE,
    description: `Content type "${mimeType}" is not HTML`,
    stage: IngestionStage.FETCH,
    skippedAt: new Date().toISOString(),
    details: {
      contentType,
      mimeType,
      contentCategory,
      httpStatus,
    },
  };
}

/**
 * Creates skip details for an unchanged content skip.
 *
 * @param contentHash - The content hash that matched
 * @returns PageSkipDetails for the unchanged content skip
 */
export function createContentUnchangedSkipDetails(
  contentHash: string
): PageSkipDetails {
  return {
    reason: SkipReason.CONTENT_UNCHANGED,
    description: "Content unchanged since last crawl",
    stage: IngestionStage.FETCH,
    skippedAt: new Date().toISOString(),
    details: {
      contentHash,
    },
  };
}

/**
 * Creates skip details for a robots.txt blocked skip.
 *
 * @param url - The blocked URL
 * @param matchedRule - Optional: the rule that blocked the URL
 * @param userAgent - Optional: the user agent used for matching
 * @returns PageSkipDetails for the robots blocked skip
 */
export function createRobotsBlockedSkipDetails(
  url: string,
  matchedRule?: string,
  userAgent?: string
): PageSkipDetails {
  return {
    reason: SkipReason.ROBOTS_BLOCKED,
    description: `URL blocked by robots.txt${matchedRule ? `: ${matchedRule}` : ""}`,
    stage: IngestionStage.DISCOVER,
    skippedAt: new Date().toISOString(),
    details: matchedRule || userAgent ? {
      pattern: matchedRule,
      // Store user agent in pattern field for consistency with existing schema
    } : undefined,
  };
}

/**
 * Creates skip details for a depth exceeded skip.
 *
 * @param depth - The actual depth of the URL
 * @param maxDepth - The maximum allowed depth
 * @returns PageSkipDetails for the depth exceeded skip
 */
export function createDepthExceededSkipDetails(
  depth: number,
  maxDepth: number
): PageSkipDetails {
  return {
    reason: SkipReason.DEPTH_EXCEEDED,
    description: `URL depth ${depth} exceeds maximum ${maxDepth}`,
    stage: IngestionStage.DISCOVER,
    skippedAt: new Date().toISOString(),
    details: {
      depth,
      maxDepth,
    },
  };
}

/**
 * Creates skip details for a pattern exclusion skip.
 *
 * @param pattern - The pattern that caused the exclusion
 * @returns PageSkipDetails for the pattern excluded skip
 */
export function createPatternExcludedSkipDetails(
  pattern: string
): PageSkipDetails {
  return {
    reason: SkipReason.PATTERN_EXCLUDED,
    description: `URL excluded by pattern: ${pattern}`,
    stage: IngestionStage.DISCOVER,
    skippedAt: new Date().toISOString(),
    details: {
      pattern,
    },
  };
}

/**
 * Creates skip details for an already crawled skip.
 *
 * @returns PageSkipDetails for the already crawled skip
 */
export function createAlreadyCrawledSkipDetails(): PageSkipDetails {
  return {
    reason: SkipReason.ALREADY_CRAWLED,
    description: "URL already crawled in this run",
    stage: IngestionStage.DISCOVER,
    skippedAt: new Date().toISOString(),
  };
}

/**
 * Maps a SkipReason to the appropriate PageStatus.
 *
 * @param reason - The skip reason
 * @returns The corresponding PageStatus
 */
export function skipReasonToPageStatus(reason: SkipReason): PageStatus {
  switch (reason) {
    case SkipReason.NON_HTML_CONTENT_TYPE:
      return PageStatus.SKIPPED_NON_HTML;
    case SkipReason.CONTENT_UNCHANGED:
      return PageStatus.SKIPPED_UNCHANGED;
    // Future skip reasons can map to their own statuses
    case SkipReason.ROBOTS_BLOCKED:
    case SkipReason.DEPTH_EXCEEDED:
    case SkipReason.PATTERN_EXCLUDED:
    case SkipReason.ALREADY_CRAWLED:
      // These currently don't have dedicated statuses, but pages are typically
      // not created for these cases. If they were, they would use a generic skip.
      return PageStatus.SKIPPED_UNCHANGED; // Placeholder for future expansion
    default:
      return PageStatus.SKIPPED_UNCHANGED;
  }
}

/**
 * Checks if a PageStatus indicates the page was skipped (not failed or succeeded).
 *
 * @param status - The page status to check
 * @returns true if the status is a skip status
 */
export function isSkippedStatus(status: PageStatus): boolean {
  return (
    status === PageStatus.SKIPPED_UNCHANGED ||
    status === PageStatus.SKIPPED_NON_HTML
  );
}

/**
 * Gets the SkipReason from a PageStatus if applicable.
 *
 * @param status - The page status
 * @returns The associated SkipReason or undefined if not a skip status
 */
export function pageStatusToSkipReason(status: PageStatus): SkipReason | undefined {
  switch (status) {
    case PageStatus.SKIPPED_NON_HTML:
      return SkipReason.NON_HTML_CONTENT_TYPE;
    case PageStatus.SKIPPED_UNCHANGED:
      return SkipReason.CONTENT_UNCHANGED;
    default:
      return undefined;
  }
}

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

export interface UserTenant {
  id: string;
  name: string;
  slug: string;
  role: TenantRole;
}

export interface TenantMember {
  userId: string;
  email: string;
  role: TenantRole;
  createdAt: string;
}

export interface TenantAlertSettings {
  tenantId: string;
  enabled: boolean;
  notifyOwners: boolean;
  notifyAdmins: boolean;
  additionalEmails: string | null;
  errorRateThreshold: number | null;
  quotaWarningThreshold: number | null;
  inactivityDays: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TenantApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdBy: string;
}

export interface TenantApiKeyWithSecret extends TenantApiKey {
  apiKey: string;
}

export interface AvailableTenant {
  id: string;
  name: string;
  slug: string;
  isShared: boolean;
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
  tenantId: string | null;
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
  tenantId: string | null;
  sourceId: string;
  status: SourceRunStatus;
  stage: SourceRunStage | null;
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
  tenantId: string | null;
  sourceId: string;
  runId: string;
}

export interface SourceDiscoverUrlsJob extends BaseJob {
  tenantId: string | null;
  runId: string;
}

export interface PageFetchJob extends BaseJob {
  tenantId: string | null;
  runId: string;
  url: string;
  fetchMode: FetchMode;
  depth?: number; // Current depth in the crawl (0 = starting page)
}

export interface PageProcessJob extends BaseJob {
  tenantId: string | null;
  runId: string;
  url: string;
  html: string;
  title: string | null;
  depth?: number; // Current depth in the crawl (0 = starting page)
  sourceType?: "web" | "upload";
  uploadMetadata?: {
    uploadId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  };
}

export interface PageIndexJob extends BaseJob {
  tenantId: string | null;
  runId: string;
  pageId: string;
  contentId: string;
  sourceType?: "web" | "upload";
  uploadMetadata?: {
    uploadId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  };
}

export interface EmbedChunksBatchJob extends BaseJob {
  tenantId: string | null;
  kbId: string;
  chunkIds: string[];
  runId?: string; // Source run ID for tracking embedding progress
}

export interface EnrichPageJob extends BaseJob {
  tenantId: string | null;
  kbId: string;
  chunkIds: string[];
}

export interface SourceRunFinalizeJob extends BaseJob {
  tenantId: string | null;
  runId: string;
}

export interface HardDeleteObjectJob extends BaseJob {
  tenantId: string | null;
  objectType: DeletionObjectType;
  objectId: string;
}

export interface KbReindexJob extends BaseJob {
  tenantId: string | null; // null for global KBs
  kbId: string;
  newEmbeddingModelId: string;
  newEmbeddingDimensions: number;
}

export interface StageTransitionJob extends BaseJob {
  tenantId: string | null;
  runId: string;
  completedStage: SourceRunStage;
}

// ============================================================================
// Standardized Job Payload Schemas
// ============================================================================

/**
 * Zod schema for base job fields.
 * All job payloads should extend this schema.
 */
export const baseJobSchema = z.object({
  /** Request ID from the originating API request (for log correlation) */
  requestId: z.string().uuid().optional(),
  /** Trace ID for distributed tracing across services */
  traceId: z.string().optional(),
});

/**
 * Web source configuration for job payloads.
 * Contains web-specific crawl settings.
 */
export const webSourceJobConfigSchema = z.object({
  /** Source type discriminator */
  sourceType: z.literal("web"),
  /** Crawl mode */
  mode: z.enum(["single", "list", "sitemap", "domain"]),
  /** Fetch mode for page retrieval */
  fetchMode: z.enum(["auto", "html", "headless", "firecrawl"]),
  /** Maximum crawl depth (1-10) */
  depth: z.number().int().min(1).max(10).default(3),
  /** URL patterns to include */
  includePatterns: z.array(z.string()).default([]),
  /** URL patterns to exclude */
  excludePatterns: z.array(z.string()).default([]),
  /** Whether to include subdomains in domain mode */
  includeSubdomains: z.boolean().default(false),
  /** Whether to respect robots.txt */
  respectRobotsTxt: z.boolean().default(true),
});
export type WebSourceJobConfig = z.infer<typeof webSourceJobConfigSchema>;

/**
 * Upload source configuration for job payloads.
 * Contains upload-specific file metadata.
 */
export const uploadSourceJobConfigSchema = z.object({
  /** Source type discriminator */
  sourceType: z.literal("upload"),
  /** Upload record ID */
  uploadId: z.string().uuid(),
  /** Original filename */
  filename: z.string(),
  /** MIME type of the uploaded file */
  mimeType: z.string(),
  /** File size in bytes */
  sizeBytes: z.number().int().min(0),
});
export type UploadSourceJobConfig = z.infer<typeof uploadSourceJobConfigSchema>;

/**
 * Discriminated union of source configurations.
 * Used to distinguish between web and upload sources in job payloads.
 */
export const sourceJobConfigSchema = z.discriminatedUnion("sourceType", [
  webSourceJobConfigSchema,
  uploadSourceJobConfigSchema,
]);
export type SourceJobConfig = z.infer<typeof sourceJobConfigSchema>;

// ----------------------------------------------------------------------------
// Web Source Job Payload Schemas
// ----------------------------------------------------------------------------

/**
 * Schema for starting a web source run.
 * Initiates the crawl/scrape pipeline for a web source.
 */
export const webSourceRunStartJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  sourceId: z.string().uuid(),
  runId: z.string().uuid(),
  /** Source configuration for the run */
  sourceConfig: webSourceJobConfigSchema.optional(),
});
export type WebSourceRunStartJobPayload = z.infer<typeof webSourceRunStartJobSchema>;

/**
 * Schema for URL discovery job.
 * Discovers URLs from sitemap, domain crawl, or explicit list.
 */
export const webSourceDiscoverJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  runId: z.string().uuid(),
  /** Crawl configuration for filtering discovered URLs */
  crawlConfig: z
    .object({
      mode: z.enum(["single", "list", "sitemap", "domain"]),
      urls: z.array(z.string().url()).optional(),
      url: z.string().url().optional(),
      depth: z.number().int().min(1).max(10).default(3),
      includePatterns: z.array(z.string()).default([]),
      excludePatterns: z.array(z.string()).default([]),
      includeSubdomains: z.boolean().default(false),
    })
    .optional(),
});
export type WebSourceDiscoverJobPayload = z.infer<typeof webSourceDiscoverJobSchema>;

/**
 * Schema for page fetch job.
 * Fetches raw HTML content from a URL.
 */
export const pageFetchJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  runId: z.string().uuid(),
  /** URL to fetch */
  url: z.string().url(),
  /** Fetch mode (auto, html, headless, firecrawl) */
  fetchMode: z.enum(["auto", "html", "headless", "firecrawl"]),
  /** Current depth in the crawl (0 = starting page) */
  depth: z.number().int().min(0).optional(),
  /** Parent URL that linked to this page (for crawl graphs) */
  parentUrl: z.string().url().optional(),
});
export type PageFetchJobPayload = z.infer<typeof pageFetchJobSchema>;

// ----------------------------------------------------------------------------
// Upload Source Job Payload Schemas
// ----------------------------------------------------------------------------

/**
 * Schema for starting an upload source run.
 * Processes an uploaded document through extraction and chunking.
 */
export const uploadSourceRunStartJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  sourceId: z.string().uuid(),
  runId: z.string().uuid(),
  /** Upload-specific configuration */
  uploadConfig: uploadSourceJobConfigSchema,
});
export type UploadSourceRunStartJobPayload = z.infer<typeof uploadSourceRunStartJobSchema>;

// ----------------------------------------------------------------------------
// Shared Job Payload Schemas (used by both web and upload)
// ----------------------------------------------------------------------------

/**
 * Schema for page/document process job.
 * Processes content into chunks for embedding.
 * Used by both web sources (HTML) and upload sources (extracted text).
 */
export const pageProcessJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  runId: z.string().uuid(),
  /** URL or upload:// URI identifying the content */
  url: z.string(),
  /** Raw content (HTML for web, extracted text for uploads) */
  content: z.string(),
  /** Document title (page title for web, filename for uploads) */
  title: z.string().nullable(),
  /** Current depth in crawl (web only, 0 = starting page) */
  depth: z.number().int().min(0).optional(),
  /** Source type for processing behavior hints */
  sourceType: z.enum(["web", "upload"]).optional(),
  /** Upload metadata (for upload sources only) */
  uploadMetadata: z
    .object({
      uploadId: z.string().uuid(),
      filename: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number().int().min(0),
    })
    .optional(),
});
export type PageProcessJobPayload = z.infer<typeof pageProcessJobSchema>;

/**
 * Schema for page/document indexing job.
 * Reads staged content, chunks it, and queues embeddings.
 */
export const pageIndexJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  runId: z.string().uuid(),
  pageId: z.string().uuid(),
  contentId: z.string().uuid(),
  sourceType: z.enum(["web", "upload"]).optional(),
  uploadMetadata: z
    .object({
      uploadId: z.string().uuid(),
      filename: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number().int().min(0),
    })
    .optional(),
});
export type PageIndexJobPayload = z.infer<typeof pageIndexJobSchema>;

/**
 * Schema for batch embedding job.
 * Generates vector embeddings for a batch of chunks.
 */
export const embedChunksBatchJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  kbId: z.string().uuid(),
  /** Chunk IDs to embed */
  chunkIds: z.array(z.string().uuid()).min(1),
  /** Source run ID for tracking embedding progress */
  runId: z.string().uuid().optional(),
  /** Embedding model configuration */
  embeddingConfig: z
    .object({
      modelId: z.string(),
      dimensions: z.number().int().positive(),
    })
    .optional(),
});
export type EmbedChunksBatchJobPayload = z.infer<typeof embedChunksBatchJobSchema>;

/**
 * Schema for page enrichment job.
 * Enriches chunks with metadata (tags, entities, keywords).
 */
export const enrichPageJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  kbId: z.string().uuid(),
  /** Chunk IDs to enrich */
  chunkIds: z.array(z.string().uuid()).min(1),
  /** Source type hint for enrichment processing */
  sourceType: z.enum(["web", "upload"]).optional(),
});
export type EnrichPageJobPayload = z.infer<typeof enrichPageJobSchema>;

/**
 * Schema for source run finalization job.
 * Finalizes the run and updates completion stats.
 */
export const sourceRunFinalizeJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  runId: z.string().uuid(),
  /** Source type for finalization behavior */
  sourceType: z.enum(["web", "upload"]).optional(),
});
export type SourceRunFinalizeJobPayload = z.infer<typeof sourceRunFinalizeJobSchema>;

/**
 * Schema for hard delete job.
 * Permanently deletes objects and associated data.
 */
export const hardDeleteObjectJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  objectType: z.enum(["kb", "source", "agent", "tenant"]),
  objectId: z.string().uuid(),
  /** Whether to cascade delete related objects */
  cascade: z.boolean().default(true),
});
export type HardDeleteObjectJobPayload = z.infer<typeof hardDeleteObjectJobSchema>;

/**
 * Schema for KB reindex job.
 * Re-embeds all chunks when changing embedding models.
 */
export const kbReindexJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid().nullable(),
  kbId: z.string().uuid(),
  newEmbeddingModelId: z.string(),
  newEmbeddingDimensions: z.number().int().positive(),
  /** Whether to delete old embeddings before reindexing */
  deleteOldEmbeddings: z.boolean().default(true),
});
export type KbReindexJobPayload = z.infer<typeof kbReindexJobSchema>;

// ----------------------------------------------------------------------------
// Job Payload Union Types
// ----------------------------------------------------------------------------

/**
 * Union of all source run job types.
 * Used for routing jobs to appropriate processors.
 */
export type SourceRunJobPayload =
  | WebSourceRunStartJobPayload
  | UploadSourceRunStartJobPayload
  | WebSourceDiscoverJobPayload
  | SourceRunFinalizeJobPayload;

/**
 * Union of all ingestion pipeline job types.
 * Covers the full pipeline from fetch to embed.
 */
export type IngestionJobPayload =
  | PageFetchJobPayload
  | PageProcessJobPayload
  | PageIndexJobPayload
  | EmbedChunksBatchJobPayload
  | EnrichPageJobPayload;

/**
 * Union of all job types.
 */
export type AnyJobPayload =
  | SourceRunJobPayload
  | IngestionJobPayload
  | HardDeleteObjectJobPayload
  | KbReindexJobPayload;

// ----------------------------------------------------------------------------
// Job Payload Validation Helpers
// ----------------------------------------------------------------------------

/**
 * Validates a job payload against its schema.
 * Throws ZodError if validation fails.
 */
export function validateJobPayload<T>(
  schema: z.ZodType<T>,
  payload: unknown
): T {
  return schema.parse(payload);
}

/**
 * Safely validates a job payload, returning a result object.
 */
export function safeValidateJobPayload<T>(
  schema: z.ZodType<T>,
  payload: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(payload);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Type guard to check if a payload is for a web source.
 */
export function isWebSourcePayload(
  payload: SourceJobConfig
): payload is WebSourceJobConfig {
  return payload.sourceType === "web";
}

/**
 * Type guard to check if a payload is for an upload source.
 */
export function isUploadSourcePayload(
  payload: SourceJobConfig
): payload is UploadSourceJobConfig {
  return payload.sourceType === "upload";
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

// ============================================================================
// Queue Configuration Types
// ============================================================================

import {
  QUEUE_NAMES,
  INGESTION_STAGES,
  STAGE_QUEUE_MAPPING,
  STAGE_DEFAULT_CONCURRENCY,
  STAGE_CONCURRENCY_ENV_VARS,
  QUEUE_DEFAULT_CONCURRENCY,
  QUEUE_CONCURRENCY_ENV_VARS,
  DEFAULT_TENANT_CONCURRENCY,
  DEFAULT_DOMAIN_CONCURRENCY,
  DOMAIN_CONCURRENCY_ENV_VAR,
  CONCURRENCY_KEY_PREFIXES,
  CONCURRENCY_KEY_TTL_SECONDS,
  CONCURRENCY_RETRY_DELAY_MS,
} from "../constants";

/**
 * Type for queue names.
 */
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Configuration for a single queue including concurrency settings.
 */
export interface QueueConfig {
  /** Queue name */
  name: QueueName;
  /** Default concurrency for this queue */
  defaultConcurrency: number;
  /** Environment variable to override concurrency */
  concurrencyEnvVar: string;
  /** Stages that use this queue */
  stages: IngestionStage[];
}

/**
 * Gets the queue name for a given ingestion stage.
 */
export function getQueueForStage(stage: IngestionStage): QueueName {
  return STAGE_QUEUE_MAPPING[stage];
}

/**
 * Gets the default concurrency for a given stage.
 */
export function getStageConcurrency(stage: IngestionStage): number {
  return STAGE_DEFAULT_CONCURRENCY[stage];
}

/**
 * Gets the environment variable name for stage concurrency override.
 */
export function getStageConcurrencyEnvVar(stage: IngestionStage): string {
  return STAGE_CONCURRENCY_ENV_VARS[stage];
}

/**
 * Gets the default concurrency for a given queue.
 */
export function getQueueConcurrency(queueName: QueueName): number {
  return QUEUE_DEFAULT_CONCURRENCY[queueName];
}

/**
 * Gets the environment variable name for queue concurrency override.
 */
export function getQueueConcurrencyEnvVar(queueName: QueueName): string {
  return QUEUE_CONCURRENCY_ENV_VARS[queueName];
}

/**
 * Gets all stages that use a given queue.
 */
export function getStagesForQueue(queueName: QueueName): IngestionStage[] {
  return INGESTION_STAGES.filter(
    (stage) => STAGE_QUEUE_MAPPING[stage] === queueName
  );
}

/**
 * Builds a complete queue configuration map.
 */
export function buildQueueConfigMap(): Map<QueueName, QueueConfig> {
  const configMap = new Map<QueueName, QueueConfig>();

  for (const queueName of Object.values(QUEUE_NAMES)) {
    configMap.set(queueName, {
      name: queueName,
      defaultConcurrency: QUEUE_DEFAULT_CONCURRENCY[queueName],
      concurrencyEnvVar: QUEUE_CONCURRENCY_ENV_VARS[queueName],
      stages: getStagesForQueue(queueName),
    });
  }

  return configMap;
}

/**
 * Resolves the effective concurrency for a queue, checking environment variable first.
 * @param queueName - The queue name
 * @param getEnv - Function to get environment variables (to support different environments)
 * @returns The resolved concurrency value
 */
export function resolveQueueConcurrency(
  queueName: QueueName,
  getEnv: (key: string) => string | undefined
): number {
  const envVar = QUEUE_CONCURRENCY_ENV_VARS[queueName];
  const envValue = getEnv(envVar);

  if (envValue !== undefined) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return QUEUE_DEFAULT_CONCURRENCY[queueName];
}

/**
 * Resolves the effective concurrency for a stage, checking environment variable first.
 * @param stage - The ingestion stage
 * @param getEnv - Function to get environment variables
 * @returns The resolved concurrency value
 */
export function resolveStageConcurrency(
  stage: IngestionStage,
  getEnv: (key: string) => string | undefined
): number {
  const envVar = STAGE_CONCURRENCY_ENV_VARS[stage];
  const envValue = getEnv(envVar);

  if (envValue !== undefined) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return STAGE_DEFAULT_CONCURRENCY[stage];
}

// ============================================================================
// Tenant and Domain Concurrency Limit Types
// ============================================================================

/**
 * Result of a concurrency limit check.
 */
export interface ConcurrencyCheckResult {
  /** Whether the request is allowed to proceed */
  allowed: boolean;
  /** Current number of active jobs for this limiter */
  current: number;
  /** Maximum allowed concurrent jobs */
  limit: number;
  /** Key used for this limiter (for debugging/logging) */
  key: string;
  /** Reason for denial if not allowed */
  reason?: "tenant_limit" | "domain_limit" | "tenant_domain_limit";
}

/**
 * Combined result of checking multiple concurrency limits.
 */
export interface CombinedConcurrencyCheckResult {
  /** Whether all limits allow the request */
  allowed: boolean;
  /** Result of tenant-level check */
  tenantCheck?: ConcurrencyCheckResult;
  /** Result of domain-level check */
  domainCheck?: ConcurrencyCheckResult;
  /** Result of tenant+domain check (optional, for stricter control) */
  tenantDomainCheck?: ConcurrencyCheckResult;
  /** The first reason for denial if not allowed */
  reason?: "tenant_limit" | "domain_limit" | "tenant_domain_limit";
}

/**
 * Tracks active job state for cleanup on completion.
 */
export interface ActiveJobTracker {
  /** Unique job identifier */
  jobId: string;
  /** Tenant ID for this job */
  tenantId: string | null;
  /** Domain being fetched (normalized) */
  domain: string;
  /** Timestamp when tracking started */
  startedAt: number;
}

/**
 * Options for concurrency limit operations.
 */
export interface ConcurrencyLimitOptions {
  /** Per-tenant concurrency limit (defaults to TenantQuotas.maxCrawlConcurrency or DEFAULT_TENANT_CONCURRENCY) */
  tenantLimit?: number;
  /** Per-domain concurrency limit (defaults to DEFAULT_DOMAIN_CONCURRENCY) */
  domainLimit?: number;
  /** Whether to also check per-tenant-domain combined limit */
  checkTenantDomainLimit?: boolean;
  /** Per-tenant-per-domain limit when checkTenantDomainLimit is true */
  tenantDomainLimit?: number;
}

/**
 * Metrics snapshot for concurrency tracking.
 */
export interface ConcurrencyMetrics {
  /** Active jobs per tenant (map of tenantId -> count) */
  byTenant: Map<string, number>;
  /** Active jobs per domain (map of domain -> count) */
  byDomain: Map<string, number>;
  /** Total active tracked jobs */
  totalActive: number;
}

// ============================================================================
// Tenant and Domain Concurrency Helper Functions
// ============================================================================

/**
 * Extracts the domain from a URL for concurrency tracking.
 * Normalizes to lowercase and removes 'www.' prefix for consistency.
 *
 * @param url - The URL to extract domain from
 * @returns The normalized domain, or null if URL is invalid
 */
export function extractDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    let domain = parsed.hostname.toLowerCase();
    // Remove www. prefix for normalization
    if (domain.startsWith("www.")) {
      domain = domain.slice(4);
    }
    return domain;
  } catch {
    return null;
  }
}

/**
 * Builds the Redis key for tenant concurrency tracking.
 * @param tenantId - The tenant identifier
 * @returns Redis key string
 */
export function buildTenantConcurrencyKey(tenantId: string): string {
  return `${CONCURRENCY_KEY_PREFIXES.TENANT}${tenantId}`;
}

/**
 * Builds the Redis key for domain concurrency tracking.
 * @param domain - The normalized domain
 * @returns Redis key string
 */
export function buildDomainConcurrencyKey(domain: string): string {
  return `${CONCURRENCY_KEY_PREFIXES.DOMAIN}${domain}`;
}

/**
 * Builds the Redis key for tenant+domain combined tracking.
 * @param tenantId - The tenant identifier
 * @param domain - The normalized domain
 * @returns Redis key string
 */
export function buildTenantDomainConcurrencyKey(
  tenantId: string,
  domain: string
): string {
  return `${CONCURRENCY_KEY_PREFIXES.TENANT_DOMAIN}${tenantId}:${domain}`;
}

/**
 * Resolves the effective domain concurrency limit.
 * Checks environment variable first, then falls back to default.
 *
 * @param getEnv - Function to get environment variables
 * @returns The resolved domain concurrency limit
 */
export function resolveDomainConcurrency(
  getEnv: (key: string) => string | undefined
): number {
  const envValue = getEnv(DOMAIN_CONCURRENCY_ENV_VAR);

  if (envValue !== undefined) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_DOMAIN_CONCURRENCY;
}

/**
 * Gets the effective tenant concurrency limit.
 * Uses the tenant's quota if provided, otherwise falls back to default.
 *
 * @param tenantQuotas - Optional tenant quotas (from database)
 * @returns The effective tenant concurrency limit
 */
export function getTenantConcurrencyLimit(
  tenantQuotas?: Partial<TenantQuotas>
): number {
  if (tenantQuotas?.maxCrawlConcurrency !== undefined) {
    return tenantQuotas.maxCrawlConcurrency;
  }
  return DEFAULT_TENANT_CONCURRENCY;
}

/**
 * Creates default concurrency limit options with resolved values.
 *
 * @param tenantQuotas - Optional tenant quotas
 * @param getEnv - Function to get environment variables
 * @returns Resolved concurrency limit options
 */
export function createConcurrencyLimitOptions(
  tenantQuotas?: Partial<TenantQuotas>,
  getEnv: (key: string) => string | undefined = () => undefined
): Required<Omit<ConcurrencyLimitOptions, "checkTenantDomainLimit" | "tenantDomainLimit">> &
   Pick<ConcurrencyLimitOptions, "checkTenantDomainLimit" | "tenantDomainLimit"> {
  return {
    tenantLimit: getTenantConcurrencyLimit(tenantQuotas),
    domainLimit: resolveDomainConcurrency(getEnv),
    checkTenantDomainLimit: false,
    tenantDomainLimit: undefined,
  };
}

/**
 * Gets the concurrency key TTL in seconds.
 */
export function getConcurrencyKeyTtl(): number {
  return CONCURRENCY_KEY_TTL_SECONDS;
}

/**
 * Gets the retry delay for rate-limited jobs.
 */
export function getConcurrencyRetryDelay(): number {
  return CONCURRENCY_RETRY_DELAY_MS;
}

// Re-export constants for convenience
export {
  DEFAULT_TENANT_CONCURRENCY,
  DEFAULT_DOMAIN_CONCURRENCY,
  DOMAIN_CONCURRENCY_ENV_VAR,
  CONCURRENCY_KEY_PREFIXES,
  CONCURRENCY_KEY_TTL_SECONDS,
  CONCURRENCY_RETRY_DELAY_MS,
};

// ============================================================================
// Embed Backpressure Types and Helpers
// ============================================================================

import {
  DEFAULT_EMBED_QUEUE_THRESHOLD,
  DEFAULT_EMBED_LAG_THRESHOLD,
  EMBED_BACKPRESSURE_DELAY_MS,
  EMBED_BACKPRESSURE_MAX_WAIT_CYCLES,
  EMBED_BACKPRESSURE_ENV_VARS,
  EMBED_BACKPRESSURE_KEY,
  EMBED_BACKPRESSURE_KEY_TTL_SECONDS,
} from "../constants";

/**
 * Result of an embed backpressure check.
 */
export interface EmbedBackpressureCheckResult {
  /** Whether backpressure is detected and the caller should wait */
  shouldWait: boolean;
  /** Current embed queue depth (pending jobs) */
  queueDepth: number;
  /** Current embed lag (chunks awaiting embedding) */
  embedLag: number;
  /** The threshold that was exceeded, if any */
  exceededThreshold?: "queue" | "lag";
  /** Reason for the backpressure decision */
  reason?: string;
}

/**
 * Configuration options for embed backpressure.
 */
export interface EmbedBackpressureConfig {
  /** Threshold for embed queue depth before applying backpressure */
  queueThreshold: number;
  /** Threshold for embed lag before applying backpressure */
  lagThreshold: number;
  /** Delay in ms to wait when backpressure is detected */
  delayMs: number;
  /** Maximum wait cycles before proceeding anyway */
  maxWaitCycles: number;
  /** Whether backpressure is disabled */
  disabled: boolean;
}

/**
 * Status of a backpressure wait operation.
 */
export interface EmbedBackpressureWaitResult {
  /** Whether the caller waited for backpressure to clear */
  waited: boolean;
  /** Number of wait cycles performed */
  waitCycles: number;
  /** Total time spent waiting in ms */
  waitTimeMs: number;
  /** Whether max wait cycles was reached */
  timedOut: boolean;
  /** Final backpressure check result */
  finalCheck: EmbedBackpressureCheckResult;
}

/**
 * Metrics for monitoring embed backpressure.
 */
export interface EmbedBackpressureMetrics {
  /** Current embed queue depth */
  queueDepth: number;
  /** Current embed lag */
  embedLag: number;
  /** Whether backpressure is currently active */
  isActive: boolean;
  /** Queue depth threshold */
  queueThreshold: number;
  /** Lag threshold */
  lagThreshold: number;
  /** Percentage of queue threshold used */
  queueUtilization: number;
  /** Percentage of lag threshold used */
  lagUtilization: number;
}

/**
 * Resolves embed backpressure configuration from environment variables.
 * Falls back to defaults if env vars are not set or invalid.
 *
 * @param getEnv - Function to get environment variables
 * @returns Resolved backpressure configuration
 */
export function resolveEmbedBackpressureConfig(
  getEnv: (key: string) => string | undefined = () => undefined
): EmbedBackpressureConfig {
  const parseIntOrDefault = (value: string | undefined, defaultValue: number): number => {
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
  };

  const isDisabled = (): boolean => {
    const value = getEnv(EMBED_BACKPRESSURE_ENV_VARS.DISABLED);
    return value === "true" || value === "1";
  };

  return {
    queueThreshold: parseIntOrDefault(
      getEnv(EMBED_BACKPRESSURE_ENV_VARS.QUEUE_THRESHOLD),
      DEFAULT_EMBED_QUEUE_THRESHOLD
    ),
    lagThreshold: parseIntOrDefault(
      getEnv(EMBED_BACKPRESSURE_ENV_VARS.LAG_THRESHOLD),
      DEFAULT_EMBED_LAG_THRESHOLD
    ),
    delayMs: parseIntOrDefault(
      getEnv(EMBED_BACKPRESSURE_ENV_VARS.DELAY_MS),
      EMBED_BACKPRESSURE_DELAY_MS
    ),
    maxWaitCycles: parseIntOrDefault(
      getEnv(EMBED_BACKPRESSURE_ENV_VARS.MAX_WAIT_CYCLES),
      EMBED_BACKPRESSURE_MAX_WAIT_CYCLES
    ),
    disabled: isDisabled(),
  };
}

/**
 * Gets the default embed backpressure configuration.
 *
 * @returns Default backpressure configuration
 */
export function getDefaultEmbedBackpressureConfig(): EmbedBackpressureConfig {
  return {
    queueThreshold: DEFAULT_EMBED_QUEUE_THRESHOLD,
    lagThreshold: DEFAULT_EMBED_LAG_THRESHOLD,
    delayMs: EMBED_BACKPRESSURE_DELAY_MS,
    maxWaitCycles: EMBED_BACKPRESSURE_MAX_WAIT_CYCLES,
    disabled: false,
  };
}

/**
 * Checks if backpressure should be applied based on current metrics.
 *
 * @param queueDepth - Current embed queue depth
 * @param embedLag - Current embed lag (chunks awaiting embedding)
 * @param config - Backpressure configuration
 * @returns Check result indicating whether to wait
 */
export function checkEmbedBackpressure(
  queueDepth: number,
  embedLag: number,
  config: EmbedBackpressureConfig
): EmbedBackpressureCheckResult {
  // If backpressure is disabled, never wait
  if (config.disabled) {
    return {
      shouldWait: false,
      queueDepth,
      embedLag,
      reason: "backpressure_disabled",
    };
  }

  // Check queue depth threshold
  if (queueDepth >= config.queueThreshold) {
    return {
      shouldWait: true,
      queueDepth,
      embedLag,
      exceededThreshold: "queue",
      reason: `queue_depth_${queueDepth}_exceeds_threshold_${config.queueThreshold}`,
    };
  }

  // Check lag threshold
  if (embedLag >= config.lagThreshold) {
    return {
      shouldWait: true,
      queueDepth,
      embedLag,
      exceededThreshold: "lag",
      reason: `embed_lag_${embedLag}_exceeds_threshold_${config.lagThreshold}`,
    };
  }

  // No backpressure needed
  return {
    shouldWait: false,
    queueDepth,
    embedLag,
    reason: "within_thresholds",
  };
}

/**
 * Calculates embed backpressure metrics for monitoring.
 *
 * @param queueDepth - Current embed queue depth
 * @param embedLag - Current embed lag
 * @param config - Backpressure configuration
 * @returns Metrics snapshot
 */
export function calculateEmbedBackpressureMetrics(
  queueDepth: number,
  embedLag: number,
  config: EmbedBackpressureConfig
): EmbedBackpressureMetrics {
  const isActive = queueDepth >= config.queueThreshold || embedLag >= config.lagThreshold;

  return {
    queueDepth,
    embedLag,
    isActive,
    queueThreshold: config.queueThreshold,
    lagThreshold: config.lagThreshold,
    queueUtilization: config.queueThreshold > 0 ? (queueDepth / config.queueThreshold) * 100 : 0,
    lagUtilization: config.lagThreshold > 0 ? (embedLag / config.lagThreshold) * 100 : 0,
  };
}

/**
 * Gets the embed backpressure Redis key.
 */
export function getEmbedBackpressureKey(): string {
  return EMBED_BACKPRESSURE_KEY;
}

/**
 * Gets the TTL for embed backpressure tracking key.
 */
export function getEmbedBackpressureKeyTtl(): number {
  return EMBED_BACKPRESSURE_KEY_TTL_SECONDS;
}

// Re-export embed backpressure constants for convenience
export {
  DEFAULT_EMBED_QUEUE_THRESHOLD,
  DEFAULT_EMBED_LAG_THRESHOLD,
  EMBED_BACKPRESSURE_DELAY_MS,
  EMBED_BACKPRESSURE_MAX_WAIT_CYCLES,
  EMBED_BACKPRESSURE_ENV_VARS,
  EMBED_BACKPRESSURE_KEY,
  EMBED_BACKPRESSURE_KEY_TTL_SECONDS,
};

// ============================================================================
// HTML Content-Type Validation
// ============================================================================

import {
  HTML_CONTENT_TYPES,
  NON_HTML_CONTENT_TYPES,
  HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR,
} from "../constants/index.js";

/**
 * Result of content-type validation.
 */
export interface ContentTypeValidationResult {
  /** Whether the content type is valid HTML */
  isValid: boolean;
  /** The raw content-type header value */
  rawContentType: string;
  /** The parsed MIME type (without charset or parameters) */
  mimeType: string;
  /** Charset if present in the content-type header */
  charset?: string;
  /** Reason for rejection (if isValid is false) */
  rejectionReason?: string;
  /** Category of the content type (html, non_html, unknown) */
  category: "html" | "non_html" | "unknown";
}

/**
 * Configuration for content-type validation.
 */
export interface ContentTypeValidationConfig {
  /** Whether HTML content-type enforcement is enabled */
  enabled: boolean;
  /** Allowed MIME types for HTML content */
  allowedTypes: readonly string[];
  /** Explicitly blocked MIME types */
  blockedTypes: readonly string[];
}

/**
 * Parses a content-type header into its components.
 *
 * @param contentType - The raw Content-Type header value
 * @returns Parsed components (mimeType and charset)
 *
 * @example
 * parseContentType("text/html; charset=utf-8")
 * // Returns: { mimeType: "text/html", charset: "utf-8" }
 */
export function parseContentType(contentType: string): {
  mimeType: string;
  charset?: string;
} {
  if (!contentType) {
    return { mimeType: "" };
  }

  // Normalize and split on semicolon
  const normalized = contentType.toLowerCase().trim();
  const parts = normalized.split(";").map((p) => p.trim());

  const mimeType = parts[0] || "";
  let charset: string | undefined;

  // Look for charset parameter
  for (const part of parts.slice(1)) {
    if (part.startsWith("charset=")) {
      charset = part.substring(8).replace(/["']/g, "");
      break;
    }
  }

  return { mimeType, charset };
}

/**
 * Checks if a MIME type is a valid HTML type.
 *
 * @param mimeType - The MIME type to check (lowercase, without parameters)
 * @returns true if the MIME type is in the HTML allowlist
 */
export function isHtmlMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().trim();
  return (HTML_CONTENT_TYPES as readonly string[]).includes(normalized);
}

/**
 * Checks if a MIME type is explicitly blocked (non-HTML).
 *
 * @param mimeType - The MIME type to check
 * @returns true if the MIME type is in the blocked list
 */
export function isBlockedMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().trim();
  return (NON_HTML_CONTENT_TYPES as readonly string[]).includes(normalized);
}

/**
 * Validates a content-type header for HTML content.
 *
 * @param contentType - The raw Content-Type header value (may be null/undefined)
 * @returns Validation result with details
 *
 * @example
 * validateHtmlContentType("text/html; charset=utf-8")
 * // Returns: { isValid: true, rawContentType: "text/html; charset=utf-8", mimeType: "text/html", charset: "utf-8", category: "html" }
 *
 * validateHtmlContentType("application/pdf")
 * // Returns: { isValid: false, rawContentType: "application/pdf", mimeType: "application/pdf", category: "non_html", rejectionReason: "..." }
 */
export function validateHtmlContentType(
  contentType: string | null | undefined
): ContentTypeValidationResult {
  const raw = contentType || "";
  const { mimeType, charset } = parseContentType(raw);

  // Empty content type - treat as unknown, allow through with warning
  if (!mimeType) {
    return {
      isValid: true, // Allow through, as some servers don't send content-type
      rawContentType: raw,
      mimeType: "",
      charset,
      category: "unknown",
    };
  }

  // Check if it's an allowed HTML type
  if (isHtmlMimeType(mimeType)) {
    return {
      isValid: true,
      rawContentType: raw,
      mimeType,
      charset,
      category: "html",
    };
  }

  // Check if it's an explicitly blocked type
  if (isBlockedMimeType(mimeType)) {
    return {
      isValid: false,
      rawContentType: raw,
      mimeType,
      charset,
      category: "non_html",
      rejectionReason: `Content type "${mimeType}" is not HTML (blocked type)`,
    };
  }

  // Unknown type - reject to be safe
  return {
    isValid: false,
    rawContentType: raw,
    mimeType,
    charset,
    category: "unknown",
    rejectionReason: `Content type "${mimeType}" is not in the HTML allowlist`,
  };
}

/**
 * Gets the default content-type validation configuration.
 *
 * @returns Default configuration based on environment variables
 */
export function getContentTypeValidationConfig(): ContentTypeValidationConfig {
  const disabledEnv = process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];
  const isDisabled = disabledEnv === "true" || disabledEnv === "1";

  return {
    enabled: !isDisabled,
    allowedTypes: HTML_CONTENT_TYPES,
    blockedTypes: NON_HTML_CONTENT_TYPES,
  };
}

/**
 * Checks if HTML content-type enforcement is enabled.
 *
 * @returns true if enforcement is enabled, false if disabled via env var
 */
export function isContentTypeEnforcementEnabled(): boolean {
  const disabledEnv = process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];
  return !(disabledEnv === "true" || disabledEnv === "1");
}

// Re-export content-type constants for convenience
export {
  HTML_CONTENT_TYPES,
  NON_HTML_CONTENT_TYPES,
  HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR,
};

// ============================================================================
// Playwright Download Configuration
// ============================================================================

import {
  PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR,
  PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR,
  PLAYWRIGHT_DOWNLOADS_DISABLED_DEFAULT,
  PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_DEFAULT,
} from "../constants";

/**
 * Configuration options for Playwright download handling during crawls.
 */
export interface PlaywrightDownloadConfig {
  /**
   * When true, downloads are blocked by setting acceptDownloads: false on the browser context.
   * Default: true (downloads are disabled by default)
   */
  downloadsDisabled: boolean;

  /**
   * When true, log events when downloads are blocked.
   * Default: true
   */
  logBlockedDownloads: boolean;
}

/**
 * Information about a blocked download event.
 * Used for logging and monitoring purposes.
 */
export interface BlockedDownloadInfo {
  /** URL of the page that triggered the download */
  pageUrl: string;
  /** URL of the download resource (if available) */
  downloadUrl?: string;
  /** Suggested filename for the download (if available) */
  suggestedFilename?: string;
  /** Timestamp when the download was blocked */
  blockedAt: string;
}

/**
 * Checks if Playwright downloads should be disabled during crawl.
 *
 * Downloads are disabled by default to prevent:
 * - Disk space consumption from unexpected file downloads
 * - Slow page loading due to download triggers
 * - Security risks from downloading untrusted files
 *
 * Can be enabled via PLAYWRIGHT_DOWNLOADS_DISABLED=false env var (not recommended).
 *
 * @returns true if downloads should be disabled, false if allowed
 */
export function isPlaywrightDownloadsDisabled(): boolean {
  const envValue = process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
  // If env var is explicitly set to "false" or "0", allow downloads
  if (envValue === "false" || envValue === "0") {
    return false;
  }
  // Otherwise, use the default (disabled)
  return PLAYWRIGHT_DOWNLOADS_DISABLED_DEFAULT;
}

/**
 * Checks if blocked download events should be logged.
 *
 * @returns true if blocked downloads should be logged
 */
export function shouldLogBlockedDownloads(): boolean {
  const envValue = process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
  // If env var is explicitly set to "false" or "0", don't log
  if (envValue === "false" || envValue === "0") {
    return false;
  }
  // Otherwise, use the default (log blocked downloads)
  return PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_DEFAULT;
}

/**
 * Gets the full Playwright download configuration from environment.
 *
 * @returns PlaywrightDownloadConfig with resolved values
 */
export function getPlaywrightDownloadConfig(): PlaywrightDownloadConfig {
  return {
    downloadsDisabled: isPlaywrightDownloadsDisabled(),
    logBlockedDownloads: shouldLogBlockedDownloads(),
  };
}

/**
 * Creates blocked download info for logging.
 *
 * @param pageUrl - URL of the page that triggered the download
 * @param downloadUrl - URL of the download resource (optional)
 * @param suggestedFilename - Suggested filename (optional)
 * @returns BlockedDownloadInfo object
 */
export function createBlockedDownloadInfo(
  pageUrl: string,
  downloadUrl?: string,
  suggestedFilename?: string
): BlockedDownloadInfo {
  return {
    pageUrl,
    downloadUrl,
    suggestedFilename,
    blockedAt: new Date().toISOString(),
  };
}

// Re-export Playwright download constants for convenience
export {
  PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR,
  PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR,
  PLAYWRIGHT_DOWNLOADS_DISABLED_DEFAULT,
  PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_DEFAULT,
};

// ============================================================================
// Exponential Backoff with Jitter
// ============================================================================

import {
  DEFAULT_BACKOFF_BASE_DELAY_MS,
  DEFAULT_BACKOFF_MAX_DELAY_MS,
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_BACKOFF_JITTER_RATIO,
  DEFAULT_MAX_RETRY_ATTEMPTS,
  BACKOFF_ENV_VARS,
  STAGE_BACKOFF_CONFIG,
  STAGE_MAX_RETRIES,
} from "../constants";

/**
 * Configuration options for exponential backoff with jitter.
 */
export interface BackoffConfig {
  /**
   * Base delay in milliseconds for the first retry.
   * Default: 1000ms
   */
  baseDelayMs: number;

  /**
   * Maximum delay cap in milliseconds.
   * Default: 60000ms (1 minute)
   */
  maxDelayMs: number;

  /**
   * Multiplier for exponential growth.
   * Each retry multiplies the delay by this factor.
   * Default: 2
   */
  multiplier: number;

  /**
   * Jitter ratio (0-1) for random delay variation.
   * The actual jitter added is: baseDelay * random(0, jitterRatio)
   * Default: 0.3 (30% max jitter)
   */
  jitterRatio: number;
}

/**
 * Options for retry operations with backoff.
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts.
   * Default: 3
   */
  maxAttempts: number;

  /**
   * Backoff configuration.
   */
  backoff: BackoffConfig;

  /**
   * Optional function to determine if an error is retryable.
   * If not provided, all errors are considered retryable.
   */
  isRetryable?: (error: unknown) => boolean;

  /**
   * Optional callback called before each retry attempt.
   * Useful for logging or tracking.
   */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;

  /**
   * Optional Retry-After value in seconds (from HTTP headers).
   * If provided, this overrides the calculated backoff delay.
   */
  retryAfterSeconds?: number;
}

/**
 * Result of a retry operation.
 */
export interface RetryResult<T> {
  /** Whether the operation eventually succeeded */
  success: boolean;
  /** The result value if successful */
  value?: T;
  /** The final error if all attempts failed */
  error?: unknown;
  /** Total number of attempts made */
  attempts: number;
  /** Total time spent waiting between retries (ms) */
  totalWaitTimeMs: number;
  /** Details of each attempt */
  attemptDetails: RetryAttemptDetail[];
}

/**
 * Details of a single retry attempt.
 */
export interface RetryAttemptDetail {
  /** Attempt number (1-indexed) */
  attempt: number;
  /** Whether this attempt succeeded */
  succeeded: boolean;
  /** Error if the attempt failed */
  error?: unknown;
  /** Delay before this attempt (0 for first attempt) */
  delayBeforeMs: number;
  /** Timestamp when the attempt started */
  startedAt: string;
  /** Duration of the attempt in ms (if tracked) */
  durationMs?: number;
}

/**
 * Information about a calculated backoff delay.
 */
export interface BackoffDelayInfo {
  /** The base exponential delay before jitter */
  baseDelayMs: number;
  /** The jitter amount added */
  jitterMs: number;
  /** The final delay after jitter and cap */
  totalDelayMs: number;
  /** The attempt number this delay is for */
  attempt: number;
  /** Whether the delay was capped at maxDelayMs */
  wasCapped: boolean;
  /** Whether Retry-After header was used */
  usedRetryAfter: boolean;
}

/**
 * Gets the default backoff configuration.
 *
 * @returns Default BackoffConfig
 */
export function getDefaultBackoffConfig(): BackoffConfig {
  return {
    baseDelayMs: DEFAULT_BACKOFF_BASE_DELAY_MS,
    maxDelayMs: DEFAULT_BACKOFF_MAX_DELAY_MS,
    multiplier: DEFAULT_BACKOFF_MULTIPLIER,
    jitterRatio: DEFAULT_BACKOFF_JITTER_RATIO,
  };
}

/**
 * Gets the default retry options.
 *
 * @returns Default RetryOptions
 */
export function getDefaultRetryOptions(): RetryOptions {
  return {
    maxAttempts: DEFAULT_MAX_RETRY_ATTEMPTS,
    backoff: getDefaultBackoffConfig(),
  };
}

/**
 * Resolves backoff configuration from environment variables.
 * Falls back to defaults if env vars are not set or invalid.
 *
 * @param getEnv - Function to get environment variables
 * @returns Resolved BackoffConfig
 */
export function resolveBackoffConfig(
  getEnv: (key: string) => string | undefined = () => undefined
): BackoffConfig {
  const parseIntOrDefault = (
    value: string | undefined,
    defaultValue: number
  ): number => {
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
  };

  const parseFloatOrDefault = (
    value: string | undefined,
    defaultValue: number,
    min = 0,
    max = 1
  ): number => {
    if (value === undefined) return defaultValue;
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < min || parsed > max) return defaultValue;
    return parsed;
  };

  return {
    baseDelayMs: parseIntOrDefault(
      getEnv(BACKOFF_ENV_VARS.BASE_DELAY_MS),
      DEFAULT_BACKOFF_BASE_DELAY_MS
    ),
    maxDelayMs: parseIntOrDefault(
      getEnv(BACKOFF_ENV_VARS.MAX_DELAY_MS),
      DEFAULT_BACKOFF_MAX_DELAY_MS
    ),
    multiplier: parseFloatOrDefault(
      getEnv(BACKOFF_ENV_VARS.MULTIPLIER),
      DEFAULT_BACKOFF_MULTIPLIER,
      1,
      10
    ),
    jitterRatio: parseFloatOrDefault(
      getEnv(BACKOFF_ENV_VARS.JITTER_RATIO),
      DEFAULT_BACKOFF_JITTER_RATIO,
      0,
      1
    ),
  };
}

/**
 * Gets backoff configuration for a specific ingestion stage.
 * Stages have different characteristics that warrant different retry behavior.
 *
 * @param stage - The ingestion stage
 * @returns Stage-specific BackoffConfig
 */
export function getBackoffConfigForStage(stage: IngestionStage): BackoffConfig {
  const stageConfig = STAGE_BACKOFF_CONFIG[stage];
  return {
    baseDelayMs: stageConfig.baseDelayMs,
    maxDelayMs: stageConfig.maxDelayMs,
    multiplier: stageConfig.multiplier,
    jitterRatio: stageConfig.jitterRatio,
  };
}

/**
 * Gets the maximum retry attempts for a specific ingestion stage.
 *
 * @param stage - The ingestion stage
 * @returns Maximum retry attempts for the stage
 */
export function getMaxRetriesForStage(stage: IngestionStage): number {
  return STAGE_MAX_RETRIES[stage];
}

/**
 * Gets complete retry options for a specific ingestion stage.
 *
 * @param stage - The ingestion stage
 * @param overrides - Optional overrides for specific options
 * @returns RetryOptions configured for the stage
 */
export function getRetryOptionsForStage(
  stage: IngestionStage,
  overrides?: Partial<RetryOptions>
): RetryOptions {
  return {
    maxAttempts: overrides?.maxAttempts ?? getMaxRetriesForStage(stage),
    backoff: overrides?.backoff ?? getBackoffConfigForStage(stage),
    isRetryable: overrides?.isRetryable,
    onRetry: overrides?.onRetry,
    retryAfterSeconds: overrides?.retryAfterSeconds,
  };
}

/**
 * Generates a random jitter value based on the jitter ratio.
 * Uses full jitter strategy: jitter = random(0, baseDelay * jitterRatio)
 *
 * @param baseDelayMs - The base delay before jitter
 * @param jitterRatio - The jitter ratio (0-1)
 * @returns Random jitter in milliseconds
 */
export function calculateJitter(
  baseDelayMs: number,
  jitterRatio: number
): number {
  // Full jitter: random value from 0 to baseDelay * jitterRatio
  return Math.floor(Math.random() * baseDelayMs * jitterRatio);
}

/**
 * Calculates the backoff delay for a specific retry attempt.
 * Uses exponential backoff with full jitter.
 *
 * Formula: min(maxDelay, baseDelay * multiplier^(attempt-1)) + jitter
 *
 * @param attempt - The current attempt number (1-indexed)
 * @param config - Backoff configuration
 * @param retryAfterSeconds - Optional Retry-After value from HTTP header
 * @returns BackoffDelayInfo with delay details
 */
export function calculateBackoffDelay(
  attempt: number,
  config: BackoffConfig,
  retryAfterSeconds?: number
): BackoffDelayInfo {
  // If Retry-After is provided, use it (converted to ms)
  if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    const retryAfterMs = retryAfterSeconds * 1000;
    // Add small jitter even to Retry-After to prevent thundering herd
    const jitter = calculateJitter(retryAfterMs, config.jitterRatio * 0.5);
    const totalDelay = Math.min(retryAfterMs + jitter, config.maxDelayMs);
    return {
      baseDelayMs: retryAfterMs,
      jitterMs: jitter,
      totalDelayMs: totalDelay,
      attempt,
      wasCapped: totalDelay < retryAfterMs + jitter,
      usedRetryAfter: true,
    };
  }

  // Calculate exponential base delay: baseDelay * multiplier^(attempt-1)
  // For attempt 1: baseDelay * 2^0 = baseDelay
  // For attempt 2: baseDelay * 2^1 = baseDelay * 2
  // For attempt 3: baseDelay * 2^2 = baseDelay * 4
  const exponentialDelay =
    config.baseDelayMs * Math.pow(config.multiplier, attempt - 1);

  // Cap at maxDelayMs before adding jitter
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const wasCapped = exponentialDelay > config.maxDelayMs;

  // Add jitter
  const jitter = calculateJitter(cappedDelay, config.jitterRatio);

  // Final delay (jitter doesn't exceed the cap, it's additive for better distribution)
  const totalDelay = Math.min(cappedDelay + jitter, config.maxDelayMs);

  return {
    baseDelayMs: cappedDelay,
    jitterMs: jitter,
    totalDelayMs: totalDelay,
    attempt,
    wasCapped,
    usedRetryAfter: false,
  };
}

/**
 * Creates a sequence of backoff delays for a given number of attempts.
 * Useful for previewing the delay schedule.
 *
 * @param maxAttempts - Number of retry attempts to generate delays for
 * @param config - Backoff configuration
 * @returns Array of BackoffDelayInfo for each attempt
 */
export function generateBackoffSchedule(
  maxAttempts: number,
  config: BackoffConfig
): BackoffDelayInfo[] {
  const schedule: BackoffDelayInfo[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    schedule.push(calculateBackoffDelay(attempt, config));
  }
  return schedule;
}

/**
 * Calculates the total maximum wait time for all retries.
 * Useful for timeout planning.
 *
 * @param maxAttempts - Maximum number of retry attempts
 * @param config - Backoff configuration
 * @returns Total maximum wait time in milliseconds
 */
export function calculateMaxTotalWaitTime(
  maxAttempts: number,
  config: BackoffConfig
): number {
  let total = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Use max possible delay (no jitter randomness) for worst-case calculation
    const exponentialDelay =
      config.baseDelayMs * Math.pow(config.multiplier, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
    // Include max possible jitter
    const maxJitter = cappedDelay * config.jitterRatio;
    total += Math.min(cappedDelay + maxJitter, config.maxDelayMs);
  }
  return total;
}

/**
 * Sleep function that returns a promise resolving after the specified delay.
 *
 * @param ms - Delay in milliseconds
 * @returns Promise that resolves after the delay
 */
export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a function with exponential backoff retry logic.
 * Only retries on retryable errors (uses isRetryable function if provided).
 *
 * @param fn - The async function to execute
 * @param options - Retry options
 * @returns RetryResult with success/failure details
 */
export async function executeWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<RetryResult<T>> {
  const attemptDetails: RetryAttemptDetail[] = [];
  let totalWaitTimeMs = 0;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    // Calculate delay for this attempt (0 for first attempt)
    const delayInfo =
      attempt === 1
        ? { totalDelayMs: 0, baseDelayMs: 0, jitterMs: 0, attempt: 1, wasCapped: false, usedRetryAfter: false }
        : calculateBackoffDelay(attempt, options.backoff, options.retryAfterSeconds);

    // Wait before this attempt (except for first attempt)
    if (attempt > 1 && delayInfo.totalDelayMs > 0) {
      await sleepMs(delayInfo.totalDelayMs);
      totalWaitTimeMs += delayInfo.totalDelayMs;
    }

    try {
      const value = await fn();
      const durationMs = Date.now() - startTime;

      attemptDetails.push({
        attempt,
        succeeded: true,
        delayBeforeMs: delayInfo.totalDelayMs,
        startedAt,
        durationMs,
      });

      return {
        success: true,
        value,
        attempts: attempt,
        totalWaitTimeMs,
        attemptDetails,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      lastError = error;

      attemptDetails.push({
        attempt,
        succeeded: false,
        error,
        delayBeforeMs: delayInfo.totalDelayMs,
        startedAt,
        durationMs,
      });

      // Check if error is retryable
      const isRetryable = options.isRetryable
        ? options.isRetryable(error)
        : true;

      // If not retryable or this was the last attempt, stop retrying
      if (!isRetryable || attempt >= options.maxAttempts) {
        break;
      }

      // Calculate delay for next attempt (for onRetry callback)
      const nextDelayInfo = calculateBackoffDelay(
        attempt + 1,
        options.backoff,
        options.retryAfterSeconds
      );

      // Call onRetry callback if provided
      if (options.onRetry) {
        options.onRetry(attempt, error, nextDelayInfo.totalDelayMs);
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: attemptDetails.length,
    totalWaitTimeMs,
    attemptDetails,
  };
}

/**
 * Creates a retry function bound to specific options.
 * Useful for creating reusable retry wrappers.
 *
 * @param options - Default retry options
 * @returns Bound retry function
 */
export function createRetryFunction(
  options: RetryOptions
): <T>(fn: () => Promise<T>) => Promise<RetryResult<T>> {
  return <T>(fn: () => Promise<T>) => executeWithBackoff(fn, options);
}

/**
 * Creates a stage-specific retry function.
 *
 * @param stage - The ingestion stage
 * @param overrides - Optional overrides for retry options
 * @returns Bound retry function for the stage
 */
export function createStageRetryFunction(
  stage: IngestionStage,
  overrides?: Partial<RetryOptions>
): <T>(fn: () => Promise<T>) => Promise<RetryResult<T>> {
  const options = getRetryOptionsForStage(stage, overrides);
  return createRetryFunction(options);
}

// Re-export backoff constants for convenience
export {
  DEFAULT_BACKOFF_BASE_DELAY_MS,
  DEFAULT_BACKOFF_MAX_DELAY_MS,
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_BACKOFF_JITTER_RATIO,
  DEFAULT_MAX_RETRY_ATTEMPTS,
  BACKOFF_ENV_VARS,
  STAGE_BACKOFF_CONFIG,
};

// ============================================================================
// Stage Retry Limiting and Outcome Logging
// ============================================================================

/**
 * Outcome types for retry operations.
 * Used for structured logging and metrics.
 */
export const RetryOutcome = {
  /** Operation succeeded on first attempt without any retries */
  SUCCESS_NO_RETRY: "success_no_retry",
  /** Operation succeeded after one or more retries */
  SUCCESS_AFTER_RETRY: "success_after_retry",
  /** Operation failed but max retries not exhausted (non-retryable error) */
  FAILURE_NON_RETRYABLE: "failure_non_retryable",
  /** Operation failed after exhausting all retry attempts */
  FAILURE_MAX_RETRIES_EXHAUSTED: "failure_max_retries_exhausted",
  /** Operation was skipped (e.g., already processed) */
  SKIPPED: "skipped",
} as const;
export type RetryOutcome = (typeof RetryOutcome)[keyof typeof RetryOutcome];

/**
 * Detailed log entry for a retry outcome.
 * Designed for structured logging and observability.
 */
export interface RetryOutcomeLog {
  /** Timestamp when the outcome was recorded */
  timestamp: string;
  /** The ingestion stage where the retry occurred */
  stage: IngestionStage;
  /** The final outcome of the retry operation */
  outcome: RetryOutcome;
  /** Total number of attempts made (including first attempt) */
  totalAttempts: number;
  /** Maximum attempts allowed for this stage */
  maxAttempts: number;
  /** Total time spent waiting between retries (ms) */
  totalWaitTimeMs: number;
  /** Total execution time including all attempts (ms) */
  totalExecutionTimeMs: number;
  /** Resource identifier (URL, chunk ID, etc.) */
  resourceId?: string;
  /** Tenant ID for multi-tenant tracking */
  tenantId?: string;
  /** Run ID for source run tracking */
  runId?: string;
  /** Error information if the operation failed */
  error?: {
    /** Error code from the error taxonomy */
    code: string;
    /** Error category */
    category: string;
    /** Error message */
    message: string;
    /** Whether the error was retryable */
    retryable: boolean;
  };
  /** Per-attempt summary for debugging */
  attemptSummary?: {
    /** Attempt number (1-indexed) */
    attempt: number;
    /** Whether this attempt succeeded */
    succeeded: boolean;
    /** Delay before this attempt (ms) */
    delayBeforeMs: number;
    /** Duration of the attempt (ms) */
    durationMs?: number;
    /** Error code if failed */
    errorCode?: string;
  }[];
}

/**
 * Configuration for retry outcome logging.
 */
export interface RetryOutcomeLogConfig {
  /** Whether to include detailed attempt summaries in logs */
  includeAttemptDetails: boolean;
  /** Whether to log successful operations (can be noisy) */
  logSuccesses: boolean;
  /** Minimum attempts before logging a success (to reduce noise) */
  minAttemptsToLogSuccess: number;
}

/**
 * Statistics for retry outcomes, useful for metrics and monitoring.
 */
export interface RetryOutcomeStats {
  /** Stage these stats are for */
  stage: IngestionStage;
  /** Time period start */
  periodStart: string;
  /** Time period end */
  periodEnd: string;
  /** Total operations processed */
  totalOperations: number;
  /** Count by outcome type */
  outcomes: Record<RetryOutcome, number>;
  /** Average attempts for successful operations */
  avgAttemptsOnSuccess: number;
  /** Average wait time for successful operations (ms) */
  avgWaitTimeOnSuccessMs: number;
  /** Total retries performed */
  totalRetries: number;
  /** Success rate (0-1) */
  successRate: number;
}

/**
 * Gets the default retry outcome log configuration.
 *
 * @returns Default RetryOutcomeLogConfig
 */
export function getDefaultRetryOutcomeLogConfig(): RetryOutcomeLogConfig {
  return {
    includeAttemptDetails: true,
    logSuccesses: true,
    minAttemptsToLogSuccess: 1, // Log all successes by default
  };
}

/**
 * Determines the retry outcome based on retry result.
 *
 * @param result - The retry result from executeWithBackoff
 * @param isRetryable - Function to check if the error was retryable
 * @returns The classified retry outcome
 */
export function classifyRetryOutcome<T>(
  result: RetryResult<T>,
  isRetryable?: (error: unknown) => boolean
): RetryOutcome {
  if (result.success) {
    return result.attempts === 1
      ? RetryOutcome.SUCCESS_NO_RETRY
      : RetryOutcome.SUCCESS_AFTER_RETRY;
  }

  // Failed - determine if it was due to max retries or non-retryable error
  if (result.error !== undefined) {
    // Check if the final error was retryable
    const wasRetryable = isRetryable ? isRetryable(result.error) : true;

    if (!wasRetryable) {
      return RetryOutcome.FAILURE_NON_RETRYABLE;
    }
  }

  // If we made all attempts and still failed, max retries were exhausted
  return RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED;
}

/**
 * Creates a structured retry outcome log entry.
 *
 * @param stage - The ingestion stage
 * @param result - The retry result
 * @param maxAttempts - Maximum attempts allowed
 * @param context - Additional context (resourceId, tenantId, runId)
 * @param errorInfo - Optional error information for failed operations
 * @param config - Optional log configuration
 * @returns Structured log entry
 */
export function createRetryOutcomeLog<T>(
  stage: IngestionStage,
  result: RetryResult<T>,
  maxAttempts: number,
  context?: {
    resourceId?: string;
    tenantId?: string;
    runId?: string;
    executionStartTime?: number;
  },
  errorInfo?: {
    code: string;
    category: string;
    message: string;
    retryable: boolean;
  },
  config?: Partial<RetryOutcomeLogConfig>
): RetryOutcomeLog {
  const fullConfig = { ...getDefaultRetryOutcomeLogConfig(), ...config };
  const isRetryable = errorInfo ? () => errorInfo.retryable : undefined;
  const outcome = classifyRetryOutcome(result, isRetryable);

  const log: RetryOutcomeLog = {
    timestamp: new Date().toISOString(),
    stage,
    outcome,
    totalAttempts: result.attempts,
    maxAttempts,
    totalWaitTimeMs: result.totalWaitTimeMs,
    totalExecutionTimeMs: context?.executionStartTime
      ? Date.now() - context.executionStartTime
      : result.attemptDetails.reduce((sum, d) => sum + (d.durationMs || 0), 0) +
        result.totalWaitTimeMs,
    resourceId: context?.resourceId,
    tenantId: context?.tenantId,
    runId: context?.runId,
  };

  // Add error info for failures
  if (!result.success && errorInfo) {
    log.error = errorInfo;
  }

  // Add attempt details if configured
  if (fullConfig.includeAttemptDetails && result.attemptDetails.length > 0) {
    log.attemptSummary = result.attemptDetails.map((detail) => ({
      attempt: detail.attempt,
      succeeded: detail.succeeded,
      delayBeforeMs: detail.delayBeforeMs,
      durationMs: detail.durationMs,
      errorCode: detail.error
        ? getErrorCodeFromError(detail.error)
        : undefined,
    }));
  }

  return log;
}

/**
 * Extracts an error code from an error object.
 * Helper for creating retry outcome logs.
 *
 * @param error - The error to extract code from
 * @returns Error code string or "UNKNOWN_ERROR"
 */
function getErrorCodeFromError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  if (error instanceof Error) {
    // Try to extract code from message patterns
    const message = error.message;
    if (message.includes("timeout")) return "NETWORK_TIMEOUT";
    if (message.includes("rate limit")) return "SERVICE_RATE_LIMITED";
    if (message.includes("not found")) return "NOT_FOUND_RESOURCE";
  }
  return "UNKNOWN_ERROR";
}

/**
 * Determines if a retry outcome log should be written based on configuration.
 *
 * @param log - The retry outcome log
 * @param config - Log configuration
 * @returns true if the log should be written
 */
export function shouldLogRetryOutcome(
  log: RetryOutcomeLog,
  config?: Partial<RetryOutcomeLogConfig>
): boolean {
  const fullConfig = { ...getDefaultRetryOutcomeLogConfig(), ...config };

  // Always log failures
  if (
    log.outcome === RetryOutcome.FAILURE_NON_RETRYABLE ||
    log.outcome === RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED
  ) {
    return true;
  }

  // Check if we should log successes
  if (!fullConfig.logSuccesses) {
    return false;
  }

  // Check minimum attempts threshold for success logging
  return log.totalAttempts >= fullConfig.minAttemptsToLogSuccess;
}

/**
 * Formats a retry outcome log for human-readable output.
 * Useful for console logging during development.
 *
 * @param log - The retry outcome log
 * @returns Formatted string
 */
export function formatRetryOutcomeLog(log: RetryOutcomeLog): string {
  const parts: string[] = [
    `[${log.stage.toUpperCase()}]`,
    log.outcome,
    `attempts=${log.totalAttempts}/${log.maxAttempts}`,
    `waitTime=${log.totalWaitTimeMs}ms`,
    `totalTime=${log.totalExecutionTimeMs}ms`,
  ];

  if (log.resourceId) {
    parts.push(`resource=${log.resourceId}`);
  }

  if (log.error) {
    parts.push(`error=${log.error.code}`);
    parts.push(`message="${log.error.message}"`);
  }

  return parts.join(" ");
}

/**
 * Creates a structured log message for JSON logging.
 * Returns an object suitable for structured logging systems.
 *
 * @param log - The retry outcome log
 * @returns Object for JSON logging
 */
export function createStructuredRetryLog(
  log: RetryOutcomeLog
): Record<string, unknown> {
  return {
    event: "retry_outcome",
    ...log,
    // Flatten error for easier querying
    errorCode: log.error?.code,
    errorCategory: log.error?.category,
    errorMessage: log.error?.message,
    errorRetryable: log.error?.retryable,
  };
}

/**
 * Checks if a stage has reached its maximum retry limit.
 *
 * @param stage - The ingestion stage
 * @param currentAttempt - Current attempt number (1-indexed)
 * @returns true if max retries have been reached
 */
export function isMaxRetriesReached(
  stage: IngestionStage,
  currentAttempt: number
): boolean {
  const maxRetries = STAGE_MAX_RETRIES[stage];
  return currentAttempt >= maxRetries;
}

/**
 * Gets remaining retry attempts for a stage.
 *
 * @param stage - The ingestion stage
 * @param currentAttempt - Current attempt number (1-indexed)
 * @returns Number of remaining retry attempts (0 or positive)
 */
export function getRemainingRetries(
  stage: IngestionStage,
  currentAttempt: number
): number {
  const maxRetries = STAGE_MAX_RETRIES[stage];
  return Math.max(0, maxRetries - currentAttempt);
}

/**
 * Enhanced retry execution with outcome logging.
 * Wraps executeWithBackoff with automatic outcome tracking and logging.
 *
 * @param fn - The async function to execute
 * @param stage - The ingestion stage
 * @param context - Context for logging (resourceId, tenantId, runId)
 * @param options - Optional overrides for retry options
 * @param logConfig - Optional configuration for outcome logging
 * @param logger - Optional logger function for outcome logs
 * @returns RetryResult with the outcome
 */
export async function executeWithRetryLogging<T>(
  fn: () => Promise<T>,
  stage: IngestionStage,
  context?: {
    resourceId?: string;
    tenantId?: string;
    runId?: string;
  },
  options?: Partial<RetryOptions>,
  logConfig?: Partial<RetryOutcomeLogConfig>,
  logger?: (log: RetryOutcomeLog) => void
): Promise<RetryResult<T>> {
  const executionStartTime = Date.now();
  const retryOptions = getRetryOptionsForStage(stage, options);

  // Execute with backoff
  const result = await executeWithBackoff(fn, retryOptions);

  // Build error info if failed
  let errorInfo:
    | { code: string; category: string; message: string; retryable: boolean }
    | undefined;
  if (!result.success && result.error) {
    const errCode = getErrorCodeFromError(result.error);
    const errMessage =
      result.error instanceof Error
        ? result.error.message
        : String(result.error);
    const errRetryable = retryOptions.isRetryable
      ? retryOptions.isRetryable(result.error)
      : true;

    errorInfo = {
      code: errCode,
      category: getErrorCategoryFromCode(errCode),
      message: errMessage,
      retryable: errRetryable,
    };
  }

  // Create outcome log
  const outcomeLog = createRetryOutcomeLog(
    stage,
    result,
    retryOptions.maxAttempts,
    { ...context, executionStartTime },
    errorInfo,
    logConfig
  );

  // Log if configured to do so
  if (logger && shouldLogRetryOutcome(outcomeLog, logConfig)) {
    logger(outcomeLog);
  }

  return result;
}

/**
 * Gets the error category from an error code string.
 * Helper for creating structured error info.
 *
 * @param code - Error code string
 * @returns Error category string
 */
export function getErrorCategoryFromCode(code: string): string {
  if (code.startsWith("NETWORK_")) return "network";
  if (code.startsWith("SERVICE_")) return "service";
  if (code.startsWith("CONTENT_")) return "content";
  if (code.startsWith("CONFIG_")) return "configuration";
  if (code.startsWith("NOT_FOUND_")) return "not_found";
  if (code.startsWith("VALIDATION_")) return "validation";
  if (code.startsWith("AUTH_")) return "auth";
  if (code.startsWith("SYSTEM_")) return "system";
  return "unknown";
}

/**
 * Creates an outcome summary for a batch of retry outcomes.
 * Useful for aggregating stats at the end of a run.
 *
 * @param logs - Array of retry outcome logs
 * @returns Summary statistics
 */
export function summarizeRetryOutcomes(logs: RetryOutcomeLog[]): {
  total: number;
  byOutcome: Record<RetryOutcome, number>;
  byStage: Record<string, { total: number; succeeded: number; failed: number }>;
  avgAttempts: number;
  avgWaitTimeMs: number;
  successRate: number;
  totalRetries: number;
} {
  const summary = {
    total: logs.length,
    byOutcome: {
      [RetryOutcome.SUCCESS_NO_RETRY]: 0,
      [RetryOutcome.SUCCESS_AFTER_RETRY]: 0,
      [RetryOutcome.FAILURE_NON_RETRYABLE]: 0,
      [RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED]: 0,
      [RetryOutcome.SKIPPED]: 0,
    } as Record<RetryOutcome, number>,
    byStage: {} as Record<
      string,
      { total: number; succeeded: number; failed: number }
    >,
    avgAttempts: 0,
    avgWaitTimeMs: 0,
    successRate: 0,
    totalRetries: 0,
  };

  if (logs.length === 0) {
    return summary;
  }

  let totalAttempts = 0;
  let totalWaitTime = 0;
  let successCount = 0;

  for (const log of logs) {
    // Count by outcome
    summary.byOutcome[log.outcome]++;

    // Count by stage
    if (!summary.byStage[log.stage]) {
      summary.byStage[log.stage] = { total: 0, succeeded: 0, failed: 0 };
    }
    summary.byStage[log.stage].total++;

    // Track success/failure
    if (
      log.outcome === RetryOutcome.SUCCESS_NO_RETRY ||
      log.outcome === RetryOutcome.SUCCESS_AFTER_RETRY
    ) {
      summary.byStage[log.stage].succeeded++;
      successCount++;
    } else if (
      log.outcome === RetryOutcome.FAILURE_NON_RETRYABLE ||
      log.outcome === RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED
    ) {
      summary.byStage[log.stage].failed++;
    }

    totalAttempts += log.totalAttempts;
    totalWaitTime += log.totalWaitTimeMs;
    summary.totalRetries += Math.max(0, log.totalAttempts - 1);
  }

  summary.avgAttempts = totalAttempts / logs.length;
  summary.avgWaitTimeMs = totalWaitTime / logs.length;
  summary.successRate = successCount / logs.length;

  return summary;
}

// Re-export STAGE_MAX_RETRIES for convenience
export { STAGE_MAX_RETRIES };

// ============================================================================
// Deterministic Embed Job IDs
// ============================================================================

/**
 * Configuration for deterministic embed job ID generation.
 */
export interface DeterministicEmbedJobIdConfig {
  /** Prefix for the job ID (default: "embed") */
  prefix?: string;
  /** Maximum length of the hash portion (default: 16, max: 64) */
  hashLength?: number;
  /** Whether to include KB ID in the job ID (default: true) */
  includeKbId?: boolean;
}

/**
 * Result of generating a deterministic embed job ID.
 */
export interface DeterministicEmbedJobIdResult {
  /** The generated job ID */
  jobId: string;
  /** The chunk IDs used to generate the ID (sorted) */
  sortedChunkIds: string[];
  /** The hash portion of the job ID */
  hash: string;
  /** Number of chunks included in the batch */
  chunkCount: number;
}

/**
 * Default configuration for deterministic embed job IDs.
 */
export const DEFAULT_EMBED_JOB_ID_CONFIG: Required<DeterministicEmbedJobIdConfig> = {
  prefix: "embed",
  hashLength: 16,
  includeKbId: true,
};

/**
 * Generates a deterministic hash from sorted chunk IDs.
 * Uses a simple but fast synchronous hashing algorithm (djb2 variant).
 *
 * The hash is deterministic: the same set of chunk IDs will always produce
 * the same hash, regardless of the order they're provided.
 *
 * @param chunkIds - Array of chunk UUIDs
 * @returns Hexadecimal hash string
 */
export function hashChunkIds(chunkIds: string[]): string {
  // Sort chunk IDs to ensure deterministic ordering
  const sorted = [...chunkIds].sort();

  // Concatenate sorted IDs into a single string
  const input = sorted.join("|");

  // djb2 hash variant - fast and deterministic
  // Using BigInt to avoid JavaScript number overflow issues
  let hash = BigInt(5381);

  for (let i = 0; i < input.length; i++) {
    const char = BigInt(input.charCodeAt(i));
    // hash * 33 + char (using bitshift for *33: hash << 5 + hash = hash * 32 + hash = hash * 33)
    hash = ((hash << BigInt(5)) + hash) ^ char;
  }

  // Convert to hex string (positive value only)
  // Use the lower 64 bits for a consistent length
  const hashValue = hash & BigInt("0xFFFFFFFFFFFFFFFF");
  return hashValue.toString(16).padStart(16, "0");
}

/**
 * Generates a deterministic embed job ID based on chunk IDs.
 *
 * The job ID is constructed as: {prefix}-{kbId}-{hash}
 * Where hash is derived from the sorted chunk IDs.
 *
 * This ensures:
 * - Same chunk IDs always produce the same job ID (idempotent)
 * - Different chunk sets produce different job IDs (collision-resistant)
 * - Job IDs are URL-safe and BullMQ-compatible
 *
 * @param kbId - Knowledge base ID
 * @param chunkIds - Array of chunk UUIDs to embed
 * @param config - Optional configuration
 * @returns DeterministicEmbedJobIdResult with the job ID and metadata
 * @throws Error if chunkIds is empty
 */
export function generateDeterministicEmbedJobId(
  kbId: string,
  chunkIds: string[],
  config?: DeterministicEmbedJobIdConfig
): DeterministicEmbedJobIdResult {
  if (!chunkIds || chunkIds.length === 0) {
    throw new Error("Cannot generate embed job ID: chunkIds array is empty");
  }

  const fullConfig = { ...DEFAULT_EMBED_JOB_ID_CONFIG, ...config };

  // Sort chunk IDs for deterministic ordering
  const sortedChunkIds = [...chunkIds].sort();

  // Generate hash from sorted chunk IDs
  const fullHash = hashChunkIds(sortedChunkIds);

  // Truncate hash to configured length
  const hash = fullHash.slice(0, Math.min(fullConfig.hashLength, 64));

  // Build job ID
  let jobId: string;
  if (fullConfig.includeKbId) {
    jobId = `${fullConfig.prefix}-${kbId}-${hash}`;
  } else {
    jobId = `${fullConfig.prefix}-${hash}`;
  }

  return {
    jobId,
    sortedChunkIds,
    hash,
    chunkCount: sortedChunkIds.length,
  };
}

/**
 * Validates that a job ID matches the expected format for deterministic embed jobs.
 *
 * @param jobId - The job ID to validate
 * @param config - Optional configuration for validation
 * @returns true if the job ID matches the expected format
 */
export function isValidDeterministicEmbedJobId(
  jobId: string,
  config?: DeterministicEmbedJobIdConfig
): boolean {
  const fullConfig = { ...DEFAULT_EMBED_JOB_ID_CONFIG, ...config };

  // Pattern: prefix-kbId(uuid)-hash or prefix-hash
  if (fullConfig.includeKbId) {
    // Match: embed-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-[hex]
    const pattern = new RegExp(
      `^${fullConfig.prefix}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]+$`,
      "i"
    );
    return pattern.test(jobId);
  } else {
    // Match: embed-[hex]
    const pattern = new RegExp(`^${fullConfig.prefix}-[0-9a-f]+$`, "i");
    return pattern.test(jobId);
  }
}

/**
 * Extracts the KB ID and hash from a deterministic embed job ID.
 *
 * @param jobId - The job ID to parse
 * @param config - Optional configuration
 * @returns Object with kbId and hash, or null if parsing fails
 */
export function parseDeterministicEmbedJobId(
  jobId: string,
  config?: DeterministicEmbedJobIdConfig
): { kbId: string | null; hash: string } | null {
  const fullConfig = { ...DEFAULT_EMBED_JOB_ID_CONFIG, ...config };

  if (!jobId.startsWith(`${fullConfig.prefix}-`)) {
    return null;
  }

  const remainder = jobId.slice(fullConfig.prefix.length + 1);

  if (fullConfig.includeKbId) {
    // Extract UUID (36 chars) followed by dash and hash
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars)
    const uuidPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]+)$/i;
    const match = remainder.match(uuidPattern);

    if (!match) {
      return null;
    }

    return {
      kbId: match[1],
      hash: match[2],
    };
  } else {
    // Just the hash
    if (!/^[0-9a-f]+$/i.test(remainder)) {
      return null;
    }
    return {
      kbId: null,
      hash: remainder,
    };
  }
}

/**
 * Checks if two sets of chunk IDs would produce the same job ID.
 * Useful for detecting duplicate job submissions.
 *
 * @param chunkIds1 - First set of chunk IDs
 * @param chunkIds2 - Second set of chunk IDs
 * @returns true if both sets would produce the same job ID
 */
export function wouldProduceSameEmbedJobId(
  chunkIds1: string[],
  chunkIds2: string[]
): boolean {
  if (chunkIds1.length !== chunkIds2.length) {
    return false;
  }

  const sorted1 = [...chunkIds1].sort();
  const sorted2 = [...chunkIds2].sort();

  return sorted1.every((id, index) => id === sorted2[index]);
}

// ============================================================================
// Chunk Embed Status Tracking
// ============================================================================

import {
  CHUNK_EMBED_STATUS_KEY_PREFIX,
  CHUNK_EMBED_STATUS_KEY_TTL_SECONDS,
  CHUNK_EMBED_FAILED_SET_KEY_PREFIX,
  EMBED_COMPLETION_GATING_DISABLED_ENV_VAR,
  DEFAULT_EMBED_COMPLETION_WAIT_MS,
  EMBED_COMPLETION_CHECK_INTERVAL_MS,
  EMBED_COMPLETION_ENV_VARS,
} from "../constants";

/**
 * Status of embedding for a single chunk.
 */
export const ChunkEmbedStatus = {
  /** Chunk is queued for embedding */
  PENDING: "pending",
  /** Chunk is currently being embedded */
  IN_PROGRESS: "in_progress",
  /** Chunk was successfully embedded and indexed */
  SUCCEEDED: "succeeded",
  /** Chunk embedding failed with a retryable error */
  FAILED_RETRYABLE: "failed_retryable",
  /** Chunk embedding failed with a permanent error */
  FAILED_PERMANENT: "failed_permanent",
} as const;
export type ChunkEmbedStatus =
  (typeof ChunkEmbedStatus)[keyof typeof ChunkEmbedStatus];

/**
 * Per-chunk embed status record stored in Redis.
 */
export interface ChunkEmbedStatusRecord {
  /** Unique chunk ID */
  chunkId: string;
  /** Current embed status */
  status: ChunkEmbedStatus;
  /** Source run ID this chunk belongs to */
  runId: string;
  /** Knowledge base ID */
  kbId: string;
  /** When this status was last updated */
  updatedAt: string;
  /** Error message if status is failed */
  error?: string;
  /** Error code if available */
  errorCode?: string;
  /** Whether the error is retryable */
  errorRetryable?: boolean;
  /** Number of embedding attempts made */
  attemptCount?: number;
  /** Embedding dimensions if succeeded */
  dimensions?: number;
}

/**
 * Summary of chunk embed statuses for a run.
 */
export interface ChunkEmbedStatusSummary {
  /** Total chunks that need embedding for this run */
  total: number;
  /** Chunks pending embedding */
  pending: number;
  /** Chunks currently being embedded */
  inProgress: number;
  /** Chunks successfully embedded */
  succeeded: number;
  /** Chunks that failed with retryable errors */
  failedRetryable: number;
  /** Chunks that failed with permanent errors */
  failedPermanent: number;
  /** Whether all chunks have been processed (succeeded or failed permanently) */
  isComplete: boolean;
  /** Whether all chunks succeeded */
  allSucceeded: boolean;
  /** Whether there are any failures */
  hasFailures: boolean;
  /** List of failed chunk IDs (for debugging) */
  failedChunkIds?: string[];
}

/**
 * Configuration for embedding completion gating.
 */
export interface EmbedCompletionGatingConfig {
  /** Whether to gate run completion on embedding completion */
  enabled: boolean;
  /** Maximum time to wait for embeddings (ms) */
  maxWaitMs: number;
  /** Interval between completion checks (ms) */
  checkIntervalMs: number;
}

/**
 * Result of checking embedding completion for a run.
 */
export interface EmbedCompletionCheckResult {
  /** Whether all embeddings are complete (succeeded or permanently failed) */
  isComplete: boolean;
  /** Whether all embeddings succeeded */
  allSucceeded: boolean;
  /** Number of chunks pending or in progress */
  pendingCount: number;
  /** Number of chunks that failed */
  failedCount: number;
  /** Number of chunks that succeeded */
  succeededCount: number;
  /** Total chunks for this run */
  totalCount: number;
  /** Suggested run status based on embedding completion */
  suggestedStatus: "succeeded" | "partial" | "embedding_incomplete";
}

/**
 * Gets the default embedding completion gating configuration.
 *
 * @returns Default EmbedCompletionGatingConfig
 */
export function getDefaultEmbedCompletionGatingConfig(): EmbedCompletionGatingConfig {
  return {
    enabled: true,
    maxWaitMs: DEFAULT_EMBED_COMPLETION_WAIT_MS,
    checkIntervalMs: EMBED_COMPLETION_CHECK_INTERVAL_MS,
  };
}

/**
 * Resolves embedding completion gating configuration from environment.
 *
 * @returns Resolved EmbedCompletionGatingConfig
 */
export function resolveEmbedCompletionGatingConfig(): EmbedCompletionGatingConfig {
  const disabledEnv = process.env[EMBED_COMPLETION_GATING_DISABLED_ENV_VAR];
  const isDisabled = disabledEnv === "true" || disabledEnv === "1";

  const waitMsEnv = process.env[EMBED_COMPLETION_ENV_VARS.WAIT_MS];
  const maxWaitMs = waitMsEnv
    ? parseInt(waitMsEnv, 10) || DEFAULT_EMBED_COMPLETION_WAIT_MS
    : DEFAULT_EMBED_COMPLETION_WAIT_MS;

  const checkIntervalEnv = process.env[EMBED_COMPLETION_ENV_VARS.CHECK_INTERVAL_MS];
  const checkIntervalMs = checkIntervalEnv
    ? parseInt(checkIntervalEnv, 10) || EMBED_COMPLETION_CHECK_INTERVAL_MS
    : EMBED_COMPLETION_CHECK_INTERVAL_MS;

  return {
    enabled: !isDisabled,
    maxWaitMs,
    checkIntervalMs,
  };
}

/**
 * Builds a Redis key for a chunk's embed status.
 *
 * @param runId - Source run ID
 * @param chunkId - Chunk ID
 * @returns Redis key string
 */
export function buildChunkEmbedStatusKey(runId: string, chunkId: string): string {
  return `${CHUNK_EMBED_STATUS_KEY_PREFIX}${runId}:${chunkId}`;
}

/**
 * Builds a Redis key for the set of failed chunk IDs for a run.
 *
 * @param runId - Source run ID
 * @returns Redis key string
 */
export function buildChunkEmbedFailedSetKey(runId: string): string {
  return `${CHUNK_EMBED_FAILED_SET_KEY_PREFIX}${runId}`;
}

/**
 * Creates a pending chunk embed status record.
 *
 * @param chunkId - Chunk ID
 * @param runId - Source run ID
 * @param kbId - Knowledge base ID
 * @returns ChunkEmbedStatusRecord
 */
export function createPendingChunkEmbedStatus(
  chunkId: string,
  runId: string,
  kbId: string
): ChunkEmbedStatusRecord {
  return {
    chunkId,
    status: ChunkEmbedStatus.PENDING,
    runId,
    kbId,
    updatedAt: new Date().toISOString(),
    attemptCount: 0,
  };
}

/**
 * Creates an in-progress chunk embed status record.
 *
 * @param previous - Previous status record
 * @returns Updated ChunkEmbedStatusRecord
 */
export function createInProgressChunkEmbedStatus(
  previous: ChunkEmbedStatusRecord
): ChunkEmbedStatusRecord {
  return {
    ...previous,
    status: ChunkEmbedStatus.IN_PROGRESS,
    updatedAt: new Date().toISOString(),
    attemptCount: (previous.attemptCount || 0) + 1,
  };
}

/**
 * Creates a succeeded chunk embed status record.
 *
 * @param previous - Previous status record
 * @param dimensions - Embedding dimensions
 * @returns Updated ChunkEmbedStatusRecord
 */
export function createSucceededChunkEmbedStatus(
  previous: ChunkEmbedStatusRecord,
  dimensions: number
): ChunkEmbedStatusRecord {
  return {
    ...previous,
    status: ChunkEmbedStatus.SUCCEEDED,
    updatedAt: new Date().toISOString(),
    dimensions,
    error: undefined,
    errorCode: undefined,
    errorRetryable: undefined,
  };
}

/**
 * Creates a failed chunk embed status record.
 *
 * @param previous - Previous status record
 * @param error - Error message
 * @param errorCode - Error code
 * @param retryable - Whether the error is retryable
 * @returns Updated ChunkEmbedStatusRecord
 */
export function createFailedChunkEmbedStatus(
  previous: ChunkEmbedStatusRecord,
  error: string,
  errorCode?: string,
  retryable?: boolean
): ChunkEmbedStatusRecord {
  return {
    ...previous,
    status: retryable
      ? ChunkEmbedStatus.FAILED_RETRYABLE
      : ChunkEmbedStatus.FAILED_PERMANENT,
    updatedAt: new Date().toISOString(),
    error,
    errorCode,
    errorRetryable: retryable,
  };
}

/**
 * Calculates a summary of chunk embed statuses.
 *
 * @param records - Array of chunk embed status records
 * @returns ChunkEmbedStatusSummary
 */
export function calculateChunkEmbedStatusSummary(
  records: ChunkEmbedStatusRecord[]
): ChunkEmbedStatusSummary {
  const summary: ChunkEmbedStatusSummary = {
    total: records.length,
    pending: 0,
    inProgress: 0,
    succeeded: 0,
    failedRetryable: 0,
    failedPermanent: 0,
    isComplete: false,
    allSucceeded: false,
    hasFailures: false,
    failedChunkIds: [],
  };

  for (const record of records) {
    switch (record.status) {
      case ChunkEmbedStatus.PENDING:
        summary.pending++;
        break;
      case ChunkEmbedStatus.IN_PROGRESS:
        summary.inProgress++;
        break;
      case ChunkEmbedStatus.SUCCEEDED:
        summary.succeeded++;
        break;
      case ChunkEmbedStatus.FAILED_RETRYABLE:
        summary.failedRetryable++;
        summary.failedChunkIds!.push(record.chunkId);
        break;
      case ChunkEmbedStatus.FAILED_PERMANENT:
        summary.failedPermanent++;
        summary.failedChunkIds!.push(record.chunkId);
        break;
    }
  }

  // Processing is complete when no chunks are pending or in progress
  summary.isComplete =
    summary.pending === 0 && summary.inProgress === 0 && summary.total > 0;

  // All succeeded when complete and no failures
  summary.allSucceeded =
    summary.isComplete &&
    summary.failedRetryable === 0 &&
    summary.failedPermanent === 0;

  // Has failures if any failed (retryable or permanent)
  summary.hasFailures =
    summary.failedRetryable > 0 || summary.failedPermanent > 0;

  return summary;
}

/**
 * Checks if a chunk embed status indicates processing is still in progress.
 *
 * @param status - Chunk embed status
 * @returns true if the chunk is still being processed
 */
export function isChunkEmbedInProgress(status: ChunkEmbedStatus): boolean {
  return (
    status === ChunkEmbedStatus.PENDING ||
    status === ChunkEmbedStatus.IN_PROGRESS
  );
}

/**
 * Checks if a chunk embed status indicates a terminal state (completed or permanently failed).
 *
 * @param status - Chunk embed status
 * @returns true if the chunk is in a terminal state
 */
export function isChunkEmbedTerminal(status: ChunkEmbedStatus): boolean {
  return (
    status === ChunkEmbedStatus.SUCCEEDED ||
    status === ChunkEmbedStatus.FAILED_PERMANENT
  );
}

/**
 * Checks if a chunk embed status indicates failure.
 *
 * @param status - Chunk embed status
 * @returns true if the chunk failed
 */
export function isChunkEmbedFailed(status: ChunkEmbedStatus): boolean {
  return (
    status === ChunkEmbedStatus.FAILED_RETRYABLE ||
    status === ChunkEmbedStatus.FAILED_PERMANENT
  );
}

/**
 * Determines the suggested run status based on embedding completion.
 *
 * @param summary - Chunk embed status summary
 * @param hasPageFailures - Whether there were page-level failures
 * @returns Suggested run status
 */
export function determineRunStatusFromEmbedding(
  summary: ChunkEmbedStatusSummary,
  hasPageFailures: boolean
): "succeeded" | "partial" | "embedding_incomplete" {
  // If embedding is not complete, return embedding_incomplete
  if (!summary.isComplete) {
    return "embedding_incomplete";
  }

  // If there are embedding failures or page failures, return partial
  if (summary.hasFailures || hasPageFailures) {
    return "partial";
  }

  // All embeddings succeeded and no page failures
  return "succeeded";
}

/**
 * Gets the TTL for chunk embed status keys.
 *
 * @returns TTL in seconds
 */
export function getChunkEmbedStatusKeyTtl(): number {
  return CHUNK_EMBED_STATUS_KEY_TTL_SECONDS;
}

// Re-export chunk embed status constants for convenience
export {
  CHUNK_EMBED_STATUS_KEY_PREFIX,
  CHUNK_EMBED_STATUS_KEY_TTL_SECONDS,
  CHUNK_EMBED_FAILED_SET_KEY_PREFIX,
  EMBED_COMPLETION_GATING_DISABLED_ENV_VAR,
  DEFAULT_EMBED_COMPLETION_WAIT_MS,
  EMBED_COMPLETION_CHECK_INTERVAL_MS,
  EMBED_COMPLETION_ENV_VARS,
};

// ============================================================================
// Robots.txt Enforcement
// ============================================================================

import {
  ROBOTS_USER_AGENT,
  ROBOTS_WILDCARD_USER_AGENT,
  ROBOTS_TXT_CACHE_TTL_SECONDS,
  ROBOTS_TXT_CACHE_KEY_PREFIX,
  ROBOTS_TXT_FETCH_TIMEOUT_MS,
  ROBOTS_TXT_DISABLED_ENV_VAR,
  ROBOTS_TXT_DEBUG_ENV_VAR,
} from "../constants/index.js";

/**
 * Represents a single rule in a robots.txt file.
 */
export interface RobotsTxtRule {
  /** The rule type: allow or disallow */
  type: "allow" | "disallow";
  /** The path pattern from the rule */
  pattern: string;
  /** The original line from the robots.txt file */
  originalLine: string;
}

/**
 * Represents a user-agent section in robots.txt.
 */
export interface RobotsTxtUserAgentGroup {
  /** User agent(s) this group applies to */
  userAgents: string[];
  /** Rules in this group, in order of appearance */
  rules: RobotsTxtRule[];
  /** Crawl-delay if specified (in seconds) */
  crawlDelay?: number;
}

/**
 * Parsed robots.txt structure.
 */
export interface ParsedRobotsTxt {
  /** All user-agent groups in the file */
  groups: RobotsTxtUserAgentGroup[];
  /** Sitemap URLs if specified */
  sitemaps: string[];
  /** Whether the file was successfully fetched and parsed */
  isValid: boolean;
  /** Error message if parsing failed */
  error?: string;
  /** HTTP status code from fetching robots.txt */
  httpStatus?: number;
  /** Timestamp when the robots.txt was fetched */
  fetchedAt: string;
  /** The raw content of the robots.txt file */
  rawContent?: string;
}

/**
 * Result of checking a URL against robots.txt.
 */
export interface RobotsTxtCheckResult {
  /** Whether the URL is allowed */
  isAllowed: boolean;
  /** Whether robots.txt enforcement was applied */
  wasEnforced: boolean;
  /** The matching rule if blocked */
  matchedRule?: string;
  /** The user agent used for matching */
  userAgent: string;
  /** Reason for the result */
  reason: string;
}

/**
 * Configuration for robots.txt enforcement.
 */
export interface RobotsTxtEnforcementConfig {
  /** Whether to enforce robots.txt (can be overridden per-source) */
  enabled: boolean;
  /** User agent to use for matching rules */
  userAgent: string;
  /** Fallback user agent if primary not found */
  fallbackUserAgent: string;
  /** Whether to enable debug logging */
  debugEnabled: boolean;
}

/**
 * Statistics for robots.txt processing in a run.
 */
export interface RobotsTxtStats {
  /** Number of URLs checked */
  urlsChecked: number;
  /** Number of URLs blocked by robots.txt */
  urlsBlocked: number;
  /** Number of unique domains checked */
  domainsChecked: number;
  /** Domains that blocked URLs */
  blockedByDomain: Record<string, number>;
}

/**
 * Checks if robots.txt enforcement is globally disabled via environment variable.
 *
 * @returns true if robots.txt enforcement is globally disabled
 */
export function isRobotsTxtGloballyDisabled(): boolean {
  const disabled = process.env[ROBOTS_TXT_DISABLED_ENV_VAR];
  return disabled === "true" || disabled === "1";
}

/**
 * Checks if robots.txt debug logging is enabled.
 *
 * @returns true if debug logging is enabled
 */
export function isRobotsTxtDebugEnabled(): boolean {
  const debug = process.env[ROBOTS_TXT_DEBUG_ENV_VAR];
  return debug === "true" || debug === "1";
}

/**
 * Gets the default robots.txt enforcement configuration.
 *
 * @returns RobotsTxtEnforcementConfig with default values
 */
export function getDefaultRobotsTxtConfig(): RobotsTxtEnforcementConfig {
  return {
    enabled: !isRobotsTxtGloballyDisabled(),
    userAgent: ROBOTS_USER_AGENT,
    fallbackUserAgent: ROBOTS_WILDCARD_USER_AGENT,
    debugEnabled: isRobotsTxtDebugEnabled(),
  };
}

/**
 * Builds a Redis cache key for robots.txt content.
 *
 * @param domain - The domain (hostname) for the robots.txt
 * @returns The Redis cache key
 */
export function buildRobotsTxtCacheKey(domain: string): string {
  return `${ROBOTS_TXT_CACHE_KEY_PREFIX}${domain.toLowerCase()}`;
}

/**
 * Gets the robots.txt cache TTL.
 *
 * @returns TTL in seconds
 */
export function getRobotsTxtCacheTtl(): number {
  return ROBOTS_TXT_CACHE_TTL_SECONDS;
}

/**
 * Gets the robots.txt fetch timeout.
 *
 * @returns Timeout in milliseconds
 */
export function getRobotsTxtFetchTimeout(): number {
  return ROBOTS_TXT_FETCH_TIMEOUT_MS;
}

/**
 * Builds the robots.txt URL for a given URL.
 *
 * @param url - Any URL from the target site
 * @returns The robots.txt URL for that site
 */
export function buildRobotsTxtUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/robots.txt`;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * Extracts the domain (hostname) from a URL.
 *
 * @param url - The URL to extract domain from
 * @returns The domain (hostname)
 */
export function extractDomainForRobots(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * Parses robots.txt content into a structured format.
 *
 * @param content - The raw robots.txt content
 * @param httpStatus - Optional HTTP status code from fetching
 * @returns Parsed robots.txt structure
 */
export function parseRobotsTxt(
  content: string,
  httpStatus?: number
): ParsedRobotsTxt {
  const result: ParsedRobotsTxt = {
    groups: [],
    sitemaps: [],
    isValid: true,
    httpStatus,
    fetchedAt: new Date().toISOString(),
    rawContent: content,
  };

  // Handle empty content
  if (!content || content.trim() === "") {
    result.isValid = true; // Empty robots.txt means everything is allowed
    return result;
  }

  const lines = content.split(/\r?\n/);
  let currentGroup: RobotsTxtUserAgentGroup | null = null;

  for (const line of lines) {
    // Remove comments and trim whitespace
    const commentIndex = line.indexOf("#");
    const cleanLine =
      commentIndex >= 0 ? line.substring(0, commentIndex).trim() : line.trim();

    if (!cleanLine) continue;

    // Parse directive
    const colonIndex = cleanLine.indexOf(":");
    if (colonIndex === -1) continue;

    const directive = cleanLine.substring(0, colonIndex).trim().toLowerCase();
    const value = cleanLine.substring(colonIndex + 1).trim();

    switch (directive) {
      case "user-agent":
        // Start a new group or add to current group
        if (currentGroup && currentGroup.rules.length === 0) {
          // No rules yet, add to existing group
          currentGroup.userAgents.push(value);
        } else {
          // Start a new group
          currentGroup = {
            userAgents: [value],
            rules: [],
          };
          result.groups.push(currentGroup);
        }
        break;

      case "disallow":
        if (currentGroup) {
          currentGroup.rules.push({
            type: "disallow",
            pattern: value,
            originalLine: cleanLine,
          });
        }
        break;

      case "allow":
        if (currentGroup) {
          currentGroup.rules.push({
            type: "allow",
            pattern: value,
            originalLine: cleanLine,
          });
        }
        break;

      case "crawl-delay":
        if (currentGroup) {
          const delay = parseFloat(value);
          if (!isNaN(delay) && delay >= 0) {
            currentGroup.crawlDelay = delay;
          }
        }
        break;

      case "sitemap":
        if (value && (value.startsWith("http://") || value.startsWith("https://"))) {
          result.sitemaps.push(value);
        }
        break;
    }
  }

  return result;
}

/**
 * Creates a ParsedRobotsTxt for a fetch error.
 *
 * @param error - The error message
 * @param httpStatus - Optional HTTP status code
 * @returns ParsedRobotsTxt indicating an error
 */
export function createRobotsTxtError(
  error: string,
  httpStatus?: number
): ParsedRobotsTxt {
  return {
    groups: [],
    sitemaps: [],
    isValid: false,
    error,
    httpStatus,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Creates a ParsedRobotsTxt for when robots.txt doesn't exist (404).
 * A missing robots.txt means everything is allowed.
 *
 * @returns ParsedRobotsTxt allowing all URLs
 */
export function createRobotsTxtNotFound(): ParsedRobotsTxt {
  return {
    groups: [],
    sitemaps: [],
    isValid: true,
    httpStatus: 404,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Matches a URL path against a robots.txt pattern.
 *
 * Robots.txt patterns support:
 * - Exact prefix matching
 * - * matches any sequence of characters
 * - $ matches end of URL
 *
 * Note: An empty pattern in robots.txt has special meaning:
 * - "Disallow:" (empty) means allow all URLs
 * - So an empty pattern should NOT match anything, effectively making the rule a no-op
 *
 * @param path - The URL path to check
 * @param pattern - The robots.txt pattern
 * @returns true if the path matches the pattern
 */
export function matchRobotsTxtPattern(path: string, pattern: string): boolean {
  // Empty pattern does NOT match anything (per robots.txt spec)
  // An empty Disallow means "allow all", so we should not match
  if (!pattern || pattern === "") return false;

  // Empty path should be treated as "/"
  const normalizedPath = path || "/";

  // Build regex from pattern
  let regexPattern = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      regexPattern += ".*";
    } else if (char === "$" && i === pattern.length - 1) {
      regexPattern += "$";
    } else {
      // Escape special regex characters
      regexPattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  // If pattern doesn't end with $, it's a prefix match
  if (!pattern.endsWith("$")) {
    regexPattern = "^" + regexPattern;
  } else {
    regexPattern = "^" + regexPattern;
  }

  try {
    const regex = new RegExp(regexPattern);
    return regex.test(normalizedPath);
  } catch {
    // Invalid regex, fall back to prefix match
    return normalizedPath.startsWith(pattern.replace(/\*|\$/g, ""));
  }
}

/**
 * Finds the applicable rule group for a user agent.
 *
 * @param robotsTxt - Parsed robots.txt
 * @param userAgent - The user agent to match
 * @param fallbackUserAgent - Fallback user agent (usually "*")
 * @returns The matching group or undefined
 */
export function findRobotsTxtGroup(
  robotsTxt: ParsedRobotsTxt,
  userAgent: string,
  fallbackUserAgent: string = ROBOTS_WILDCARD_USER_AGENT
): RobotsTxtUserAgentGroup | undefined {
  const userAgentLower = userAgent.toLowerCase();
  const fallbackLower = fallbackUserAgent.toLowerCase();

  // First, try to find a specific match for the user agent
  for (const group of robotsTxt.groups) {
    for (const ua of group.userAgents) {
      if (ua.toLowerCase() === userAgentLower) {
        return group;
      }
    }
  }

  // Then, try to find a group that matches via substring
  for (const group of robotsTxt.groups) {
    for (const ua of group.userAgents) {
      const uaLower = ua.toLowerCase();
      if (
        userAgentLower.includes(uaLower) ||
        uaLower.includes(userAgentLower)
      ) {
        return group;
      }
    }
  }

  // Fall back to wildcard user agent
  for (const group of robotsTxt.groups) {
    for (const ua of group.userAgents) {
      if (ua === fallbackLower || ua === "*") {
        return group;
      }
    }
  }

  return undefined;
}

/**
 * Checks if a URL is allowed by robots.txt.
 *
 * @param robotsTxt - Parsed robots.txt
 * @param url - The URL to check
 * @param config - Enforcement configuration
 * @returns Check result with allowed status and details
 */
export function checkUrlAgainstRobotsTxt(
  robotsTxt: ParsedRobotsTxt,
  url: string,
  config: RobotsTxtEnforcementConfig = getDefaultRobotsTxtConfig()
): RobotsTxtCheckResult {
  // If enforcement is disabled, allow everything
  if (!config.enabled) {
    return {
      isAllowed: true,
      wasEnforced: false,
      userAgent: config.userAgent,
      reason: "Robots.txt enforcement disabled",
    };
  }

  // If robots.txt is invalid or errored, allow by default
  if (!robotsTxt.isValid) {
    return {
      isAllowed: true,
      wasEnforced: false,
      userAgent: config.userAgent,
      reason: `Robots.txt invalid: ${robotsTxt.error || "unknown error"}`,
    };
  }

  // If no groups, everything is allowed
  if (robotsTxt.groups.length === 0) {
    return {
      isAllowed: true,
      wasEnforced: true,
      userAgent: config.userAgent,
      reason: "No rules in robots.txt",
    };
  }

  // Find the applicable group
  const group = findRobotsTxtGroup(
    robotsTxt,
    config.userAgent,
    config.fallbackUserAgent
  );

  if (!group) {
    return {
      isAllowed: true,
      wasEnforced: true,
      userAgent: config.userAgent,
      reason: "No matching user-agent group",
    };
  }

  // Extract path from URL
  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.pathname + parsed.search;
  } catch {
    return {
      isAllowed: false,
      wasEnforced: true,
      userAgent: config.userAgent,
      reason: "Invalid URL",
    };
  }

  // Find the most specific matching rule
  // Rules are evaluated in order, with more specific patterns taking precedence
  let matchedRule: RobotsTxtRule | undefined;
  let longestMatchLength = -1;

  for (const rule of group.rules) {
    if (matchRobotsTxtPattern(path, rule.pattern)) {
      // Use the rule with the longest matching pattern
      const patternLength = rule.pattern.replace(/\*/g, "").length;
      if (patternLength > longestMatchLength) {
        longestMatchLength = patternLength;
        matchedRule = rule;
      }
    }
  }

  if (!matchedRule) {
    return {
      isAllowed: true,
      wasEnforced: true,
      userAgent: config.userAgent,
      reason: "No matching rule",
    };
  }

  const isAllowed = matchedRule.type === "allow";
  return {
    isAllowed,
    wasEnforced: true,
    matchedRule: matchedRule.pattern,
    userAgent: config.userAgent,
    reason: isAllowed
      ? `Allowed by rule: ${matchedRule.originalLine}`
      : `Blocked by rule: ${matchedRule.originalLine}`,
  };
}

/**
 * Filters URLs based on robots.txt rules.
 *
 * @param robotsTxt - Parsed robots.txt
 * @param urls - URLs to filter
 * @param config - Enforcement configuration
 * @returns Object with allowed and blocked URLs with reasons
 */
export function filterUrlsByRobotsTxt(
  robotsTxt: ParsedRobotsTxt,
  urls: string[],
  config: RobotsTxtEnforcementConfig = getDefaultRobotsTxtConfig()
): {
  allowed: string[];
  blocked: Array<{ url: string; reason: string; rule?: string }>;
} {
  const allowed: string[] = [];
  const blocked: Array<{ url: string; reason: string; rule?: string }> = [];

  for (const url of urls) {
    const result = checkUrlAgainstRobotsTxt(robotsTxt, url, config);
    if (result.isAllowed) {
      allowed.push(url);
    } else {
      blocked.push({
        url,
        reason: result.reason,
        rule: result.matchedRule,
      });
    }
  }

  return { allowed, blocked };
}

/**
 * Creates an empty RobotsTxtStats object.
 *
 * @returns Empty stats object
 */
export function createEmptyRobotsTxtStats(): RobotsTxtStats {
  return {
    urlsChecked: 0,
    urlsBlocked: 0,
    domainsChecked: 0,
    blockedByDomain: {},
  };
}

/**
 * Updates RobotsTxtStats with check results.
 *
 * @param stats - Current stats
 * @param domain - Domain that was checked
 * @param urlsChecked - Number of URLs checked
 * @param urlsBlocked - Number of URLs blocked
 * @returns Updated stats
 */
export function updateRobotsTxtStats(
  stats: RobotsTxtStats,
  domain: string,
  urlsChecked: number,
  urlsBlocked: number
): RobotsTxtStats {
  const newStats = { ...stats };
  newStats.urlsChecked += urlsChecked;
  newStats.urlsBlocked += urlsBlocked;

  if (urlsBlocked > 0) {
    newStats.blockedByDomain[domain] =
      (newStats.blockedByDomain[domain] || 0) + urlsBlocked;
  }

  // Count unique domains
  const domains = new Set<string>(Object.keys(newStats.blockedByDomain));
  domains.add(domain);
  newStats.domainsChecked = domains.size;

  return newStats;
}

// Re-export robots.txt constants for convenience
export {
  ROBOTS_USER_AGENT,
  ROBOTS_WILDCARD_USER_AGENT,
  ROBOTS_TXT_CACHE_TTL_SECONDS,
  ROBOTS_TXT_CACHE_KEY_PREFIX,
  ROBOTS_TXT_FETCH_TIMEOUT_MS,
  ROBOTS_TXT_DISABLED_ENV_VAR,
  ROBOTS_TXT_DEBUG_ENV_VAR,
};

// ============================================================================
// Robots.txt Override and Blocked URL Logging
// ============================================================================

/**
 * Types of robots.txt override events.
 */
export enum RobotsOverrideType {
  /** Per-source override: respectRobotsTxt is set to false */
  SOURCE_OVERRIDE = "source_override",
  /** Global override: ROBOTS_TXT_DISABLED env var is set */
  GLOBAL_DISABLED = "global_disabled",
}

/**
 * Log entry for robots.txt override usage.
 * Tracks when and why robots.txt enforcement was bypassed.
 */
export interface RobotsOverrideLog {
  /** Type of override */
  overrideType: RobotsOverrideType;
  /** ISO timestamp when override was logged */
  timestamp: string;
  /** Source run ID */
  runId: string;
  /** Source ID */
  sourceId: string;
  /** Tenant ID */
  tenantId: string | null;
  /** Number of URLs that would have been checked */
  urlCount: number;
  /** Number of unique domains in the URL list */
  domainCount: number;
  /** List of unique domains (for debugging) */
  domains?: string[];
  /** Human-readable reason for the override */
  reason: string;
}

/**
 * Log entry for a URL blocked by robots.txt.
 */
export interface RobotsBlockedUrlLog {
  /** ISO timestamp when URL was blocked */
  timestamp: string;
  /** The blocked URL */
  url: string;
  /** Domain of the blocked URL */
  domain: string;
  /** Source run ID */
  runId: string;
  /** Tenant ID */
  tenantId: string | null;
  /** The robots.txt rule that blocked the URL */
  matchedRule?: string;
  /** User agent used for matching */
  userAgent: string;
  /** Human-readable reason for blocking */
  reason: string;
}

/**
 * Summary log entry for URLs blocked by robots.txt in a run.
 * Used for aggregated logging instead of per-URL logs.
 */
export interface RobotsBlockedSummaryLog {
  /** ISO timestamp */
  timestamp: string;
  /** Source run ID */
  runId: string;
  /** Source ID */
  sourceId: string;
  /** Tenant ID */
  tenantId: string | null;
  /** Total URLs checked against robots.txt */
  totalUrlsChecked: number;
  /** Total URLs blocked by robots.txt */
  totalUrlsBlocked: number;
  /** Number of unique domains that had blocked URLs */
  domainsWithBlocks: number;
  /** Blocked URL count per domain */
  blockedByDomain: Record<string, number>;
  /** Sample of blocked URLs (first N) for debugging */
  sampleBlockedUrls?: Array<{
    url: string;
    rule?: string;
    reason: string;
  }>;
  /** Whether robots.txt was respected (false means override was used) */
  robotsTxtRespected: boolean;
}

/**
 * Configuration for robots.txt logging behavior.
 */
export interface RobotsLoggingConfig {
  /** Whether to log individual blocked URLs (can be noisy) */
  logIndividualBlocks: boolean;
  /** Maximum sample size for blocked URLs in summary log */
  maxSampleSize: number;
  /** Whether to log override events */
  logOverrides: boolean;
  /** Whether to include domain list in override logs */
  includeDomainList: boolean;
  /** Maximum domains to include in domain list */
  maxDomainListSize: number;
}

/**
 * Gets the default robots.txt logging configuration.
 *
 * @returns RobotsLoggingConfig with default values
 */
export function getDefaultRobotsLoggingConfig(): RobotsLoggingConfig {
  return {
    logIndividualBlocks: false, // Too noisy by default
    maxSampleSize: 10,
    logOverrides: true,
    includeDomainList: true,
    maxDomainListSize: 20,
  };
}

/**
 * Creates a robots.txt override log entry.
 *
 * @param params - Parameters for the log entry
 * @returns RobotsOverrideLog entry
 */
export function createRobotsOverrideLog(params: {
  overrideType: RobotsOverrideType;
  runId: string;
  sourceId: string;
  tenantId: string | null;
  urls: string[];
  config?: RobotsLoggingConfig;
}): RobotsOverrideLog {
  const config = params.config ?? getDefaultRobotsLoggingConfig();

  // Extract unique domains from URLs
  const domains = new Set<string>();
  for (const url of params.urls) {
    try {
      const domain = extractDomainForRobots(url);
      domains.add(domain);
    } catch {
      // Invalid URL, skip
    }
  }

  const domainList = Array.from(domains);
  const reason =
    params.overrideType === RobotsOverrideType.GLOBAL_DISABLED
      ? "Robots.txt enforcement globally disabled via ROBOTS_TXT_DISABLED environment variable"
      : "Robots.txt enforcement disabled for this source via respectRobotsTxt: false";

  return {
    overrideType: params.overrideType,
    timestamp: new Date().toISOString(),
    runId: params.runId,
    sourceId: params.sourceId,
    tenantId: params.tenantId,
    urlCount: params.urls.length,
    domainCount: domains.size,
    domains: config.includeDomainList
      ? domainList.slice(0, config.maxDomainListSize)
      : undefined,
    reason,
  };
}

/**
 * Creates a log entry for a single blocked URL.
 *
 * @param params - Parameters for the log entry
 * @returns RobotsBlockedUrlLog entry
 */
export function createRobotsBlockedUrlLog(params: {
  url: string;
  runId: string;
  tenantId: string | null;
  matchedRule?: string;
  userAgent?: string;
  reason?: string;
}): RobotsBlockedUrlLog {
  let domain: string;
  try {
    domain = extractDomainForRobots(params.url);
  } catch {
    domain = "unknown";
  }

  return {
    timestamp: new Date().toISOString(),
    url: params.url,
    domain,
    runId: params.runId,
    tenantId: params.tenantId,
    matchedRule: params.matchedRule,
    userAgent: params.userAgent ?? ROBOTS_USER_AGENT,
    reason: params.reason ?? "URL blocked by robots.txt",
  };
}

/**
 * Creates a summary log entry for all URLs blocked by robots.txt in a run.
 *
 * @param params - Parameters for the summary log
 * @returns RobotsBlockedSummaryLog entry
 */
export function createRobotsBlockedSummaryLog(params: {
  runId: string;
  sourceId: string;
  tenantId: string | null;
  totalUrlsChecked: number;
  blockedUrls: Array<{ url: string; reason: string; rule?: string }>;
  robotsTxtRespected: boolean;
  config?: RobotsLoggingConfig;
}): RobotsBlockedSummaryLog {
  const config = params.config ?? getDefaultRobotsLoggingConfig();

  // Calculate blocked by domain
  const blockedByDomain: Record<string, number> = {};
  for (const blocked of params.blockedUrls) {
    try {
      const domain = extractDomainForRobots(blocked.url);
      blockedByDomain[domain] = (blockedByDomain[domain] || 0) + 1;
    } catch {
      blockedByDomain["unknown"] = (blockedByDomain["unknown"] || 0) + 1;
    }
  }

  // Create sample of blocked URLs
  const sampleBlockedUrls = params.blockedUrls
    .slice(0, config.maxSampleSize)
    .map((b) => ({
      url: b.url,
      rule: b.rule,
      reason: b.reason,
    }));

  return {
    timestamp: new Date().toISOString(),
    runId: params.runId,
    sourceId: params.sourceId,
    tenantId: params.tenantId,
    totalUrlsChecked: params.totalUrlsChecked,
    totalUrlsBlocked: params.blockedUrls.length,
    domainsWithBlocks: Object.keys(blockedByDomain).length,
    blockedByDomain,
    sampleBlockedUrls:
      sampleBlockedUrls.length > 0 ? sampleBlockedUrls : undefined,
    robotsTxtRespected: params.robotsTxtRespected,
  };
}

/**
 * Formats a robots.txt override log for human-readable output.
 *
 * @param log - The override log entry
 * @returns Formatted string for logging
 */
export function formatRobotsOverrideLog(log: RobotsOverrideLog): string {
  const parts = [
    `[Robots Override] ${log.overrideType}`,
    `Run: ${log.runId}`,
    `URLs: ${log.urlCount}`,
    `Domains: ${log.domainCount}`,
  ];

  if (log.domains && log.domains.length > 0) {
    parts.push(`Domain list: ${log.domains.join(", ")}`);
  }

  parts.push(`Reason: ${log.reason}`);

  return parts.join(" | ");
}

/**
 * Formats a robots blocked URL log for human-readable output.
 *
 * @param log - The blocked URL log entry
 * @returns Formatted string for logging
 */
export function formatRobotsBlockedUrlLog(log: RobotsBlockedUrlLog): string {
  const parts = [
    `[Robots Blocked] ${log.url}`,
    `Domain: ${log.domain}`,
    `Run: ${log.runId}`,
  ];

  if (log.matchedRule) {
    parts.push(`Rule: ${log.matchedRule}`);
  }

  parts.push(`Reason: ${log.reason}`);

  return parts.join(" | ");
}

/**
 * Formats a robots blocked summary log for human-readable output.
 *
 * @param log - The summary log entry
 * @returns Formatted string for logging
 */
export function formatRobotsBlockedSummaryLog(
  log: RobotsBlockedSummaryLog
): string {
  const parts = [
    `[Robots Summary]`,
    `Run: ${log.runId}`,
    `Checked: ${log.totalUrlsChecked}`,
    `Blocked: ${log.totalUrlsBlocked}`,
    `Domains with blocks: ${log.domainsWithBlocks}`,
  ];

  if (!log.robotsTxtRespected) {
    parts.push(`(Override active - no URLs actually blocked)`);
  }

  // Add domain breakdown if there are blocks
  if (
    log.totalUrlsBlocked > 0 &&
    Object.keys(log.blockedByDomain).length > 0
  ) {
    const domainBreakdown = Object.entries(log.blockedByDomain)
      .map(([domain, count]) => `${domain}: ${count}`)
      .join(", ");
    parts.push(`By domain: ${domainBreakdown}`);
  }

  return parts.join(" | ");
}

/**
 * Creates a structured log object for JSON logging of override events.
 *
 * @param log - The override log entry
 * @returns Object suitable for JSON logging
 */
export function createStructuredRobotsOverrideLog(
  log: RobotsOverrideLog
): Record<string, unknown> {
  return {
    event: "robots_override",
    overrideType: log.overrideType,
    timestamp: log.timestamp,
    runId: log.runId,
    sourceId: log.sourceId,
    tenantId: log.tenantId,
    urlCount: log.urlCount,
    domainCount: log.domainCount,
    domains: log.domains,
    reason: log.reason,
  };
}

/**
 * Creates a structured log object for JSON logging of blocked URL summaries.
 *
 * @param log - The summary log entry
 * @returns Object suitable for JSON logging
 */
export function createStructuredRobotsBlockedSummaryLog(
  log: RobotsBlockedSummaryLog
): Record<string, unknown> {
  return {
    event: "robots_blocked_summary",
    timestamp: log.timestamp,
    runId: log.runId,
    sourceId: log.sourceId,
    tenantId: log.tenantId,
    totalUrlsChecked: log.totalUrlsChecked,
    totalUrlsBlocked: log.totalUrlsBlocked,
    domainsWithBlocks: log.domainsWithBlocks,
    blockedByDomain: log.blockedByDomain,
    sampleBlockedUrls: log.sampleBlockedUrls,
    robotsTxtRespected: log.robotsTxtRespected,
    blockRate:
      log.totalUrlsChecked > 0
        ? (log.totalUrlsBlocked / log.totalUrlsChecked) * 100
        : 0,
  };
}

/**
 * Determines if an override log should be written based on configuration.
 *
 * @param config - Logging configuration
 * @returns true if override logs should be written
 */
export function shouldLogRobotsOverride(
  config: RobotsLoggingConfig = getDefaultRobotsLoggingConfig()
): boolean {
  return config.logOverrides;
}

/**
 * Determines if individual blocked URL logs should be written.
 *
 * @param config - Logging configuration
 * @returns true if individual blocked URL logs should be written
 */
export function shouldLogIndividualBlocks(
  config: RobotsLoggingConfig = getDefaultRobotsLoggingConfig()
): boolean {
  return config.logIndividualBlocks;
}

// ============================================================================
// Stage Metrics Types
// ============================================================================

import {
  DEFAULT_METRICS_EMIT_INTERVAL_MS,
  METRICS_EMIT_INTERVAL_ENV_VAR,
  METRICS_DISABLED_ENV_VAR,
  STAGE_METRICS_KEY_PREFIX,
  STAGE_METRICS_KEY_TTL_SECONDS,
  STAGE_METRICS_ENV_VARS,
} from "../constants";

// Re-export constants for convenience
export {
  DEFAULT_METRICS_EMIT_INTERVAL_MS,
  METRICS_EMIT_INTERVAL_ENV_VAR,
  METRICS_DISABLED_ENV_VAR,
  STAGE_METRICS_KEY_PREFIX,
  STAGE_METRICS_KEY_TTL_SECONDS,
  STAGE_METRICS_ENV_VARS,
};

/**
 * Latency statistics for a stage.
 */
export interface StageLatencyStats {
  /** Minimum latency in milliseconds */
  minMs: number;
  /** Maximum latency in milliseconds */
  maxMs: number;
  /** Sum of all latencies (for calculating average) */
  sumMs: number;
  /** Number of samples */
  count: number;
  /** Computed average latency (sumMs / count) */
  averageMs: number;
}

/**
 * Throughput metrics for a single stage.
 */
export interface StageThroughputMetrics {
  /** The ingestion stage */
  stage: IngestionStage;
  /** Number of items that completed this stage successfully */
  itemsCompleted: number;
  /** Number of items that failed at this stage */
  itemsFailed: number;
  /** Number of items that were skipped at this stage */
  itemsSkipped: number;
  /** Total items processed (completed + failed + skipped) */
  totalItems: number;
  /** Success rate as a percentage (0-100) */
  successRate: number;
  /** Items processed per second (throughput) */
  throughputPerSecond: number;
}

/**
 * Latency metrics for a single stage.
 */
export interface StageLatencyMetrics {
  /** The ingestion stage */
  stage: IngestionStage;
  /** Minimum latency in milliseconds */
  minLatencyMs: number;
  /** Maximum latency in milliseconds */
  maxLatencyMs: number;
  /** Average latency in milliseconds */
  averageLatencyMs: number;
  /** Total duration spent in this stage across all items */
  totalDurationMs: number;
  /** Number of latency samples */
  sampleCount: number;
}

/**
 * Combined throughput and latency metrics for a stage.
 */
export interface StageMetrics {
  /** The ingestion stage */
  stage: IngestionStage;
  /** Throughput metrics */
  throughput: StageThroughputMetrics;
  /** Latency metrics */
  latency: StageLatencyMetrics;
  /** When the first item started processing */
  firstItemStartedAt?: string;
  /** When the last item completed processing */
  lastItemCompletedAt?: string;
  /** Total elapsed time from first to last item */
  wallClockDurationMs?: number;
}

/**
 * Per-item stage timing record.
 * Used to collect timing data before aggregation.
 */
export interface StageItemTiming {
  /** Unique identifier for the item (page ID, chunk ID, etc.) */
  itemId: string;
  /** The ingestion stage */
  stage: IngestionStage;
  /** When the item started processing in this stage (ISO timestamp) */
  startedAt: string;
  /** When the item finished processing (ISO timestamp) */
  finishedAt?: string;
  /** Duration in milliseconds (computed from startedAt and finishedAt) */
  durationMs?: number;
  /** Whether the item succeeded, failed, or was skipped */
  outcome: "completed" | "failed" | "skipped";
  /** Optional error code if failed */
  errorCode?: string;
}

/**
 * Accumulated metrics for a run.
 * Used for in-memory aggregation during processing.
 */
export interface RunStageMetricsAccumulator {
  /** Run ID */
  runId: string;
  /** Source ID */
  sourceId: string;
  /** Tenant ID */
  tenantId: string | null;
  /** When accumulator was created */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Per-stage accumulators */
  stages: Record<IngestionStage, StageMetricsData>;
}

/**
 * Internal data structure for accumulating metrics per stage.
 */
export interface StageMetricsData {
  /** Counts */
  completed: number;
  failed: number;
  skipped: number;
  /** Latency tracking */
  latencyStats: StageLatencyStats;
  /** First and last item timestamps */
  firstItemStartedAt?: string;
  lastItemCompletedAt?: string;
}

/**
 * Stage metrics snapshot for logging/export.
 */
export interface StageMetricsSnapshot {
  /** Run ID */
  runId: string;
  /** Source ID */
  sourceId: string;
  /** Tenant ID */
  tenantId: string | null;
  /** When the snapshot was taken */
  timestamp: string;
  /** The stage this snapshot is for */
  stage: IngestionStage;
  /** Combined metrics */
  metrics: StageMetrics;
  /** Is this a final snapshot (stage completed) */
  isFinal: boolean;
}

/**
 * Complete run metrics summary across all stages.
 */
export interface RunMetricsSummary {
  /** Run ID */
  runId: string;
  /** Source ID */
  sourceId: string;
  /** Tenant ID */
  tenantId: string | null;
  /** When the summary was generated */
  timestamp: string;
  /** Run start time */
  runStartedAt?: string;
  /** Run end time */
  runFinishedAt?: string;
  /** Total run duration in milliseconds */
  runDurationMs?: number;
  /** Metrics for each stage */
  stages: Partial<Record<IngestionStage, StageMetrics>>;
  /** Overall aggregated metrics */
  overall: {
    totalItemsProcessed: number;
    totalItemsCompleted: number;
    totalItemsFailed: number;
    totalItemsSkipped: number;
    overallSuccessRate: number;
    criticalPath: IngestionStage[];
    bottleneckStage?: IngestionStage;
  };
  /** Throughput summary */
  throughput?: {
    avgThroughputPerSecond: number;
    maxThroughputPerSecond: number;
    minThroughputPerSecond: number;
    maxThroughputStage?: IngestionStage;
    minThroughputStage?: IngestionStage;
  };
  /** Latency summary */
  latency?: {
    avgLatencyMs: number;
    maxLatencyMs: number;
    minLatencyMs: number;
    maxLatencyStage?: IngestionStage;
    minLatencyStage?: IngestionStage;
  };
}

/**
 * Stage metrics log entry for structured logging.
 */
export interface StageMetricsLog {
  /** Event type */
  event: "stage_metrics";
  /** The stage */
  stage: IngestionStage;
  /** Run context */
  runId: string;
  sourceId: string;
  tenantId: string | null;
  /** Timestamp */
  timestamp: string;
  /** Whether this is a final emission */
  isFinal: boolean;
  /** Throughput metrics */
  itemsCompleted: number;
  itemsFailed: number;
  itemsSkipped: number;
  totalItems: number;
  successRate: number;
  throughputPerSecond: number;
  /** Latency metrics */
  minLatencyMs: number;
  maxLatencyMs: number;
  averageLatencyMs: number;
  totalDurationMs: number;
  /** Timing */
  wallClockDurationMs?: number;
}


/**
 * Configuration for stage metrics collection and emission.
 */
export interface StageMetricsConfig {
  /** Whether metrics collection is enabled */
  enabled: boolean;
  /** Interval in ms for emitting periodic metrics (0 to disable periodic emission) */
  emitIntervalMs: number;
  /** Whether to emit debug logs */
  debug: boolean;
}

// ============================================================================
// Stage Metrics Helper Functions
// ============================================================================

/**
 * Checks if stage metrics are disabled via environment variable.
 *
 * @returns true if metrics are disabled
 */
export function isStageMetricsDisabled(): boolean {
  const disabled = process.env[METRICS_DISABLED_ENV_VAR];
  return disabled === "true" || disabled === "1";
}

/**
 * Checks if stage metrics debug logging is enabled.
 *
 * @returns true if debug logging is enabled
 */
export function isStageMetricsDebugEnabled(): boolean {
  const debug = process.env[STAGE_METRICS_ENV_VARS.DEBUG];
  return debug === "true" || debug === "1";
}

/**
 * Gets the stage metrics emit interval from environment or default.
 *
 * @returns Emit interval in milliseconds
 */
export function getStageMetricsEmitInterval(): number {
  const envValue = process.env[METRICS_EMIT_INTERVAL_ENV_VAR];
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_METRICS_EMIT_INTERVAL_MS;
}

/**
 * Gets the default stage metrics configuration from environment.
 *
 * @returns StageMetricsConfig with resolved values
 */
export function getStageMetricsConfig(): StageMetricsConfig {
  return {
    enabled: !isStageMetricsDisabled(),
    emitIntervalMs: getStageMetricsEmitInterval(),
    debug: isStageMetricsDebugEnabled(),
  };
}

/**
 * Builds a Redis key for storing stage metrics.
 *
 * @param runId - The run ID
 * @param stage - The ingestion stage
 * @returns Redis key string
 */
export function buildStageMetricsKey(runId: string, stage: IngestionStage): string {
  return `${STAGE_METRICS_KEY_PREFIX}${runId}:${stage}`;
}

/**
 * Gets the TTL for stage metrics keys.
 *
 * @returns TTL in seconds
 */
export function getStageMetricsKeyTtl(): number {
  return STAGE_METRICS_KEY_TTL_SECONDS;
}

/**
 * Creates an empty latency stats object.
 *
 * @returns Empty StageLatencyStats
 */
export function createEmptyLatencyStats(): StageLatencyStats {
  return {
    minMs: Infinity,
    maxMs: 0,
    sumMs: 0,
    count: 0,
    averageMs: 0,
  };
}

/**
 * Creates an empty stage metrics data object.
 *
 * @returns Empty StageMetricsData
 */
export function createEmptyStageMetricsData(): StageMetricsData {
  return {
    completed: 0,
    failed: 0,
    skipped: 0,
    latencyStats: createEmptyLatencyStats(),
    firstItemStartedAt: undefined,
    lastItemCompletedAt: undefined,
  };
}

/**
 * Creates an empty run stage metrics accumulator.
 *
 * @param runId - The run ID
 * @param sourceId - The source ID
 * @param tenantId - The tenant ID
 * @returns Empty RunStageMetricsAccumulator
 */
export function createRunStageMetricsAccumulator(
  runId: string,
  sourceId: string,
  tenantId: string | null
): RunStageMetricsAccumulator {
  const now = new Date().toISOString();
  return {
    runId,
    sourceId,
    tenantId,
    createdAt: now,
    updatedAt: now,
    stages: {
      [IngestionStage.DISCOVER]: createEmptyStageMetricsData(),
      [IngestionStage.FETCH]: createEmptyStageMetricsData(),
      [IngestionStage.EXTRACT]: createEmptyStageMetricsData(),
      [IngestionStage.CHUNK]: createEmptyStageMetricsData(),
      [IngestionStage.EMBED]: createEmptyStageMetricsData(),
      [IngestionStage.INDEX]: createEmptyStageMetricsData(),
    } as Record<IngestionStage, StageMetricsData>,
  };
}

/**
 * Updates latency stats with a new sample.
 *
 * @param stats - Current latency stats
 * @param durationMs - New duration sample
 * @returns Updated StageLatencyStats
 */
export function updateLatencyStats(
  stats: StageLatencyStats,
  durationMs: number
): StageLatencyStats {
  const newCount = stats.count + 1;
  const newSum = stats.sumMs + durationMs;
  return {
    minMs: Math.min(stats.minMs, durationMs),
    maxMs: Math.max(stats.maxMs, durationMs),
    sumMs: newSum,
    count: newCount,
    averageMs: newSum / newCount,
  };
}

/**
 * Records an item timing into the accumulator.
 *
 * @param accumulator - The run metrics accumulator
 * @param timing - The item timing to record
 * @returns Updated accumulator
 */
export function recordItemTiming(
  accumulator: RunStageMetricsAccumulator,
  timing: StageItemTiming
): RunStageMetricsAccumulator {
  const stageData = accumulator.stages[timing.stage];

  // Update outcome counts
  if (timing.outcome === "completed") {
    stageData.completed++;
  } else if (timing.outcome === "failed") {
    stageData.failed++;
  } else if (timing.outcome === "skipped") {
    stageData.skipped++;
  }

  // Update latency stats if we have duration
  if (timing.durationMs !== undefined && timing.durationMs >= 0) {
    stageData.latencyStats = updateLatencyStats(stageData.latencyStats, timing.durationMs);
  }

  // Track first/last timestamps
  if (!stageData.firstItemStartedAt || timing.startedAt < stageData.firstItemStartedAt) {
    stageData.firstItemStartedAt = timing.startedAt;
  }
  if (timing.finishedAt) {
    if (!stageData.lastItemCompletedAt || timing.finishedAt > stageData.lastItemCompletedAt) {
      stageData.lastItemCompletedAt = timing.finishedAt;
    }
  }

  accumulator.updatedAt = new Date().toISOString();

  return accumulator;
}

/**
 * Creates a stage item timing record.
 *
 * @param itemId - Item identifier
 * @param stage - Ingestion stage
 * @param startedAt - Start timestamp (ISO string)
 * @param finishedAt - Finish timestamp (ISO string, optional)
 * @param outcome - Processing outcome
 * @param errorCode - Error code if failed (optional)
 * @returns StageItemTiming record
 */
export function createStageItemTiming(
  itemId: string,
  stage: IngestionStage,
  startedAt: string,
  finishedAt: string | undefined,
  outcome: "completed" | "failed" | "skipped",
  errorCode?: string
): StageItemTiming {
  let durationMs: number | undefined;

  if (finishedAt && startedAt) {
    const start = new Date(startedAt).getTime();
    const end = new Date(finishedAt).getTime();
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      durationMs = end - start;
    }
  }

  return {
    itemId,
    stage,
    startedAt,
    finishedAt,
    durationMs,
    outcome,
    errorCode,
  };
}

/**
 * Calculates throughput metrics from stage data.
 *
 * @param stage - The ingestion stage
 * @param data - Stage metrics data
 * @param wallClockDurationMs - Wall clock time for throughput calculation
 * @returns StageThroughputMetrics
 */
export function calculateThroughputMetrics(
  stage: IngestionStage,
  data: StageMetricsData,
  wallClockDurationMs?: number
): StageThroughputMetrics {
  const totalItems = data.completed + data.failed + data.skipped;
  const successRate = totalItems > 0 ? (data.completed / totalItems) * 100 : 0;

  // Calculate throughput (items per second)
  let throughputPerSecond = 0;
  if (wallClockDurationMs && wallClockDurationMs > 0) {
    throughputPerSecond = (data.completed / wallClockDurationMs) * 1000;
  }

  return {
    stage,
    itemsCompleted: data.completed,
    itemsFailed: data.failed,
    itemsSkipped: data.skipped,
    totalItems,
    successRate,
    throughputPerSecond,
  };
}

/**
 * Calculates latency metrics from stage data.
 *
 * @param stage - The ingestion stage
 * @param data - Stage metrics data
 * @returns StageLatencyMetrics
 */
export function calculateLatencyMetrics(
  stage: IngestionStage,
  data: StageMetricsData
): StageLatencyMetrics {
  const { latencyStats } = data;

  return {
    stage,
    minLatencyMs: latencyStats.count > 0 ? latencyStats.minMs : 0,
    maxLatencyMs: latencyStats.maxMs,
    averageLatencyMs: latencyStats.averageMs,
    totalDurationMs: latencyStats.sumMs,
    sampleCount: latencyStats.count,
  };
}

/**
 * Calculates combined stage metrics.
 *
 * @param stage - The ingestion stage
 * @param data - Stage metrics data
 * @returns StageMetrics
 */
export function calculateStageMetrics(
  stage: IngestionStage,
  data: StageMetricsData
): StageMetrics {
  // Calculate wall clock duration
  let wallClockDurationMs: number | undefined;
  if (data.firstItemStartedAt && data.lastItemCompletedAt) {
    const start = new Date(data.firstItemStartedAt).getTime();
    const end = new Date(data.lastItemCompletedAt).getTime();
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      wallClockDurationMs = end - start;
    }
  }

  return {
    stage,
    throughput: calculateThroughputMetrics(stage, data, wallClockDurationMs),
    latency: calculateLatencyMetrics(stage, data),
    firstItemStartedAt: data.firstItemStartedAt,
    lastItemCompletedAt: data.lastItemCompletedAt,
    wallClockDurationMs,
  };
}

/**
 * Creates a stage metrics snapshot from accumulator.
 *
 * @param accumulator - The run metrics accumulator
 * @param stage - The stage to snapshot
 * @param isFinal - Whether this is a final snapshot
 * @returns StageMetricsSnapshot
 */
export function createStageMetricsSnapshot(
  accumulator: RunStageMetricsAccumulator,
  stage: IngestionStage,
  isFinal: boolean
): StageMetricsSnapshot {
  const data = accumulator.stages[stage];

  return {
    runId: accumulator.runId,
    sourceId: accumulator.sourceId,
    tenantId: accumulator.tenantId,
    timestamp: new Date().toISOString(),
    stage,
    metrics: calculateStageMetrics(stage, data),
    isFinal,
  };
}

/**
 * Creates a complete run metrics summary from accumulator.
 *
 * @param accumulator - The run metrics accumulator
 * @param runStartedAt - When the run started (ISO timestamp)
 * @param runFinishedAt - When the run finished (ISO timestamp, optional)
 * @returns RunMetricsSummary
 */
export function createRunMetricsSummary(
  accumulator: RunStageMetricsAccumulator,
  runStartedAt?: string,
  runFinishedAt?: string
): RunMetricsSummary {
  // Calculate metrics for each stage
  const stageMetrics: Partial<Record<IngestionStage, StageMetrics>> = {};
  let totalCompleted = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let maxLatencyStage: IngestionStage | undefined;
  let maxLatency = 0;
  let minThroughputStage: IngestionStage | undefined;
  let minThroughput = Infinity;

  for (const stage of Object.values(IngestionStage)) {
    const data = accumulator.stages[stage];
    if (data.completed > 0 || data.failed > 0 || data.skipped > 0) {
      const metrics = calculateStageMetrics(stage, data);
      stageMetrics[stage] = metrics;

      // Track totals from first stage (discover)
      if (stage === IngestionStage.DISCOVER) {
        totalCompleted = data.completed;
        totalFailed = data.failed;
        totalSkipped = data.skipped;
      }

      // Track stage with highest average latency
      if (metrics.latency.averageLatencyMs > maxLatency) {
        maxLatency = metrics.latency.averageLatencyMs;
        maxLatencyStage = stage;
      }

      // Track stage with lowest throughput (excluding zero)
      if (metrics.throughput.throughputPerSecond > 0 &&
          metrics.throughput.throughputPerSecond < minThroughput) {
        minThroughput = metrics.throughput.throughputPerSecond;
        minThroughputStage = stage;
      }
    }
  }

  // Build critical path (stages sorted by average latency, descending)
  const criticalPath = Object.entries(stageMetrics)
    .filter(([, m]) => m.latency.averageLatencyMs > 0)
    .sort(([, a], [, b]) => b.latency.averageLatencyMs - a.latency.averageLatencyMs)
    .map(([s]) => s as IngestionStage);

  // Calculate run duration
  let runDurationMs: number | undefined;
  if (runStartedAt && runFinishedAt) {
    const start = new Date(runStartedAt).getTime();
    const end = new Date(runFinishedAt).getTime();
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      runDurationMs = end - start;
    }
  }

  const totalItems = totalCompleted + totalFailed + totalSkipped;

  return {
    runId: accumulator.runId,
    sourceId: accumulator.sourceId,
    tenantId: accumulator.tenantId,
    timestamp: new Date().toISOString(),
    runStartedAt,
    runFinishedAt,
    runDurationMs,
    stages: stageMetrics,
    overall: {
      totalItemsProcessed: totalItems,
      totalItemsCompleted: totalCompleted,
      totalItemsFailed: totalFailed,
      totalItemsSkipped: totalSkipped,
      overallSuccessRate: totalItems > 0 ? (totalCompleted / totalItems) * 100 : 0,
      criticalPath,
      bottleneckStage: minThroughputStage,
    },
  };
}

/**
 * Creates a stage metrics log entry for structured logging.
 *
 * @param snapshot - The stage metrics snapshot
 * @returns StageMetricsLog for structured logging
 */
export function createStageMetricsLog(snapshot: StageMetricsSnapshot): StageMetricsLog {
  const { metrics, throughput, latency } = {
    metrics: snapshot.metrics,
    throughput: snapshot.metrics.throughput,
    latency: snapshot.metrics.latency,
  };

  return {
    event: "stage_metrics",
    stage: snapshot.stage,
    runId: snapshot.runId,
    sourceId: snapshot.sourceId,
    tenantId: snapshot.tenantId,
    timestamp: snapshot.timestamp,
    isFinal: snapshot.isFinal,
    itemsCompleted: throughput.itemsCompleted,
    itemsFailed: throughput.itemsFailed,
    itemsSkipped: throughput.itemsSkipped,
    totalItems: throughput.totalItems,
    successRate: throughput.successRate,
    throughputPerSecond: throughput.throughputPerSecond,
    minLatencyMs: latency.minLatencyMs,
    maxLatencyMs: latency.maxLatencyMs,
    averageLatencyMs: latency.averageLatencyMs,
    totalDurationMs: latency.totalDurationMs,
    wallClockDurationMs: metrics.wallClockDurationMs,
  };
}

/**
 * Formats a stage metrics log for human-readable output.
 *
 * @param log - The stage metrics log
 * @returns Human-readable string
 */
export function formatStageMetricsLog(log: StageMetricsLog): string {
  const parts = [
    `[${log.stage.toUpperCase()}]`,
    log.isFinal ? "(final)" : "(interim)",
    `items=${log.totalItems}`,
    `completed=${log.itemsCompleted}`,
    `failed=${log.itemsFailed}`,
    `skipped=${log.itemsSkipped}`,
    `success=${log.successRate.toFixed(1)}%`,
    `throughput=${log.throughputPerSecond.toFixed(2)}/s`,
    `latency_avg=${log.averageLatencyMs.toFixed(0)}ms`,
    `latency_min=${log.minLatencyMs.toFixed(0)}ms`,
    `latency_max=${log.maxLatencyMs.toFixed(0)}ms`,
  ];

  if (log.wallClockDurationMs !== undefined) {
    parts.push(`wall_clock=${log.wallClockDurationMs}ms`);
  }

  return parts.join(" ");
}

/**
 * Creates a structured JSON log object for a run metrics summary.
 *
 * @param summary - The run metrics summary
 * @returns Object suitable for JSON logging
 */
export function createStructuredRunMetricsLog(
  summary: RunMetricsSummary
): Record<string, unknown> {
  return {
    event: "run_metrics_summary",
    runId: summary.runId,
    sourceId: summary.sourceId,
    tenantId: summary.tenantId,
    timestamp: summary.timestamp,
    runStartedAt: summary.runStartedAt,
    runFinishedAt: summary.runFinishedAt,
    runDurationMs: summary.runDurationMs,
    totalItemsProcessed: summary.overall.totalItemsProcessed,
    totalItemsCompleted: summary.overall.totalItemsCompleted,
    totalItemsFailed: summary.overall.totalItemsFailed,
    totalItemsSkipped: summary.overall.totalItemsSkipped,
    overallSuccessRate: summary.overall.overallSuccessRate,
    criticalPath: summary.overall.criticalPath,
    bottleneckStage: summary.overall.bottleneckStage,
    stages: Object.fromEntries(
      Object.entries(summary.stages).map(([stage, metrics]) => [
        stage,
        {
          itemsCompleted: metrics.throughput.itemsCompleted,
          itemsFailed: metrics.throughput.itemsFailed,
          itemsSkipped: metrics.throughput.itemsSkipped,
          successRate: metrics.throughput.successRate,
          throughputPerSecond: metrics.throughput.throughputPerSecond,
          averageLatencyMs: metrics.latency.averageLatencyMs,
          minLatencyMs: metrics.latency.minLatencyMs,
          maxLatencyMs: metrics.latency.maxLatencyMs,
          totalDurationMs: metrics.latency.totalDurationMs,
          wallClockDurationMs: metrics.wallClockDurationMs,
        },
      ])
    ),
  };
}

/**
 * Merges two stage metrics data objects.
 * Useful for combining metrics from multiple workers.
 *
 * @param a - First metrics data
 * @param b - Second metrics data
 * @returns Merged StageMetricsData
 */
export function mergeStageMetricsData(
  a: StageMetricsData,
  b: StageMetricsData
): StageMetricsData {
  // Merge counts
  const completed = a.completed + b.completed;
  const failed = a.failed + b.failed;
  const skipped = a.skipped + b.skipped;

  // Merge latency stats
  const latencyStats: StageLatencyStats = {
    minMs: Math.min(
      a.latencyStats.count > 0 ? a.latencyStats.minMs : Infinity,
      b.latencyStats.count > 0 ? b.latencyStats.minMs : Infinity
    ),
    maxMs: Math.max(a.latencyStats.maxMs, b.latencyStats.maxMs),
    sumMs: a.latencyStats.sumMs + b.latencyStats.sumMs,
    count: a.latencyStats.count + b.latencyStats.count,
    averageMs: 0,
  };
  if (latencyStats.count > 0) {
    latencyStats.averageMs = latencyStats.sumMs / latencyStats.count;
  }
  if (latencyStats.minMs === Infinity) {
    latencyStats.minMs = 0;
  }

  // Merge timestamps (earliest first, latest last)
  let firstItemStartedAt: string | undefined;
  if (a.firstItemStartedAt && b.firstItemStartedAt) {
    firstItemStartedAt = a.firstItemStartedAt < b.firstItemStartedAt
      ? a.firstItemStartedAt
      : b.firstItemStartedAt;
  } else {
    firstItemStartedAt = a.firstItemStartedAt || b.firstItemStartedAt;
  }

  let lastItemCompletedAt: string | undefined;
  if (a.lastItemCompletedAt && b.lastItemCompletedAt) {
    lastItemCompletedAt = a.lastItemCompletedAt > b.lastItemCompletedAt
      ? a.lastItemCompletedAt
      : b.lastItemCompletedAt;
  } else {
    lastItemCompletedAt = a.lastItemCompletedAt || b.lastItemCompletedAt;
  }

  return {
    completed,
    failed,
    skipped,
    latencyStats,
    firstItemStartedAt,
    lastItemCompletedAt,
  };
}

/**
 * Serializes stage metrics data for Redis storage.
 *
 * @param data - Stage metrics data
 * @returns JSON string
 */
export function serializeStageMetricsData(data: StageMetricsData): string {
  return JSON.stringify(data);
}

/**
 * Deserializes stage metrics data from Redis storage.
 *
 * @param json - JSON string
 * @returns StageMetricsData or undefined if invalid
 */
export function deserializeStageMetricsData(json: string): StageMetricsData | undefined {
  try {
    const parsed = JSON.parse(json);
    // Basic validation
    if (
      typeof parsed === "object" &&
      typeof parsed.completed === "number" &&
      typeof parsed.failed === "number" &&
      typeof parsed.skipped === "number" &&
      typeof parsed.latencyStats === "object"
    ) {
      return parsed as StageMetricsData;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Run Summary Logging
// ============================================================================

/**
 * Error breakdown entry for run summary.
 * Tracks count and sample URLs for each error code.
 */
export interface ErrorBreakdownEntry {
  /** The error code */
  code: string;
  /** The error category */
  category: string;
  /** Whether the error is retryable */
  retryable: boolean;
  /** Count of occurrences */
  count: number;
  /** Sample of URLs that failed with this error (limited for log size) */
  sampleUrls: string[];
}

/**
 * Skip reason breakdown entry for run summary.
 * Tracks count and sample URLs for each skip reason.
 */
export interface SkipBreakdownEntry {
  /** The skip reason */
  reason: SkipReason;
  /** Human-readable description of the skip reason */
  description: string;
  /** The stage where skips occurred */
  stage: IngestionStage;
  /** Count of pages skipped for this reason */
  count: number;
  /** Sample of URLs skipped for this reason (limited for log size) */
  sampleUrls: string[];
}

/**
 * Per-stage summary for run completion.
 */
export interface StageSummary {
  /** Stage name */
  stage: IngestionStage;
  /** Items that completed successfully */
  completed: number;
  /** Items that failed */
  failed: number;
  /** Items that were skipped */
  skipped: number;
  /** Total items processed by this stage */
  total: number;
  /** Success rate as percentage (0-100) */
  successRate: number;
}

/**
 * Complete run summary with error breakdown and skip counts.
 */
export interface RunSummaryLog {
  /** Event type for structured logging */
  event: "run_summary";
  /** Unique run identifier */
  runId: string;
  /** Source identifier */
  sourceId: string;
  /** Tenant identifier */
  tenantId: string | null;
  /** Timestamp when summary was generated */
  timestamp: string;
  /** Final run status */
  finalStatus: "succeeded" | "partial" | "failed" | "embedding_incomplete";
  /** Run duration in milliseconds */
  runDurationMs: number;
  /** When the run started */
  runStartedAt: string;
  /** When the run finished */
  runFinishedAt: string;

  /** Overall page counts */
  pages: {
    /** Total pages discovered */
    total: number;
    /** Pages successfully processed */
    succeeded: number;
    /** Pages that failed processing */
    failed: number;
    /** Pages that were skipped (all reasons) */
    skipped: number;
    /** Success rate as percentage (0-100) */
    successRate: number;
  };

  /** Embedding summary (if applicable) */
  embeddings?: {
    /** Total chunks to embed */
    chunksToEmbed: number;
    /** Chunks successfully embedded */
    chunksEmbedded: number;
    /** Chunks that failed embedding */
    chunksFailed: number;
    /** Embedding completion rate as percentage (0-100) */
    completionRate: number;
  };

  /** Error breakdown by error code */
  errorBreakdown: ErrorBreakdownEntry[];

  /** Skip breakdown by reason */
  skipBreakdown: SkipBreakdownEntry[];

  /** Per-stage summary (optional, for detailed logging) */
  stageSummaries?: StageSummary[];

  /** Summary statistics */
  summary: {
    /** Total unique error codes encountered */
    uniqueErrorCodes: number;
    /** Total unique skip reasons encountered */
    uniqueSkipReasons: number;
    /** Most common error code (if any) */
    mostCommonError?: { code: string; count: number };
    /** Most common skip reason (if any) */
    mostCommonSkip?: { reason: SkipReason; count: number };
    /** Whether any retryable errors occurred */
    hasRetryableErrors: boolean;
    /** Whether any permanent errors occurred */
    hasPermanentErrors: boolean;
  };
}

/**
 * Configuration for run summary logging.
 */
export interface RunSummaryLoggingConfig {
  /** Whether to include per-stage summaries */
  includeStageBreakdown: boolean;
  /** Maximum sample URLs per error/skip entry */
  maxSampleUrls: number;
  /** Whether to log summary on successful runs */
  logSuccessfulRuns: boolean;
  /** Minimum pages to warrant logging (skip logging for very small runs) */
  minPagesForLogging: number;
  /** Whether to include error breakdown */
  includeErrorBreakdown: boolean;
  /** Whether to include skip breakdown */
  includeSkipBreakdown: boolean;
}

/**
 * Input data for creating a run summary.
 */
export interface RunSummaryInput {
  runId: string;
  sourceId: string;
  tenantId: string | null;
  finalStatus: "succeeded" | "partial" | "failed" | "embedding_incomplete";
  runStartedAt: Date;
  runFinishedAt: Date;
  pages: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
  embeddings?: {
    chunksToEmbed: number;
    chunksEmbedded: number;
    chunksFailed?: number;
  };
  /** Failed pages with their URLs and error messages */
  failedPages: Array<{ url: string; error: string }>;
  /** Skipped pages with their URLs and skip details */
  skippedPages: Array<{ url: string; skipDetails?: PageSkipDetails }>;
  /** Optional per-stage metrics */
  stageMetrics?: Partial<Record<IngestionStage, StageMetricsData>>;
}

/**
 * Structured run summary log for JSON logging.
 */
export interface StructuredRunSummaryLog extends RunSummaryLog {
  /** Log level */
  level: "info" | "warn" | "error";
  /** Service name for log filtering */
  service: string;
}

/**
 * Returns the default run summary logging configuration.
 *
 * @returns Default RunSummaryLoggingConfig
 */
export function getDefaultRunSummaryLoggingConfig(): RunSummaryLoggingConfig {
  return {
    includeStageBreakdown: true,
    maxSampleUrls: 5,
    logSuccessfulRuns: true,
    minPagesForLogging: 0,
    includeErrorBreakdown: true,
    includeSkipBreakdown: true,
  };
}

/**
 * Maps a skip reason to a human-readable description.
 *
 * @param reason - The skip reason
 * @returns Human-readable description
 */
export function getSkipReasonDescription(reason: SkipReason): string {
  const descriptions: Record<SkipReason, string> = {
    [SkipReason.NON_HTML_CONTENT_TYPE]: "Non-HTML content type",
    [SkipReason.CONTENT_UNCHANGED]: "Content unchanged since last crawl",
    [SkipReason.ROBOTS_BLOCKED]: "Blocked by robots.txt",
    [SkipReason.DEPTH_EXCEEDED]: "URL depth exceeded limit",
    [SkipReason.PATTERN_EXCLUDED]: "URL excluded by pattern filter",
    [SkipReason.ALREADY_CRAWLED]: "URL already crawled in this run",
  };
  return descriptions[reason] || reason;
}

/**
 * Maps a skip reason to the stage where it typically occurs.
 *
 * @param reason - The skip reason
 * @returns The ingestion stage
 */
export function getSkipReasonStage(reason: SkipReason): IngestionStage {
  const stageMap: Record<SkipReason, IngestionStage> = {
    [SkipReason.NON_HTML_CONTENT_TYPE]: IngestionStage.FETCH,
    [SkipReason.CONTENT_UNCHANGED]: IngestionStage.FETCH,
    [SkipReason.ROBOTS_BLOCKED]: IngestionStage.DISCOVER,
    [SkipReason.DEPTH_EXCEEDED]: IngestionStage.DISCOVER,
    [SkipReason.PATTERN_EXCLUDED]: IngestionStage.DISCOVER,
    [SkipReason.ALREADY_CRAWLED]: IngestionStage.DISCOVER,
  };
  return stageMap[reason] || IngestionStage.DISCOVER;
}

/**
 * Parses an error message to extract an error code.
 * Attempts to match known error patterns.
 *
 * @param errorMessage - The error message to parse
 * @returns The extracted error code or UNKNOWN_ERROR
 */
export function parseErrorCodeFromMessage(errorMessage: string): string {
  if (!errorMessage) return "UNKNOWN_ERROR";

  const msg = errorMessage.toUpperCase();

  // Check for explicit error codes in the message
  const errorCodes = [
    "NETWORK_TIMEOUT", "NETWORK_CONNECTION_REFUSED", "NETWORK_DNS_FAILURE",
    "NETWORK_RESET", "NETWORK_SSL_ERROR",
    "SERVICE_UNAVAILABLE", "SERVICE_RATE_LIMITED", "SERVICE_TIMEOUT",
    "SERVICE_BAD_GATEWAY", "SERVICE_GATEWAY_TIMEOUT", "SERVICE_OVERLOADED", "SERVICE_API_ERROR",
    "CONTENT_TOO_LARGE", "CONTENT_INVALID_FORMAT", "CONTENT_EMPTY",
    "CONTENT_UNSUPPORTED_TYPE", "CONTENT_PARSE_FAILED", "CONTENT_ENCODING_ERROR",
    "CONFIG_MISSING", "CONFIG_INVALID", "CONFIG_API_KEY_MISSING",
    "CONFIG_MODEL_MISMATCH", "CONFIG_DIMENSION_MISMATCH",
    "NOT_FOUND_RESOURCE", "NOT_FOUND_URL", "NOT_FOUND_KB",
    "NOT_FOUND_SOURCE", "NOT_FOUND_RUN", "NOT_FOUND_CHUNK",
    "VALIDATION_SCHEMA", "VALIDATION_URL_INVALID", "VALIDATION_CONSTRAINT", "VALIDATION_PAYLOAD",
    "AUTH_FORBIDDEN", "AUTH_UNAUTHORIZED", "AUTH_BLOCKED",
    "SYSTEM_OUT_OF_MEMORY", "SYSTEM_DISK_FULL", "SYSTEM_INTERNAL", "SYSTEM_DATABASE_ERROR",
  ];

  for (const code of errorCodes) {
    if (msg.includes(code)) return code;
  }

  // Pattern matching for common error types
  // Note: More specific patterns (like "GATEWAY TIMEOUT") must be checked before generic ones (like "TIMEOUT")
  if (msg.includes("504") || msg.includes("GATEWAY TIMEOUT")) {
    return "SERVICE_GATEWAY_TIMEOUT";
  }
  if (msg.includes("TIMEOUT") || msg.includes("TIMED OUT") || msg.includes("ETIMEDOUT")) {
    return "NETWORK_TIMEOUT";
  }
  if (msg.includes("CONNECTION REFUSED") || msg.includes("ECONNREFUSED")) {
    return "NETWORK_CONNECTION_REFUSED";
  }
  if (msg.includes("DNS") || msg.includes("ENOTFOUND") || msg.includes("GETADDRINFO")) {
    return "NETWORK_DNS_FAILURE";
  }
  if (msg.includes("ECONNRESET") || msg.includes("CONNECTION RESET")) {
    return "NETWORK_RESET";
  }
  if (msg.includes("SSL") || msg.includes("CERTIFICATE") || msg.includes("TLS")) {
    return "NETWORK_SSL_ERROR";
  }
  if (msg.includes("429") || msg.includes("RATE LIMIT") || msg.includes("TOO MANY REQUESTS")) {
    return "SERVICE_RATE_LIMITED";
  }
  if (msg.includes("503") || msg.includes("SERVICE UNAVAILABLE")) {
    return "SERVICE_UNAVAILABLE";
  }
  if (msg.includes("502") || msg.includes("BAD GATEWAY")) {
    return "SERVICE_BAD_GATEWAY";
  }
  if (msg.includes("404") || msg.includes("NOT FOUND")) {
    return "NOT_FOUND_URL";
  }
  if (msg.includes("401") || msg.includes("UNAUTHORIZED")) {
    return "AUTH_UNAUTHORIZED";
  }
  if (msg.includes("403") || msg.includes("FORBIDDEN")) {
    return "AUTH_FORBIDDEN";
  }
  if (msg.includes("CONTENT TOO LARGE") || msg.includes("PAYLOAD TOO LARGE") || msg.includes("413")) {
    return "CONTENT_TOO_LARGE";
  }
  if (msg.includes("PARSE") || msg.includes("PARSING")) {
    return "CONTENT_PARSE_FAILED";
  }
  if (msg.includes("ENCODING") || msg.includes("DECODE")) {
    return "CONTENT_ENCODING_ERROR";
  }

  return "UNKNOWN_ERROR";
}

/**
 * Determines if an error code represents a retryable error.
 *
 * @param errorCode - The error code
 * @returns true if retryable, false if permanent
 */
export function isErrorCodeRetryable(errorCode: string): boolean {
  // Network errors - typically retryable
  if (errorCode === "NETWORK_TIMEOUT") return true;
  if (errorCode === "NETWORK_CONNECTION_REFUSED") return true;
  if (errorCode === "NETWORK_DNS_FAILURE") return true;
  if (errorCode === "NETWORK_RESET") return true;
  if (errorCode === "NETWORK_SSL_ERROR") return false;

  // Service errors - mostly retryable
  if (errorCode === "SERVICE_UNAVAILABLE") return true;
  if (errorCode === "SERVICE_RATE_LIMITED") return true;
  if (errorCode === "SERVICE_TIMEOUT") return true;
  if (errorCode === "SERVICE_BAD_GATEWAY") return true;
  if (errorCode === "SERVICE_GATEWAY_TIMEOUT") return true;
  if (errorCode === "SERVICE_OVERLOADED") return true;
  if (errorCode === "SERVICE_API_ERROR") return false;

  // Content errors - permanent
  if (errorCode.startsWith("CONTENT_")) return false;

  // Configuration errors - permanent
  if (errorCode.startsWith("CONFIG_")) return false;

  // Not found errors - permanent
  if (errorCode.startsWith("NOT_FOUND_")) return false;

  // Validation errors - permanent
  if (errorCode.startsWith("VALIDATION_")) return false;

  // Auth errors - permanent
  if (errorCode.startsWith("AUTH_")) return false;

  // System errors - some retryable
  if (errorCode === "SYSTEM_OUT_OF_MEMORY") return true;
  if (errorCode === "SYSTEM_DISK_FULL") return false;
  if (errorCode === "SYSTEM_INTERNAL") return true;
  if (errorCode === "SYSTEM_DATABASE_ERROR") return true;

  // Unknown - default to retryable
  return true;
}

/**
 * Builds error breakdown from failed pages.
 *
 * @param failedPages - Array of failed pages with URLs and error messages
 * @param maxSampleUrls - Maximum sample URLs per error entry
 * @returns Array of ErrorBreakdownEntry sorted by count descending
 */
export function buildErrorBreakdown(
  failedPages: Array<{ url: string; error: string }>,
  maxSampleUrls: number = 5
): ErrorBreakdownEntry[] {
  const breakdown = new Map<string, ErrorBreakdownEntry>();

  for (const page of failedPages) {
    const code = parseErrorCodeFromMessage(page.error);
    const existing = breakdown.get(code);

    if (existing) {
      existing.count++;
      if (existing.sampleUrls.length < maxSampleUrls) {
        existing.sampleUrls.push(page.url);
      }
    } else {
      breakdown.set(code, {
        code,
        category: getErrorCategoryFromCode(code),
        retryable: isErrorCodeRetryable(code),
        count: 1,
        sampleUrls: [page.url],
      });
    }
  }

  // Sort by count descending
  return Array.from(breakdown.values()).sort((a, b) => b.count - a.count);
}

/**
 * Builds skip breakdown from skipped pages.
 *
 * @param skippedPages - Array of skipped pages with URLs and skip details
 * @param maxSampleUrls - Maximum sample URLs per skip entry
 * @returns Array of SkipBreakdownEntry sorted by count descending
 */
export function buildSkipBreakdown(
  skippedPages: Array<{ url: string; skipDetails?: PageSkipDetails }>,
  maxSampleUrls: number = 5
): SkipBreakdownEntry[] {
  const breakdown = new Map<SkipReason, SkipBreakdownEntry>();

  for (const page of skippedPages) {
    // Determine skip reason from details or default
    const reason = page.skipDetails?.reason || SkipReason.CONTENT_UNCHANGED;
    const existing = breakdown.get(reason);

    if (existing) {
      existing.count++;
      if (existing.sampleUrls.length < maxSampleUrls) {
        existing.sampleUrls.push(page.url);
      }
    } else {
      breakdown.set(reason, {
        reason,
        description: getSkipReasonDescription(reason),
        stage: page.skipDetails?.stage || getSkipReasonStage(reason),
        count: 1,
        sampleUrls: [page.url],
      });
    }
  }

  // Sort by count descending
  return Array.from(breakdown.values()).sort((a, b) => b.count - a.count);
}

/**
 * Builds per-stage summaries from stage metrics data.
 *
 * @param stageMetrics - Map of stage to metrics data
 * @returns Array of StageSummary for each stage with data
 */
export function buildStageSummaries(
  stageMetrics: Partial<Record<IngestionStage, StageMetricsData>>
): StageSummary[] {
  const summaries: StageSummary[] = [];

  for (const stage of Object.values(IngestionStage)) {
    const data = stageMetrics[stage];
    if (data) {
      const total = data.completed + data.failed + data.skipped;
      summaries.push({
        stage,
        completed: data.completed,
        failed: data.failed,
        skipped: data.skipped,
        total,
        successRate: total > 0 ? Math.round((data.completed / total) * 10000) / 100 : 0,
      });
    }
  }

  return summaries;
}

/**
 * Creates a run summary log from input data.
 *
 * @param input - Run summary input data
 * @param config - Logging configuration
 * @returns RunSummaryLog
 */
export function createRunSummaryLog(
  input: RunSummaryInput,
  config: RunSummaryLoggingConfig = getDefaultRunSummaryLoggingConfig()
): RunSummaryLog {
  const runDurationMs = input.runFinishedAt.getTime() - input.runStartedAt.getTime();
  const totalPages = input.pages.total;
  const successRate = totalPages > 0
    ? Math.round((input.pages.succeeded / totalPages) * 10000) / 100
    : 0;

  // Build error breakdown
  const errorBreakdown = config.includeErrorBreakdown
    ? buildErrorBreakdown(input.failedPages, config.maxSampleUrls)
    : [];

  // Build skip breakdown
  const skipBreakdown = config.includeSkipBreakdown
    ? buildSkipBreakdown(input.skippedPages, config.maxSampleUrls)
    : [];

  // Build stage summaries if requested and data available
  const stageSummaries = config.includeStageBreakdown && input.stageMetrics
    ? buildStageSummaries(input.stageMetrics)
    : undefined;

  // Calculate embedding stats
  let embeddings: RunSummaryLog["embeddings"];
  if (input.embeddings && input.embeddings.chunksToEmbed > 0) {
    const chunksFailed = input.embeddings.chunksFailed || 0;
    const completionRate = Math.round(
      (input.embeddings.chunksEmbedded / input.embeddings.chunksToEmbed) * 10000
    ) / 100;
    embeddings = {
      chunksToEmbed: input.embeddings.chunksToEmbed,
      chunksEmbedded: input.embeddings.chunksEmbedded,
      chunksFailed,
      completionRate,
    };
  }

  // Calculate summary statistics
  const hasRetryableErrors = errorBreakdown.some(e => e.retryable);
  const hasPermanentErrors = errorBreakdown.some(e => !e.retryable);
  const mostCommonError = errorBreakdown.length > 0
    ? { code: errorBreakdown[0].code, count: errorBreakdown[0].count }
    : undefined;
  const mostCommonSkip = skipBreakdown.length > 0
    ? { reason: skipBreakdown[0].reason, count: skipBreakdown[0].count }
    : undefined;

  return {
    event: "run_summary",
    runId: input.runId,
    sourceId: input.sourceId,
    tenantId: input.tenantId,
    timestamp: new Date().toISOString(),
    finalStatus: input.finalStatus,
    runDurationMs,
    runStartedAt: input.runStartedAt.toISOString(),
    runFinishedAt: input.runFinishedAt.toISOString(),
    pages: {
      total: input.pages.total,
      succeeded: input.pages.succeeded,
      failed: input.pages.failed,
      skipped: input.pages.skipped,
      successRate,
    },
    embeddings,
    errorBreakdown,
    skipBreakdown,
    stageSummaries,
    summary: {
      uniqueErrorCodes: errorBreakdown.length,
      uniqueSkipReasons: skipBreakdown.length,
      mostCommonError,
      mostCommonSkip,
      hasRetryableErrors,
      hasPermanentErrors,
    },
  };
}

/**
 * Determines the appropriate log level for a run summary.
 *
 * @param summary - The run summary log
 * @returns Log level
 */
export function getRunSummaryLogLevel(summary: RunSummaryLog): "info" | "warn" | "error" {
  if (summary.finalStatus === "failed") return "error";
  if (summary.finalStatus === "partial" || summary.finalStatus === "embedding_incomplete") return "warn";
  if (summary.pages.failed > 0 || summary.summary.hasRetryableErrors) return "warn";
  return "info";
}

/**
 * Creates a structured run summary log for JSON logging.
 *
 * @param summary - The run summary log
 * @param service - Service name for log filtering
 * @returns StructuredRunSummaryLog
 */
export function createStructuredRunSummaryLog(
  summary: RunSummaryLog,
  service: string = "ingestion-worker"
): StructuredRunSummaryLog {
  return {
    ...summary,
    level: getRunSummaryLogLevel(summary),
    service,
  };
}

/**
 * Formats a run summary log for human-readable output.
 *
 * @param summary - The run summary log
 * @returns Human-readable formatted string
 */
export function formatRunSummaryLog(summary: RunSummaryLog): string {
  const lines: string[] = [];

  // Header
  lines.push(`=== Run Summary: ${summary.runId} ===`);
  lines.push(`Status: ${summary.finalStatus.toUpperCase()}`);
  lines.push(`Duration: ${(summary.runDurationMs / 1000).toFixed(2)}s`);
  lines.push("");

  // Page counts
  lines.push("Pages:");
  lines.push(`  Total: ${summary.pages.total}`);
  lines.push(`  Succeeded: ${summary.pages.succeeded}`);
  lines.push(`  Failed: ${summary.pages.failed}`);
  lines.push(`  Skipped: ${summary.pages.skipped}`);
  lines.push(`  Success Rate: ${summary.pages.successRate}%`);

  // Embeddings
  if (summary.embeddings) {
    lines.push("");
    lines.push("Embeddings:");
    lines.push(`  Chunks to Embed: ${summary.embeddings.chunksToEmbed}`);
    lines.push(`  Chunks Embedded: ${summary.embeddings.chunksEmbedded}`);
    lines.push(`  Chunks Failed: ${summary.embeddings.chunksFailed}`);
    lines.push(`  Completion Rate: ${summary.embeddings.completionRate}%`);
  }

  // Error breakdown
  if (summary.errorBreakdown.length > 0) {
    lines.push("");
    lines.push("Error Breakdown:");
    for (const entry of summary.errorBreakdown) {
      const retryableStr = entry.retryable ? "[retryable]" : "[permanent]";
      lines.push(`  ${entry.code} (${entry.category}) ${retryableStr}: ${entry.count}`);
      if (entry.sampleUrls.length > 0) {
        lines.push(`    Sample: ${entry.sampleUrls[0]}`);
      }
    }
  }

  // Skip breakdown
  if (summary.skipBreakdown.length > 0) {
    lines.push("");
    lines.push("Skip Breakdown:");
    for (const entry of summary.skipBreakdown) {
      lines.push(`  ${entry.reason} (${entry.stage}): ${entry.count}`);
      lines.push(`    ${entry.description}`);
    }
  }

  // Stage summaries
  if (summary.stageSummaries && summary.stageSummaries.length > 0) {
    lines.push("");
    lines.push("Stage Summaries:");
    for (const stage of summary.stageSummaries) {
      lines.push(`  ${stage.stage}: ${stage.completed}/${stage.total} (${stage.successRate}%)`);
    }
  }

  return lines.join("\n");
}

/**
 * Determines if a run summary should be logged based on configuration.
 *
 * @param summary - The run summary
 * @param config - Logging configuration
 * @returns true if the summary should be logged
 */
export function shouldLogRunSummary(
  summary: RunSummaryLog,
  config: RunSummaryLoggingConfig = getDefaultRunSummaryLoggingConfig()
): boolean {
  // Check minimum pages threshold
  if (summary.pages.total < config.minPagesForLogging) {
    return false;
  }

  // Check if we should log successful runs
  if (summary.finalStatus === "succeeded" && !config.logSuccessfulRuns) {
    return false;
  }

  return true;
}

/**
 * Creates a compact summary string for quick logging.
 *
 * @param summary - The run summary
 * @returns Compact summary string
 */
export function createCompactRunSummary(summary: RunSummaryLog): string {
  const parts: string[] = [
    `status=${summary.finalStatus}`,
    `pages=${summary.pages.succeeded}/${summary.pages.total}`,
    `failed=${summary.pages.failed}`,
    `skipped=${summary.pages.skipped}`,
    `duration=${(summary.runDurationMs / 1000).toFixed(1)}s`,
  ];

  if (summary.embeddings) {
    parts.push(`embedded=${summary.embeddings.chunksEmbedded}/${summary.embeddings.chunksToEmbed}`);
  }

  if (summary.summary.mostCommonError) {
    parts.push(`top_error=${summary.summary.mostCommonError.code}(${summary.summary.mostCommonError.count})`);
  }

  if (summary.summary.mostCommonSkip) {
    parts.push(`top_skip=${summary.summary.mostCommonSkip.reason}(${summary.summary.mostCommonSkip.count})`);
  }

  return parts.join(" | ");
}

// ============================================================================
// Fairness Scheduler Types
// ============================================================================

import {
  FAIRNESS_ACTIVE_RUNS_KEY,
  FAIRNESS_SLOTS_KEY_PREFIX,
  FAIRNESS_LAST_SERVED_KEY_PREFIX,
  FAIRNESS_SLOT_TTL_SECONDS,
  FAIRNESS_RETRY_DELAY_MS,
  FAIRNESS_MIN_SLOTS_PER_RUN,
  FAIRNESS_ENV_VARS,
} from "../constants";

/**
 * Configuration for the fairness scheduler.
 * Controls how concurrent jobs are distributed across source runs.
 */
export interface FairnessConfig {
  /** Whether fairness scheduling is enabled */
  enabled: boolean;
  /** Total concurrent slots available (typically matches WORKER_CONCURRENCY) */
  totalSlots: number;
  /** Minimum slots guaranteed per run regardless of active run count */
  minSlotsPerRun: number;
  /** Maximum slots any single run can use (prevents monopolization) */
  maxSlotsPerRun: number;
  /** Delay in ms when a job cannot acquire a slot and needs to retry */
  retryDelayMs: number;
  /** TTL for slot tracking keys in seconds (safety for crashed workers) */
  slotTtlSeconds: number;
  /** Enable debug logging for fairness decisions */
  debug: boolean;
}

/**
 * Result of attempting to acquire a fairness slot.
 */
export interface FairnessSlotResult {
  /** Whether a slot was successfully acquired */
  acquired: boolean;
  /** If not acquired, the suggested delay before retry */
  retryDelayMs?: number;
  /** Current number of active slots for this run */
  currentSlots: number;
  /** Maximum slots allowed for this run (based on active runs) */
  maxAllowedSlots: number;
  /** Number of currently active runs */
  activeRunCount: number;
  /** Reason if slot was not acquired */
  reason?: "at_limit" | "not_registered" | "disabled";
}

/**
 * Metrics snapshot for fairness scheduler monitoring.
 */
export interface FairnessMetrics {
  /** Number of currently active source runs */
  activeRunCount: number;
  /** Total slots currently in use across all runs */
  totalSlotsInUse: number;
  /** Total slots available */
  totalSlotsAvailable: number;
  /** Per-run slot usage */
  runSlots: Record<string, number>;
  /** Calculated fair share per run */
  fairSharePerRun: number;
  /** Timestamp of this snapshot */
  timestamp: string;
}

/**
 * Builds the Redis key for tracking active slots for a run.
 */
export function buildFairnessSlotKey(runId: string): string {
  return `${FAIRNESS_SLOTS_KEY_PREFIX}${runId}`;
}

/**
 * Builds the Redis key for tracking when a run was last served.
 */
export function buildFairnessLastServedKey(runId: string): string {
  return `${FAIRNESS_LAST_SERVED_KEY_PREFIX}${runId}`;
}

/**
 * Resolves fairness configuration from environment variables.
 *
 * @param getEnv - Function to retrieve environment variables
 * @param defaultTotalSlots - Default total slots (typically from WORKER_CONCURRENCY)
 * @returns Resolved FairnessConfig
 */
export function resolveFairnessConfig(
  getEnv: (key: string) => string | undefined,
  defaultTotalSlots: number = 5
): FairnessConfig {
  const disabledValue = getEnv(FAIRNESS_ENV_VARS.DISABLED);
  const enabled = !(disabledValue === "true" || disabledValue === "1");

  const totalSlotsValue = getEnv(FAIRNESS_ENV_VARS.TOTAL_SLOTS);
  const totalSlots = totalSlotsValue ? parseInt(totalSlotsValue, 10) : defaultTotalSlots;

  const minSlotsValue = getEnv(FAIRNESS_ENV_VARS.MIN_SLOTS);
  const minSlotsPerRun = minSlotsValue ? parseInt(minSlotsValue, 10) : FAIRNESS_MIN_SLOTS_PER_RUN;

  const maxSlotsValue = getEnv(FAIRNESS_ENV_VARS.MAX_SLOTS);
  const maxSlotsPerRun = maxSlotsValue ? parseInt(maxSlotsValue, 10) : totalSlots;

  const retryDelayValue = getEnv(FAIRNESS_ENV_VARS.RETRY_DELAY_MS);
  const retryDelayMs = retryDelayValue ? parseInt(retryDelayValue, 10) : FAIRNESS_RETRY_DELAY_MS;

  const debugValue = getEnv(FAIRNESS_ENV_VARS.DEBUG);
  const debug = debugValue === "true" || debugValue === "1";

  return {
    enabled,
    totalSlots: Math.max(1, totalSlots),
    minSlotsPerRun: Math.max(1, minSlotsPerRun),
    maxSlotsPerRun: Math.max(1, maxSlotsPerRun),
    retryDelayMs: Math.max(100, retryDelayMs),
    slotTtlSeconds: FAIRNESS_SLOT_TTL_SECONDS,
    debug,
  };
}

/**
 * Calculates the fair share of slots for each run based on active run count.
 * Uses dynamic fair share: total / activeRuns, but respects min/max bounds.
 *
 * @param totalSlots - Total available slots
 * @param activeRunCount - Number of currently active runs
 * @param minPerRun - Minimum slots per run
 * @param maxPerRun - Maximum slots per run
 * @returns Fair share slot count for each run
 */
export function calculateFairShare(
  totalSlots: number,
  activeRunCount: number,
  minPerRun: number,
  maxPerRun: number
): number {
  if (activeRunCount <= 0) {
    return maxPerRun; // No active runs, use max
  }

  // Calculate raw fair share
  const rawFairShare = Math.floor(totalSlots / activeRunCount);

  // Ensure at least minPerRun, but no more than maxPerRun
  return Math.max(minPerRun, Math.min(rawFairShare, maxPerRun));
}

/**
 * Creates a default fairness configuration.
 * Useful for testing or when environment is not available.
 *
 * @param totalSlots - Total available slots
 * @returns Default FairnessConfig
 */
export function getDefaultFairnessConfig(totalSlots: number = 5): FairnessConfig {
  return {
    enabled: true,
    totalSlots,
    minSlotsPerRun: FAIRNESS_MIN_SLOTS_PER_RUN,
    maxSlotsPerRun: totalSlots,
    retryDelayMs: FAIRNESS_RETRY_DELAY_MS,
    slotTtlSeconds: FAIRNESS_SLOT_TTL_SECONDS,
    debug: false,
  };
}

// Re-export fairness constants for convenience
export {
  FAIRNESS_ACTIVE_RUNS_KEY,
  FAIRNESS_SLOTS_KEY_PREFIX,
  FAIRNESS_LAST_SERVED_KEY_PREFIX,
  FAIRNESS_SLOT_TTL_SECONDS,
  FAIRNESS_RETRY_DELAY_MS,
  FAIRNESS_MIN_SLOTS_PER_RUN,
  FAIRNESS_ENV_VARS,
};
