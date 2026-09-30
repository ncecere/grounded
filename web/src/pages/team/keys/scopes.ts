/* API key kinds and scopes, and which scopes a team role may grant. */
import type { Schemas } from "@/api/client";
import type { TeamRole } from "@/components/roles";

export type Scope = Schemas["APIKeyScope"];
export type APIKey = Schemas["APIKey"];
export type Kind = APIKey["kind"];

export const allScopes: Scope[] = ["query", "ingest", "manage", "mcp"];
export const scopeLabels: Record<Scope, string> = {
  query: "Query: search knowledge bases",
  ingest: "Ingest: upload and manage documents",
  manage: "Manage: change sources and knowledge bases",
  mcp: "MCP: search and ask from AI tools",
};

/** The MCP scope's one line on the key form (docs/mcp.md): what it's for, or that the server is off. */
export function mcpScopeDescription(serverOn: boolean | undefined) {
  return serverOn
    ? "For AI tools that connect to this server over MCP. It grants nothing on the REST API."
    : "The MCP server is off until a platform admin turns it on. It grants nothing on the REST API.";
}

/** Mirrors the server: personal key scopes depend on role; service keys (admins/owners) get all. */
export function allowedScopes(role: TeamRole | undefined, kind: Kind): Scope[] {
  if (kind === "service") return role === "owner" || role === "admin" ? allScopes : [];
  switch (role) {
    case "owner":
    case "admin":
      return allScopes;
    case "editor":
      return ["query", "ingest", "mcp"];
    case "member":
      return ["query", "mcp"];
    default:
      return [];
  }
}
