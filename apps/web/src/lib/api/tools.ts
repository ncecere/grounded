import { request } from "./client";
import type { ToolDefinition, ToolType, ToolConfig, ToolParameter, AgentTool, BuiltinToolInfo } from "./types";

export const toolsApi = {
  listTools: () =>
    request<{ tools: ToolDefinition[] }>("/tools"),

  getTool: (id: string) =>
    request<{ tool: ToolDefinition }>(`/tools/${id}`),

  createTool: (data: {
    name: string;
    description: string;
    type: ToolType;
    config: ToolConfig;
    parameters?: ToolParameter[];
    isEnabled?: boolean;
  }) =>
    request<{ tool: ToolDefinition }>("/tools", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTool: (id: string, data: {
    name?: string;
    description?: string;
    config?: ToolConfig;
    parameters?: ToolParameter[];
    isEnabled?: boolean;
  }) =>
    request<{ tool: ToolDefinition }>(`/tools/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteTool: (id: string) =>
    request<{ message: string }>(`/tools/${id}`, { method: "DELETE" }),

  listBuiltinTools: () =>
    request<{ tools: BuiltinToolInfo[] }>("/tools/builtin"),

  // Agent Tools
  listAgentTools: (agentId: string) =>
    request<{ tools: AgentTool[] }>(`/tools/agents/${agentId}/tools`),

  attachToolToAgent: (agentId: string, data: {
    toolId: string;
    isEnabled?: boolean;
    priority?: number;
  }) =>
    request<{ agentTool: AgentTool }>(`/tools/agents/${agentId}/tools`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  detachToolFromAgent: (agentId: string, toolId: string) =>
    request<{ message: string }>(`/tools/agents/${agentId}/tools/${toolId}`, { method: "DELETE" }),
};
