import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { knowledgeBases, sources, sourceRuns } from "./knowledge";

// Custom type for tsvector
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" }), // Nullable for global KBs
    kbId: uuid("kb_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    sourceRunId: uuid("source_run_id").references(() => sourceRuns.id, {
      onDelete: "set null",
    }),
    normalizedUrl: text("normalized_url"),
    title: text("title"),
    heading: text("heading"),
    sectionPath: text("section_path"),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    language: text("language"),
    tags: text("tags").array(),
    entities: text("entities").array(),
    keywords: text("keywords").array(),
    summary: text("summary"),
    tsv: tsvector("tsv"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("kb_chunks_tenant_kb_idx").on(table.tenantId, table.kbId),
    index("kb_chunks_source_idx").on(table.sourceId),
    index("kb_chunks_source_run_idx").on(table.sourceRunId),
    uniqueIndex("kb_chunks_unique")
      .on(table.tenantId, table.sourceId, table.normalizedUrl, table.chunkIndex, table.contentHash)
      .where(sql`deleted_at IS NULL`),
    // GIN index for full-text search will be created in migration
  ]
);

// NOTE: Embeddings/vectors are now stored in a separate vector database.
// See @kcb/vector-store package for vector storage and retrieval.

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kbId: uuid("kb_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    sourceRunId: uuid("source_run_id")
      .references(() => sourceRuns.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    extractedText: text("extracted_text"),
    status: text("status")
      .notNull()
      .$type<"pending" | "processing" | "succeeded" | "failed">()
      .default("pending"),
    error: text("error"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("uploads_tenant_kb_idx").on(table.tenantId, table.kbId),
    index("uploads_source_idx").on(table.sourceId),
    index("uploads_created_at_idx").on(table.createdAt),
  ]
);
