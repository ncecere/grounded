import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants, users } from "./tenants";
import { agents } from "./agents";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Types of tools that can be configured
 */
export type ToolType = "api" | "mcp" | "builtin";

/**
 * HTTP methods for API tools
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Authentication types for API tools
 */
export type ApiAuthType = "none" | "api_key" | "bearer" | "basic" | "custom_header";

/**
 * Configuration for API tools
 */
export interface ApiToolConfig {
  /** Base URL for the API */
  baseUrl: string;
  /** HTTP method */
  method: HttpMethod;
  /** Endpoint path (can include {param} placeholders) */
  path: string;
  /** Authentication configuration */
  auth: {
    type: ApiAuthType;
    /** Header name for api_key or custom_header types */
    headerName?: string;
    /** The actual secret value (encrypted in DB) */
    secret?: string;
    /** For basic auth: username */
    username?: string;
  };
  /** Default headers to include */
  headers?: Record<string, string>;
  /** Request body template (for POST/PUT/PATCH) */
  bodyTemplate?: string;
  /** Expected response format */
  responseFormat?: "json" | "text";
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Configuration for MCP (Model Context Protocol) tools
 */
export interface McpToolConfig {
  /** Transport type */
  transport: "stdio" | "sse" | "websocket";
  /** For stdio: command to execute */
  command?: string;
  /** For stdio: arguments */
  args?: string[];
  /** For stdio: environment variables */
  env?: Record<string, string>;
  /** For sse/websocket: server URL */
  url?: string;
  /** Additional connection options */
  connectionOptions?: Record<string, unknown>;
}

/**
 * Built-in tool types
 */
export type BuiltinToolType = "multi_kb_router" | "calculator" | "date_time" | "web_search";

/**
 * Configuration for built-in tools
 */
export interface BuiltinToolConfig {
  toolType: BuiltinToolType;
  /** Tool-specific options */
  options?: Record<string, unknown>;
}

/**
 * Tool parameter schema (JSON Schema format)
 */
export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

// ============================================================================
// Agent Capabilities Table
// ============================================================================

/**
 * Agent capabilities - controls agentic features per agent
 */
export const agentCapabilities = pgTable(
  "agent_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    
    // Mode toggle: simple RAG vs agentic
    agenticModeEnabled: boolean("agentic_mode_enabled").default(false).notNull(),
    
    // Multi-KB routing: let agent choose which KB to query
    multiKbRoutingEnabled: boolean("multi_kb_routing_enabled").default(false).notNull(),
    
    // Allow agent to call external tools
    toolCallingEnabled: boolean("tool_calling_enabled").default(false).notNull(),
    
    // Maximum number of tool calls per turn
    maxToolCallsPerTurn: jsonb("max_tool_calls_per_turn").$type<number>().default(5).notNull(),
    
    // Allow agent to do multi-step reasoning
    multiStepReasoningEnabled: boolean("multi_step_reasoning_enabled").default(false).notNull(),
    
    // Maximum reasoning steps
    maxReasoningSteps: jsonb("max_reasoning_steps").$type<number>().default(3).notNull(),
    
    // Show chain of thought to users (transparency)
    showChainOfThought: boolean("show_chain_of_thought").default(true).notNull(),
    
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_capabilities_agent_unique").on(table.agentId),
  ]
);

// ============================================================================
// Tool Definitions Table
// ============================================================================

/**
 * Tool definitions - reusable tool configurations at tenant level
 */
export const toolDefinitions = pgTable(
  "tool_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    
    // Tool identification
    name: text("name").notNull(),
    description: text("description").notNull(),
    
    // Tool type
    type: text("type").$type<ToolType>().notNull(),
    
    // Type-specific configuration (encrypted secrets handled separately)
    config: jsonb("config").$type<ApiToolConfig | McpToolConfig | BuiltinToolConfig>().notNull(),
    
    // Tool parameters (JSON Schema format for LLM function calling)
    parameters: jsonb("parameters").$type<ToolParameter[]>().default([]).notNull(),
    
    // Status
    isEnabled: boolean("is_enabled").default(true).notNull(),
    
    // Metadata
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("tool_definitions_tenant_idx").on(table.tenantId),
    uniqueIndex("tool_definitions_name_unique")
      .on(table.tenantId, table.name)
      .where(sql`deleted_at IS NULL`),
  ]
);

// ============================================================================
// Agent Tools Table (Junction)
// ============================================================================

/**
 * Agent tools - links tools to agents
 */
export const agentTools = pgTable(
  "agent_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => toolDefinitions.id, { onDelete: "cascade" }),
    
    // Per-agent tool settings (override defaults)
    isEnabled: boolean("is_enabled").default(true).notNull(),
    
    // Priority for tool selection (lower = higher priority)
    priority: jsonb("priority").$type<number>().default(100).notNull(),
    
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("agent_tools_unique")
      .on(table.agentId, table.toolId)
      .where(sql`deleted_at IS NULL`),
    index("agent_tools_agent_idx").on(table.agentId),
    index("agent_tools_tool_idx").on(table.toolId),
  ]
);

// ============================================================================
// MCP Server Connections Table
// ============================================================================

/**
 * MCP server connections - persistent connections to MCP servers
 */
export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    
    // Connection identification
    name: text("name").notNull(),
    description: text("description"),
    
    // MCP configuration
    config: jsonb("config").$type<McpToolConfig>().notNull(),
    
    // Connection status
    status: text("status").$type<"connected" | "disconnected" | "error">().default("disconnected").notNull(),
    lastError: text("last_error"),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    
    // Available tools from this server (populated on connect)
    availableTools: jsonb("available_tools").$type<Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>>().default([]).notNull(),
    
    // Status
    isEnabled: boolean("is_enabled").default(true).notNull(),
    
    // Metadata
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("mcp_connections_tenant_idx").on(table.tenantId),
    uniqueIndex("mcp_connections_name_unique")
      .on(table.tenantId, table.name)
      .where(sql`deleted_at IS NULL`),
  ]
);

// ============================================================================
// Type Exports
// ============================================================================

export type AgentCapabilities = typeof agentCapabilities.$inferSelect;
export type NewAgentCapabilities = typeof agentCapabilities.$inferInsert;

export type ToolDefinition = typeof toolDefinitions.$inferSelect;
export type NewToolDefinition = typeof toolDefinitions.$inferInsert;

export type AgentTool = typeof agentTools.$inferSelect;
export type NewAgentTool = typeof agentTools.$inferInsert;

export type McpConnection = typeof mcpConnections.$inferSelect;
export type NewMcpConnection = typeof mcpConnections.$inferInsert;
