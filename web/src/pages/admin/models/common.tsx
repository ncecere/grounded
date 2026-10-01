/* Types, queries and small pieces shared by the connections, models and embedding profiles pages. */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "@/api/client";
import { StatusBadge } from "@/components/ui/badge/badge";
import m from "./models.module.css";

export type Connection = Schemas["Connection"];
export type Model = Schemas["Model"];
export type ModelKind = Schemas["ModelKind"];
export type Profile = Schemas["EmbeddingProfile"];

export const kindLabels: Record<ModelKind, string> = {
  chat: "Chat",
  embedding: "Embedding",
  rerank: "Rerank",
  moderation: "Moderation",
  systemone: "SystemOne",
  vision: "Vision (OCR)",
};

export function useConnections() {
  return useQuery({ queryKey: ["admin", "connections"], queryFn: async () => unwrap(await api.GET("/v1/admin/connections")) });
}

export function useModels() {
  return useQuery({ queryKey: ["admin", "models"], queryFn: async () => unwrap(await api.GET("/v1/admin/models")) });
}

/** Tests a connection (POST …/test): the upstream model IDs it advertises, also used for model suggestions (none for a SystemOne service). */
export function connectionTestQuery(connectionId: string) {
  return {
    queryKey: ["admin", "connection-test", connectionId],
    queryFn: async () => unwrap(await api.POST("/v1/admin/connections/{connectionId}/test", { params: { path: { connectionId } } })),
    retry: false,
  } as const;
}

function proxyErrorHint(error: Schemas["ProxyError"]) {
  const hints: Record<string, string> = {
    auth: "The proxy rejected the API key.",
    not_found: "Not found. Check the base URL includes the version (for example /v1) and the model ID is right.",
    unavailable: "The proxy could not be reached or returned a server error.",
    rate_limited: "The proxy is rate limiting requests.",
  };
  return hints[error.kind] ?? "The proxy returned an error.";
}

export function ProxyErrorText({ error }: { error?: Schemas["ProxyError"] }) {
  if (!error) return null;
  return (
    <>
      {proxyErrorHint(error)}{" "}
      <span className={m.detail}>
        ({error.status ? `HTTP ${error.status}: ` : ""}
        {error.message})
      </span>
    </>
  );
}

const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()} ms`;

/** Where a test's request spent its time (E12): name resolution, connecting, TLS, then the proxy and model. */
export function TimingsText({ timings }: { timings?: Schemas["RequestTimings"] }) {
  if (!timings) return null;
  const parts = [
    timings.reused ? "reused connection" : "",
    timings.dnsMs > 0 ? `DNS ${ms(timings.dnsMs)}` : "",
    timings.connectMs > 0 ? `connect ${ms(timings.connectMs)}` : "",
    timings.tlsMs > 0 ? `TLS ${ms(timings.tlsMs)}` : "",
    timings.firstByteMs > 0 ? `first byte ${ms(timings.firstByteMs)}` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <span className={m.timings}>
      {parts.join(" · ")}
      {timings.dnsMs >= 1000 && ". Name resolution is slow: see “Slow DNS” in the Kubernetes deployment guide."}
    </span>
  );
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? <StatusBadge tone="success">Enabled</StatusBadge> : <StatusBadge tone="neutral">Disabled</StatusBadge>;
}

export type ModelUsage = Schemas["ModelUsage"];
export type ProfileUsage = Schemas["ProfileUsage"];

/** What uses each model and profile (A5). */
export function useCatalogUsage() {
  return useQuery({ queryKey: ["admin", "catalog-usage"], queryFn: async () => unwrap(await api.GET("/v1/admin/catalog-usage")), staleTime: 30_000 });
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 published agents · 1 profile · Public moderation" ("" when unused). */
export function modelUsedBy(u?: ModelUsage): string[] {
  if (!u) return [];
  const aud = { team: "Team", all_authenticated: "Signed-in users", public: "Public" } as const;
  return [
    u.publishedAgents ? count(u.publishedAgents, "published agent", "published agents") : "",
    u.draftAgents ? count(u.draftAgents, "agent draft", "agent drafts") : "",
    u.profiles ? count(u.profiles, "embedding profile", "embedding profiles") : "",
    ...u.moderationAudiences.map((a) => `${aud[a]} moderation`),
    u.systemOne ? "SystemOne" : "",
    u.rerank ? "Reranking" : "",
  ].filter(Boolean);
}

export function profileUsedBy(u?: ProfileUsage): string[] {
  if (!u) return [];
  return [u.sources ? count(u.sources, "data source", "data sources") : "", u.knowledgeBases ? count(u.knowledgeBases, "knowledge base", "knowledge bases") : ""].filter(Boolean);
}
