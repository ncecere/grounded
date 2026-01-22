export type ToolType = "api" | "mcp" | "builtin";

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ApiToolConfig {
  baseUrl: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: {
    type: "none" | "api_key" | "bearer" | "basic" | "custom_header";
    headerName?: string;
    secret?: string;
    username?: string;
  };
  headers?: Record<string, string>;
  bodyTemplate?: string;
  responseFormat?: "json" | "text";
  timeoutMs?: number;
}

export interface McpToolConfig {
  transport: "stdio" | "sse" | "websocket";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  connectionOptions?: Record<string, unknown>;
}

export interface BuiltinToolConfig {
  toolType: "multi_kb_router" | "calculator" | "date_time" | "web_search";
  options?: Record<string, unknown>;
}

export type ToolConfig = ApiToolConfig | McpToolConfig | BuiltinToolConfig;

export interface ToolDefinition {
  id: string;
  tenantId: string | null;
  name: string;
  description: string;
  type: ToolType;
  config: ToolConfig;
  parameters: ToolParameter[];
  isEnabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTool {
  id: string;
  toolId: string;
  isEnabled: boolean;
  priority: number;
  createdAt: string;
  tool: {
    id: string;
    name: string;
    description: string;
    type: ToolType;
    isEnabled: boolean;
  };
}

export interface BuiltinToolInfo {
  id: string;
  name: string;
  description: string;
  type: "builtin";
  configSchema: BuiltinToolConfig;
  requiresConfig?: boolean;
}
