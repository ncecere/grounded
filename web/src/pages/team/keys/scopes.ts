/* API key kinds and scopes, and which scopes a team role may grant. */
import type { Schemas } from "@/api/client";
import type { TeamRole } from "@/components/roles";

export type Scope = Schemas["APIKeyScope"];
export type APIKey = Schemas["APIKey"];
export type Kind = APIKey["kind"];

export const allScopes: Scope[] = ["query", "ingest", "manage"];
export const scopeLabels: Record<Scope, string> = {
  query: "Query: search knowledge bases",
  ingest: "Ingest: upload and manage documents",
  manage: "Manage: change sources and knowledge bases",
};

/** Mirrors the server: personal key scopes depend on role; service keys (admins/owners) get all. */
export function allowedScopes(role: TeamRole | undefined, kind: Kind): Scope[] {
  if (kind === "service") return role === "owner" || role === "admin" ? allScopes : [];
  switch (role) {
    case "owner":
    case "admin":
      return allScopes;
    case "editor":
      return ["query", "ingest"];
    case "member":
      return ["query"];
    default:
      return [];
  }
}
