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
  tenantId: z.string().uuid(),
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
  tenantId: z.string().uuid(),
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
  tenantId: z.string().uuid(),
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
  tenantId: z.string().uuid(),
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
  tenantId: z.string().uuid(),
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
 * Schema for batch embedding job.
 * Generates vector embeddings for a batch of chunks.
 */
export const embedChunksBatchJobSchema = baseJobSchema.extend({
  tenantId: z.string().uuid(),
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
  tenantId: z.string().uuid(),
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
  tenantId: z.string().uuid(),
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
  tenantId: z.string().uuid(),
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
  tenantId: string;
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
function getErrorCategoryFromCode(code: string): string {
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
