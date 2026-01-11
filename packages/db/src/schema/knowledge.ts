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
import { tenants, users } from "./tenants";
import { modelConfigurations } from "./ai-models";
import type { SourceConfig, SourceRunStats } from "@kcb/shared";

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
      .where("deleted_at IS NULL"),
    index("tenant_kb_subscriptions_kb_id_idx").on(table.kbId),
  ]
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
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
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: text("status")
      .notNull()
      .$type<"pending" | "running" | "partial" | "succeeded" | "failed" | "canceled">()
      .default("pending"),
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
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("source_runs_source_created_idx").on(table.sourceId, table.createdAt),
    index("source_runs_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("source_runs_status_idx").on(table.status),
  ]
);

export const sourceRunPages = pgTable(
  "source_run_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
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
      .$type<"succeeded" | "failed" | "skipped_unchanged">(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("source_run_pages_run_id_idx").on(table.sourceRunId),
    index("source_run_pages_tenant_url_idx").on(table.tenantId, table.normalizedUrl),
  ]
);
