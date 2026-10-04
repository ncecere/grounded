/*
 * GET /v1/admin/features (AD-03) built from the single-setting routes a test already mocks, so a test that overrides
 * one setting (an auditor's cost mode, MCP with OAuth on) sees it on the Overview too. Missing routes get defaults.
 */
import type { Schemas } from "../api/client";
import type { Handler } from "./harness";

type Call = Parameters<Handler>[1];

const defaults: Record<string, () => unknown> = {
  "GET /v1/admin/settings/evaluations": () => ({ enabled: false, revision: 1, updatedAt: null }),
  "GET /v1/admin/settings/mcp": () => ({ enabled: false, revision: 1, updatedAt: null }),
  "GET /v1/admin/costs/settings": () => ({ mode: "off", currency: "USD", timeZone: "UTC", warnPercent: 80, defaultBudget: null, revision: 1, updatedAt: "" }),
  "GET /v1/admin/costs/budgets": () => ({ items: [] }),
  "GET /v1/admin/parsing": () => ({ ocrEnabled: false, backend: "tesseract" }),
  "GET /v1/admin/group-mapping": () => ({ ruleCount: 0 }),
  "GET /v1/admin/systemone": () => ({ modelId: null, agents: { judging: 0, citations: 0, scope: 0, any: 0 }, revision: 1 }),
  "GET /v1/admin/rerank": () => ({ modelId: null, candidates: 40, timeLimitMs: 2000, agents: 0, agentsOff: [], revision: 1 }),
  "GET /v1/admin/settings/public-access": () => ({ publicAgentsEnabled: false, revision: 1, captcha: { provider: "none" }, anonSessionTtlSeconds: 86400 }),
  "GET /v1/admin/moderation/policies/public": () => ({ audience: "public", modelId: null }),
  "GET /v1/admin/settings/maintenance": () => ({ enabled: false, reason: "", revision: 1 }),
  "GET /v1/admin/connections": () => [],
  "GET /v1/admin/models": () => [],
  "GET /v1/admin/embedding-profiles": () => [],
  "GET /v1/admin/teams": () => ({ items: [] }),
};

type Any = Record<string, never> & Record<string, unknown>;

export function featuresFrom(routes: Record<string, Handler>, call: Call): Schemas["AdminFeatures"] {
  const get = <T = Any>(key: string): T => ((routes[key] ?? defaults[key])?.(undefined, call) ?? defaults[key]!()) as T;
  const platformMode = get<{ mode: Schemas["CostMode"] }>("GET /v1/admin/costs/settings").mode;
  const budgets = get<{ items: { teamName: string; status: { mode: Schemas["CostMode"] } }[] }>("GET /v1/admin/costs/budgets").items;
  const parsing = get<{ ocrEnabled: boolean; backend: Schemas["OcrBackend"] }>("GET /v1/admin/parsing");
  const models = get<Schemas["Model"][]>("GET /v1/admin/models");
  const profiles = get<{ status: string; isDefault: boolean }[]>("GET /v1/admin/embedding-profiles");
  const rerank = get<Schemas["RerankSettings"]>("GET /v1/admin/rerank");
  const rerankModel = models.find((m) => m.id === rerank.modelId);
  return {
    evaluations: get("GET /v1/admin/settings/evaluations"),
    mcp: get("GET /v1/admin/settings/mcp"),
    costs: {
      settings: get("GET /v1/admin/costs/settings"),
      teams: budgets.filter((b) => b.status.mode !== platformMode).map((b) => ({ teamName: b.teamName, mode: b.status.mode })),
    },
    ocr: { enabled: parsing.ocrEnabled, backend: parsing.backend },
    groupMappingRules: get<{ ruleCount: number }>("GET /v1/admin/group-mapping").ruleCount,
    systemOne: get("GET /v1/admin/systemone"),
    rerank,
    rerankModel: rerankModel && { displayName: rerankModel.displayName, enabled: rerankModel.enabled },
    publicAccess: get("GET /v1/admin/settings/public-access"),
    publicModeration: Boolean(get<{ modelId: string | null }>("GET /v1/admin/moderation/policies/public").modelId),
    maintenance: get("GET /v1/admin/settings/maintenance"),
    setup: {
      connections: get<unknown[]>("GET /v1/admin/connections").length,
      chatModelClassifications: models.filter((m) => m.kind === "chat" && m.enabled).map((m) => m.maxClassification),
      defaultProfile: profiles.some((p) => p.isDefault && p.status === "active"),
      teams: get<{ items: unknown[] }>("GET /v1/admin/teams").items.length,
    },
  };
}

/** Adds GET /v1/admin/features to a test's routes, unless it mocks it itself. */
export function withFeatures(routes: Record<string, Handler>): Record<string, Handler> {
  return { "GET /v1/admin/features": (_body, call) => featuresFrom(routes, call), ...routes };
}
