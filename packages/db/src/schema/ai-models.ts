import { pgTable, uuid, text, timestamp, boolean, integer, decimal, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./tenants";

export type ProviderType = "openai" | "anthropic" | "google" | "openai-compatible";
export type ModelType = "chat" | "embedding";

export const modelProviders = pgTable(
  "model_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    displayName: text("display_name").notNull(),
    type: text("type").notNull().$type<ProviderType>(),
    baseUrl: text("base_url"),
    apiKey: text("api_key").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    index("model_providers_is_enabled_idx").on(table.isEnabled),
    index("model_providers_type_idx").on(table.type),
  ]
);

export const modelConfigurations = pgTable(
  "model_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => modelProviders.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    modelType: text("model_type").notNull().$type<ModelType>(),
    maxTokens: integer("max_tokens").default(4096),
    temperature: decimal("temperature", { precision: 3, scale: 2 }).default("0.1"),
    supportsStreaming: boolean("supports_streaming").default(true),
    supportsTools: boolean("supports_tools").default(false),
    dimensions: integer("dimensions"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("model_configurations_provider_model_type_unique").on(
      table.providerId,
      table.modelId,
      table.modelType
    ),
    index("model_configurations_model_type_idx").on(table.modelType),
    index("model_configurations_is_default_idx").on(table.isDefault),
    index("model_configurations_provider_id_idx").on(table.providerId),
    index("model_configurations_is_enabled_idx").on(table.isEnabled),
  ]
);

// Relations
export const modelProvidersRelations = relations(modelProviders, ({ many, one }) => ({
  models: many(modelConfigurations),
  createdByUser: one(users, {
    fields: [modelProviders.createdBy],
    references: [users.id],
  }),
}));

export const modelConfigurationsRelations = relations(modelConfigurations, ({ one }) => ({
  provider: one(modelProviders, {
    fields: [modelConfigurations.providerId],
    references: [modelProviders.id],
  }),
  createdByUser: one(users, {
    fields: [modelConfigurations.createdBy],
    references: [users.id],
  }),
}));
