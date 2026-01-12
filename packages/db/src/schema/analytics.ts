import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { tenants, users } from "./tenants";
import { agents } from "./agents";

export const chatEvents = pgTable(
  "chat_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    channel: text("channel").notNull().$type<"admin_ui" | "widget" | "api" | "chat_endpoint">(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().$type<"ok" | "error" | "rate_limited">(),
    latencyMs: integer("latency_ms"),
    llmProvider: text("llm_provider"),
    model: text("model"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    retrievedChunks: integer("retrieved_chunks"),
    rerankerUsed: boolean("reranker_used").default(false),
    errorCode: text("error_code"),
  },
  (table) => [
    index("chat_events_tenant_started_idx").on(table.tenantId, table.startedAt),
    index("chat_events_agent_started_idx").on(table.agentId, table.startedAt),
    index("chat_events_status_idx").on(table.status),
  ]
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(), // First 8 chars for identification
    scopes: text("scopes").array().default(["chat", "read"]).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("api_keys_tenant_idx").on(table.tenantId),
    index("api_keys_key_hash_idx").on(table.keyHash),
    index("api_keys_key_prefix_idx").on(table.keyPrefix),
  ]
);

export const tenantQuotas = pgTable("tenant_quotas", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  maxKbs: integer("max_kbs").default(10).notNull(),
  maxAgents: integer("max_agents").default(10).notNull(),
  maxUploadedDocsPerMonth: integer("max_uploaded_docs_per_month").default(1000).notNull(),
  maxScrapedPagesPerMonth: integer("max_scraped_pages_per_month").default(1000).notNull(),
  maxCrawlConcurrency: integer("max_crawl_concurrency").default(5).notNull(),
  chatRateLimitPerMinute: integer("chat_rate_limit_per_minute").default(60).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenantUsage = pgTable(
  "tenant_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // Format: YYYY-MM
    uploadedDocs: integer("uploaded_docs").default(0).notNull(),
    scrapedPages: integer("scraped_pages").default(0).notNull(),
    chatRequests: integer("chat_requests").default(0).notNull(),
    promptTokens: integer("prompt_tokens").default(0).notNull(),
    completionTokens: integer("completion_tokens").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tenant_usage_tenant_month_idx").on(table.tenantId, table.month),
  ]
);

export const tenantAlertSettings = pgTable("tenant_alert_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(true).notNull(),
  notifyOwners: boolean("notify_owners").default(true).notNull(),
  notifyAdmins: boolean("notify_admins").default(false).notNull(),
  additionalEmails: text("additional_emails"), // Comma-separated list
  // Override thresholds (null = use system defaults)
  errorRateThreshold: integer("error_rate_threshold"),
  quotaWarningThreshold: integer("quota_warning_threshold"),
  inactivityDays: integer("inactivity_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const deletionJobs = pgTable(
  "deletion_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull().$type<"kb" | "source" | "agent" | "tenant">(),
    objectId: uuid("object_id").notNull(),
    scheduledHardDeleteAt: timestamp("scheduled_hard_delete_at", { withTimezone: true }).notNull(),
    status: text("status")
      .notNull()
      .$type<"pending" | "running" | "succeeded" | "failed">()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deletion_jobs_status_scheduled_idx").on(table.status, table.scheduledHardDeleteAt),
  ]
);
