import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants, users } from "./tenants";
import { knowledgeBases } from "./knowledge";
import { modelConfigurations } from "./ai-models";
import type { WidgetTheme } from "@grounded/shared";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    welcomeMessage: text("welcome_message").default("How can I help?"),
    logoUrl: text("logo_url"),
    systemPrompt: text("system_prompt").notNull().default(`You are a helpful assistant that answers questions based on the provided context.

IMPORTANT RULES:
1. Only answer questions based on the provided context
2. If the context does not contain enough information to answer the question, say "I don't know based on the provided sources"
3. Always cite your sources with the document title and URL when available
4. Be concise and direct in your answers
5. Do not make up information that is not in the context`),
    rerankerEnabled: boolean("reranker_enabled").default(true).notNull(),
    citationsEnabled: boolean("citations_enabled").default(true).notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    // RAG mode: simple (standard retrieval) or advanced (multi-step reasoning with sub-queries)
    ragType: text("rag_type").$type<"simple" | "advanced">().default("simple").notNull(),
    llmModelConfigId: uuid("llm_model_config_id").references(() => modelConfigurations.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("agents_tenant_idx").on(table.tenantId),
    index("agents_created_at_idx").on(table.createdAt),
  ]
);

export const agentKbs = pgTable(
  "agent_kbs",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    kbId: uuid("kb_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("agent_kbs_unique").on(table.agentId, table.kbId).where(sql`deleted_at IS NULL`),
    index("agent_kbs_kb_idx").on(table.kbId),
  ]
);

export const agentWidgetConfigs = pgTable(
  "agent_widget_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    isPublic: boolean("is_public").default(true).notNull(),
    allowedDomains: text("allowed_domains").array().default([]).notNull(),
    oidcRequired: boolean("oidc_required").default(false).notNull(),
    theme: jsonb("theme").$type<WidgetTheme>().default({
      primaryColor: "#0066cc",
      backgroundColor: "#ffffff",
      textColor: "#1a1a1a",
      buttonPosition: "bottom-right",
      borderRadius: 12,
      buttonStyle: "circle",
      buttonSize: "medium",
      buttonText: "Chat with us",
      buttonIcon: "chat",
      buttonColor: "#2563eb",
      customIconUrl: null,
      customIconSize: null,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("agent_widget_configs_agent_unique").on(table.agentId)]
);

export const retrievalConfigs = pgTable(
  "retrieval_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    // How many sources the AI reads to form its answer
    topK: integer("top_k").default(8).notNull(),
    // How many sources are searched initially (broader search pool)
    candidateK: integer("candidate_k").default(40).notNull(),
    // How many source citations are shown to the user
    maxCitations: integer("max_citations").default(3).notNull(),
    rerankerEnabled: boolean("reranker_enabled").default(true).notNull(),
    rerankerType: text("reranker_type")
      .$type<"heuristic" | "cross_encoder">()
      .default("heuristic")
      .notNull(),
    // Minimum cosine similarity score (0-1) for chunks to be included in context
    similarityThreshold: real("similarity_threshold").default(0.5).notNull(),
    // Number of conversation history turns to include for query rewriting (advanced RAG)
    historyTurns: integer("history_turns").default(5).notNull(),
    // Maximum number of sub-queries to generate in advanced RAG mode
    advancedMaxSubqueries: integer("advanced_max_subqueries").default(3).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("retrieval_configs_agent_unique").on(table.agentId)]
);

export const widgetTokens = pgTable(
  "widget_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    name: text("name"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("widget_tokens_token_unique").on(table.token),
    index("widget_tokens_tenant_idx").on(table.tenantId),
    index("widget_tokens_agent_idx").on(table.agentId),
  ]
);

export const chatEndpointTokens = pgTable(
  "chat_endpoint_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    name: text("name"),
    // "api" for JSON API endpoint, "hosted" for hosted chat UI
    endpointType: text("endpoint_type").$type<"api" | "hosted">().default("api").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("chat_endpoint_tokens_token_unique").on(table.token),
    index("chat_endpoint_tokens_tenant_idx").on(table.tenantId),
    index("chat_endpoint_tokens_agent_idx").on(table.agentId),
  ]
);
