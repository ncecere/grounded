import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  inet,
  boolean,
} from "drizzle-orm/pg-core";
import { users, tenants } from "./tenants";

/**
 * Audit log entry types
 */
export type AuditAction =
  // Auth events
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "auth.password_changed"
  // Tenant events
  | "tenant.created"
  | "tenant.updated"
  | "tenant.deleted"
  // User events
  | "user.created"
  | "user.updated"
  | "user.disabled"
  | "user.enabled"
  | "user.role_changed"
  // Agent events
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  | "agent.enabled"
  | "agent.disabled"
  // Knowledge base events
  | "kb.created"
  | "kb.updated"
  | "kb.deleted"
  | "kb.published"
  | "kb.unpublished"
  // Source events
  | "source.created"
  | "source.updated"
  | "source.deleted"
  | "source.run_triggered"
  // API key/token events
  | "api_key.created"
  | "api_key.revoked"
  | "widget_token.created"
  | "widget_token.revoked"
  | "chat_endpoint.created"
  | "chat_endpoint.revoked"
  // Settings events
  | "settings.updated"
  // Model configuration events
  | "model.created"
  | "model.updated"
  | "model.deleted"
  | "provider.created"
  | "provider.updated"
  | "provider.deleted";

/**
 * Resource types that can be audited
 */
export type AuditResourceType =
  | "user"
  | "tenant"
  | "agent"
  | "knowledge_base"
  | "source"
  | "api_key"
  | "widget_token"
  | "chat_endpoint"
  | "settings"
  | "model"
  | "provider"
  | "membership";

/**
 * Audit log metadata structure
 */
export interface AuditMetadata {
  // What changed (for updates)
  changes?: Record<string, { from: unknown; to: unknown }>;
  // Additional context
  resourceName?: string;
  reason?: string;
  // Request info
  userAgent?: string;
  // Any other relevant data
  [key: string]: unknown;
}

/**
 * Audit logs table - stores all auditable events
 * 
 * Design decisions:
 * - tenantId is nullable for system-level events (e.g., system admin actions)
 * - actorId is nullable for system/automated events
 * - resourceId is nullable for events that don't target a specific resource
 * - Uses jsonb for flexible metadata storage
 * - Indexed for common query patterns (by tenant, actor, action, time)
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    
    // When did this happen
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
    
    // Who did it (null for system/automated actions)
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    
    // Which tenant context (null for system-level actions)
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    
    // What action was performed
    action: text("action").$type<AuditAction>().notNull(),
    
    // What type of resource was affected
    resourceType: text("resource_type").$type<AuditResourceType>().notNull(),
    
    // Which specific resource (UUID of the affected entity)
    resourceId: uuid("resource_id"),
    
    // Additional details about the action
    metadata: jsonb("metadata").$type<AuditMetadata>().default({}).notNull(),
    
    // Request context
    ipAddress: inet("ip_address"),
    
    // Outcome
    success: boolean("success").default(true).notNull(),
    errorMessage: text("error_message"),
  },
  (table) => [
    // Query by tenant (most common)
    index("audit_logs_tenant_idx").on(table.tenantId),
    // Query by actor
    index("audit_logs_actor_idx").on(table.actorId),
    // Query by action type
    index("audit_logs_action_idx").on(table.action),
    // Query by resource
    index("audit_logs_resource_idx").on(table.resourceType, table.resourceId),
    // Query by time (for pagination and date ranges)
    index("audit_logs_timestamp_idx").on(table.timestamp),
    // Compound index for common queries: tenant + time
    index("audit_logs_tenant_time_idx").on(table.tenantId, table.timestamp),
  ]
);

// Type exports for use in application code
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
