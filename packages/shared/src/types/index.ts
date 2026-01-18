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
 * @returns PageSkipDetails for the robots blocked skip
 */
export function createRobotsBlockedSkipDetails(url: string): PageSkipDetails {
  return {
    reason: SkipReason.ROBOTS_BLOCKED,
    description: `URL blocked by robots.txt`,
    stage: IngestionStage.DISCOVER,
    skippedAt: new Date().toISOString(),
    details: {},
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
