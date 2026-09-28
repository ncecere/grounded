/* Fixtures shared by the admin page tests. */
import type { Schemas } from "../api/client";

export const adminAgent = (status: Schemas["AgentStatus"] = "active", extra: Partial<Schemas["AdminAgent"]> = {}): Schemas["AdminAgent"] => ({
  id: "ag1",
  teamId: "t1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  status,
  disabledReason: status === "active" ? "" : "Under review",
  disabledAt: null,
  publishedVersion: 1,
  publishedAt: "2026-09-26T10:00:00Z",
  classification: "sensitive",
  chatModelName: "GPT-OSS 120B (Campus gateway)",
  audience: "team",
  shortName: null,
  createdAt: "2026-09-26T09:00:00Z",
  updatedAt: "2026-09-26T10:00:00Z",
  ...extra,
});
