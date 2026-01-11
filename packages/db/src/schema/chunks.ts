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

// Custom type for pgvector
// Dimensions should match your embedding model:
// - nomic-embed-text: 768
// - text-embedding-3-small: 1536
// - text-embedding-3-large: 3072
const EMBEDDING_DIMENSIONS = 768;

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map((v) => parseFloat(v));
  },
});

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
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
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
      .where("deleted_at IS NULL"),
    // GIN index for full-text search will be created in migration
  ]
);

export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kbId: uuid("kb_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => kbChunks.id, { onDelete: "cascade" }),
    embedding: vector("embedding").notNull(),
    modelId: uuid("model_id"), // Track which model generated this embedding
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("embeddings_tenant_kb_idx").on(table.tenantId, table.kbId),
    index("embeddings_chunk_idx").on(table.chunkId),
    // HNSW index for vector similarity will be created in migration
  ]
);

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
