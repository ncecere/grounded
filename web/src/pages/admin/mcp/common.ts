/* Types and queries of Admin → Models → MCP servers (docs/mcp-client.md). */
import { useQuery } from "@tanstack/react-query";
import { api, type Schemas, unwrap } from "@/api/client";

export type MCPServer = Schemas["MCPServer"];
export type MCPTool = Schemas["MCPServerTool"];
export type MCPTestResult = Schemas["MCPServerTestResult"];
export type MCPToolUse = Schemas["MCPToolUse"];

export const serversKey = ["admin", "mcp-servers"] as const;
export const toolsKey = (serverId: string) => ["admin", "mcp-servers", serverId, "tools"] as const;

export function useMCPServers() {
  return useQuery({ queryKey: serversKey, queryFn: async () => unwrap(await api.GET("/v1/admin/mcp-servers")) });
}

export function useMCPTools(serverId: string | undefined) {
  return useQuery({
    queryKey: toolsKey(serverId ?? ""),
    queryFn: async () => unwrap(await api.GET("/v1/admin/mcp-servers/{serverId}/tools", { params: { path: { serverId: serverId! } } })),
    enabled: Boolean(serverId),
  });
}

/** Why a test failed, in words (the classes of MCPServerTestResult). */
export const testErrorLabels: Record<NonNullable<MCPTestResult["errorClass"]>, string> = {
  unavailable: "Couldn't reach the server",
  auth: "Credentials refused",
  not_found: "Not found: check the URL",
  rate_limited: "Rate limited",
  bad_request: "Request refused",
  bad_response: "Unexpected response",
  config: "Address not allowed or settings problem",
  timeout: "No answer in time",
  too_large: "Response too large",
  input_required: "The server asked for input",
};
