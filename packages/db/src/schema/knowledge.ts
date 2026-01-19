import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants, users } from "./tenants";
import { modelConfigurations } from "./ai-models";
import type {
  SourceConfig,
  SourceRunStats,
  IngestionStage,
  StageStatus,
  SourceRunStage,
} from "@grounded/shared";

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isGlobal: boolean("is_global").default(false).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Embedding model tracking - set when KB is created
    embeddingModelId: uuid("embedding_model_id").references(() => modelConfigurations.id, { onDelete: "set null" }),
    embeddingDimensions: integer("embedding_dimensions").notNull().default(768),
    // Reindex tracking - for changing embedding models
    reindexStatus: text("reindex_status").$type<"pending" | "in_progress" | "failed">(),
    reindexProgress: integer("reindex_progress"),
    reindexError: text("reindex_error"),
    pendingEmbeddingModelId: uuid("pending_embedding_model_id").references(() => modelConfigurations.id, { onDelete: "set null" }),
    pendingEmbeddingDimensions: integer("pending_embedding_dimensions"),
    reindexStartedAt: timestamp("reindex_started_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("knowledge_bases_tenant_id_idx").on(table.tenantId),
    index("knowledge_bases_is_global_published_idx").on(table.isGlobal, table.publishedAt),
    index("knowledge_bases_created_at_idx").on(table.createdAt),
    index("knowledge_bases_embedding_model_idx").on(table.embeddingModelId),
    index("knowledge_bases_reindex_status_idx").on(table.reindexStatus),
  ]
);

export const tenantKbSubscriptions = pgTable(
  "tenant_kb_subscriptions",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kbId: uuid("kb_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("tenant_kb_subscriptions_unique")
      .on(table.tenantId, table.kbId)
      .where(sql`deleted_at IS NULL`),
    index("tenant_kb_subscriptions_kb_id_idx").on(table.kbId),
  ]
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" }), // Nullable for global KBs
    kbId: uuid("kb_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    type: text("type").notNull().$type<"web" | "upload">(),
    name: text("name").notNull(),
    config: jsonb("config").$type<SourceConfig>().notNull(),
    enrichmentEnabled: boolean("enrichment_enabled").default(false).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("sources_tenant_kb_idx").on(table.tenantId, table.kbId),
    index("sources_kb_id_idx").on(table.kbId),
    index("sources_created_at_idx").on(table.createdAt),
  ]
);

export const sourceRuns = pgTable(
  "source_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" }), // Nullable for global KBs
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: text("status")
      .notNull()
      .$type<"pending" | "running" | "partial" | "succeeded" | "failed" | "canceled">()
      .default("pending"),
    stage: text("stage").$type<SourceRunStage>(),
    trigger: text("trigger").notNull().$type<"manual" | "scheduled">(),
    forceReindex: boolean("force_reindex").default(false).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats").$type<SourceRunStats>().default({
      pagesSeen: 0,
      pagesIndexed: 0,
      pagesFailed: 0,
      tokensEstimated: 0,
    }).notNull(),
    // Stage progress tracking (current stage)
    stageTotal: integer("stage_total").default(0).notNull(),
    stageCompleted: integer("stage_completed").default(0).notNull(),
    stageFailed: integer("stage_failed").default(0).notNull(),
    // Legacy embedding progress tracking (used for embedding stage)
    chunksToEmbed: integer("chunks_to_embed").default(0).notNull(),
    chunksEmbedded: integer("chunks_embedded").default(0).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("source_runs_source_created_idx").on(table.sourceId, table.createdAt),
    index("source_runs_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("source_runs_status_idx").on(table.status),
    index("source_runs_stage_idx").on(table.stage),
  ]
);

export const sourceRunPages = pgTable(
  "source_run_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" }), // Nullable for global KBs
    sourceRunId: uuid("source_run_id")
      .notNull()
      .references(() => sourceRuns.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    title: text("title"),
    httpStatus: integer("http_status"),
    contentHash: text("content_hash"),
    status: text("status")
      .notNull()
      .$type<"succeeded" | "failed" | "skipped_unchanged" | "skipped_non_html">(),
    error: text("error"),
    // Per-stage tracking for V2 ingestion contract
    currentStage: text("current_stage").$type<IngestionStage>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("source_run_pages_run_id_idx").on(table.sourceRunId),
    index("source_run_pages_tenant_url_idx").on(table.tenantId, table.normalizedUrl),
    index("source_run_pages_current_stage_idx").on(table.currentStage),
  ]
);

/**
 * Tracks the status of each ingestion stage for a page.
 * Provides detailed audit trail and timing for pipeline debugging.
 * One row per page per stage (up to 6 rows per page).
 */
export const sourceRunPageStages = pgTable(
  "source_run_page_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceRunPageId: uuid("source_run_page_id")
      .notNull()
      .references(() => sourceRunPages.id, { onDelete: "cascade" }),
    /** The pipeline stage (discover, fetch, extract, chunk, embed, index) */
    stage: text("stage").notNull().$type<IngestionStage>(),
    /** Status of this stage */
    status: text("status")
      .notNull()
      .$type<StageStatus>()
      .default("pending"),
    /** When stage processing started */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** When stage processing finished */
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Error message if failed */
    error: text("error"),
    /** Number of retry attempts made */
    retryCount: integer("retry_count").default(0).notNull(),
    /** Stage-specific metadata (e.g., chunk count, embedding dimensions) */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("source_run_page_stages_page_id_idx").on(table.sourceRunPageId),
    uniqueIndex("source_run_page_stages_page_stage_unique").on(
      table.sourceRunPageId,
      table.stage
    ),
    index("source_run_page_stages_status_idx").on(table.status),
    index("source_run_page_stages_stage_status_idx").on(table.stage, table.status),
  ]
);

export const sourceRunPageContents = pgTable(
  "source_run_page_contents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceRunId: uuid("source_run_id")
      .notNull()
      .references(() => sourceRuns.id, { onDelete: "cascade" }),
    sourceRunPageId: uuid("source_run_page_id")
      .notNull()
      .references(() => sourceRunPages.id, { onDelete: "cascade" }),
    normalizedUrl: text("normalized_url").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    headings: jsonb("headings").$type<{ level: number; text: string; path: string; position: number }[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("source_run_page_contents_page_unique").on(table.sourceRunPageId),
    index("source_run_page_contents_run_id_idx").on(table.sourceRunId),
    index("source_run_page_contents_tenant_url_idx").on(table.tenantId, table.normalizedUrl),
  ]
);
