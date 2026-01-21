import { z } from "zod";

export const toolParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  description: z.string(),
  required: z.boolean().optional(),
  enum: z.array(z.string()).optional(),
  default: z.unknown().optional(),
});

export const apiToolConfigSchema = z.object({
  baseUrl: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  auth: z.object({
    type: z.enum(["none", "api_key", "bearer", "basic", "custom_header"]),
    headerName: z.string().optional(),
    secret: z.string().optional(),
    username: z.string().optional(),
  }),
  headers: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().optional(),
  responseFormat: z.enum(["json", "text"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const mcpToolConfigSchema = z.object({
  transport: z.enum(["stdio", "sse", "websocket"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().url().optional(),
  connectionOptions: z.record(z.string(), z.unknown()).optional(),
});

export const builtinToolConfigSchema = z.object({
  toolType: z.enum(["multi_kb_router", "calculator", "date_time", "web_search"]),
  options: z.record(z.string(), z.unknown()).optional(),
});

export const createToolSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  type: z.enum(["api", "mcp", "builtin"]),
  config: z.union([apiToolConfigSchema, mcpToolConfigSchema, builtinToolConfigSchema]),
  parameters: z.array(toolParameterSchema).optional(),
  isEnabled: z.boolean().optional(),
});

export const updateToolSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  config: z.union([apiToolConfigSchema, mcpToolConfigSchema, builtinToolConfigSchema]).optional(),
  parameters: z.array(toolParameterSchema).optional(),
  isEnabled: z.boolean().optional(),
});

export const updateCapabilitiesSchema = z.object({
  agenticModeEnabled: z.boolean().optional(),
  multiKbRoutingEnabled: z.boolean().optional(),
  toolCallingEnabled: z.boolean().optional(),
  maxToolCallsPerTurn: z.number().int().min(1).max(20).optional(),
  multiStepReasoningEnabled: z.boolean().optional(),
  maxReasoningSteps: z.number().int().min(1).max(10).optional(),
  showChainOfThought: z.boolean().optional(),
});

export const attachToolSchema = z.object({
  toolId: z.string().uuid(),
  isEnabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(1000).optional(),
});
