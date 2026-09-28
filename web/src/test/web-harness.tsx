/* Fixtures and render helpers for the Phase 2 web source tests (web-sources.test.tsx, web-admin.test.tsx). */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Schemas } from "../api/client";
import type { TeamRole } from "../components/roles";
import { TeamContext, teamCtx, type Team } from "../pages/team/common";
import { Toaster } from "@/components/ui/toast/toast";

/* ---------- fixtures ---------- */

export const team: Team = {
  id: "t1",
  slug: "registrar",
  name: "Office of the Registrar",
  description: "",
  maxClassification: "sensitive",
  status: "active",
  revision: 1,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
};

const me = (platformRole: "none" | "platform_admin" | "platform_auditor" = "none") => ({
  user: { id: "u1", email: "u1@example.edu", displayName: "Una User", platformRole, status: "active" },
  teams: [],
  csrfToken: "csrf-123",
  capabilities: { platformAdmin: platformRole === "platform_admin", platformAuditor: platformRole === "platform_auditor" },
});

const level = (key: string, name: string, rank: number) => ({
  key,
  name,
  description: "",
  rank,
  maxAudience: "team",
  revision: 1,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
});

const levels = [level("open", "Open", 0), level("sensitive", "Sensitive", 1), level("restricted", "Restricted", 2)];

const profile = (id: string, name: string, isDefault: boolean) => ({
  id,
  key: id,
  name,
  description: "",
  dimensions: 768,
  chunkSize: 512,
  maxClassification: "restricted",
  isDefault,
});

const profiles = [profile("p1", "Nomic", true), profile("p2", "Other model", false)];

export const counts = { total: 40, pending: 0, processing: 0, ready: 38, failed: 1, skipped: 1, bytes: 204800, chunks: 400 };

export const crawl = (extra: Partial<Schemas["Crawl"]> = {}): Schemas["Crawl"] => ({
  id: "c1",
  sourceId: "s1",
  status: "running",
  trigger: "manual",
  pagesDiscovered: 90,
  pagesFetched: 50,
  pagesChanged: 12,
  pagesUnchanged: 35,
  pagesSkipped: 2,
  pagesFailed: 1,
  documentsDeleted: 0,
  truncated: false,
  truncatedReason: null,
  waitingReason: null,
  waitingUntil: null,
  error: "",
  createdAt: "2026-09-25T10:00:00Z",
  startedAt: "2026-09-25T10:00:05Z",
  finishedAt: null,
  ...extra,
});

/** A source's boilerplate summary: on (web default), nothing found yet. */
export const boilerplate = (extra: Partial<Schemas["SourceBoilerplate"]> = {}): Schemas["SourceBoilerplate"] => ({
  enabled: true,
  minDocs: 5,
  ratio: 0.2,
  overrides: {},
  repeatedBlocks: 0,
  pagesAffected: 0,
  documentsCounted: 0,
  threshold: 0,
  refreshedAt: null,
  pending: false,
  ...extra,
});

export const webSource = (extra: Partial<Schemas["DataSource"]> = {}): Schemas["DataSource"] => ({
  id: "s1",
  name: "Registrar website",
  description: "",
  type: "web",
  classification: "open",
  embeddingProfileId: "p1",
  status: "active",
  documents: counts,
  revision: 5,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
  web: {
    mode: "crawl",
    urls: ["https://registrar.example.edu/"],
    maxDepth: 2,
    maxPages: 200,
    includePrefixes: [],
    exclude: [],
    allowSubdomains: false,
    useSitemaps: true,
    schedule: "weekly",
    tags: [],
  },
  lastSyncAt: "2026-09-24T10:00:00Z",
  nextSyncAt: "2026-10-01T10:00:00Z",
  activeCrawl: null,
  boilerplate: boilerplate(),
  ...extra,
});

const page = (id: string, title: string, url: string): Schemas["Document"] => ({
  id,
  sourceId: "s1",
  title,
  filename: url,
  url,
  kind: "html",
  sizeBytes: 4096,
  version: 1,
  status: "ready",
  errorCode: "",
  errorMessage: "",
  errorDetail: "",
  pages: 0,
  chunkCount: 4,
  tokenCount: 900,
  warnings: [],
  tags: [],
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
});

/* ---------- harness ---------- */

export class ApiFailure {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly details?: unknown,
  ) {}
}

type Handler = (body: unknown, url: URL) => unknown;

/** Replaces fetch with canned {"data": ...} responses keyed by "METHOD path". */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; search: string; body?: unknown; headers: Headers }[] = [];
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init);
    const url = new URL(req.url);
    const text = await req.text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, url: url.pathname, search: url.search, body, headers: req.headers });
    const handler = routes[`${req.method} ${url.pathname}`];
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    if (!handler) return json(404, { error: { code: "not_found", message: "Not found" } });
    const out = handler(body, url);
    if (out instanceof ApiFailure) return json(out.status, { error: { code: out.code, message: out.message, details: out.details } });
    return json(200, { data: out });
  });
  return calls;
}

export function renderWith(ui: ReactNode, { role, platformRole = "none" }: { role?: TeamRole; platformRole?: "none" | "platform_admin" | "platform_auditor" } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], me(platformRole));
  const root = createRootRoute({
    component: () =>
      role ? (
        <TeamContext.Provider value={teamCtx(team, role)}>
          {ui}
          <Toaster />
        </TeamContext.Provider>
      ) : (
        <>
          {ui}
          <Toaster />
        </>
      ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

export const common = {
  "GET /v1/classifications": () => levels,
  "GET /v1/embedding-profiles": () => profiles,
};

/* ---------- web source detail ---------- */

export function webRoutes(source: Schemas["DataSource"]) {
  return {
    ...common,
    "GET /v1/teams/registrar/sources/s1": () => source,
    "GET /v1/teams/registrar/sources/s1/documents": () => ({
      items: [page("d1", "Academic calendar", "https://registrar.example.edu/calendar/")],
      nextCursor: null,
    }),
    "GET /v1/teams/registrar/sources/s1/crawls": () => [
      ...(source.activeCrawl ? [source.activeCrawl] : []),
      crawl({ id: "c0", status: "completed", trigger: "schedule", truncated: true, pagesFetched: 200, finishedAt: "2026-09-24T10:03:05Z", startedAt: "2026-09-24T10:00:00Z" }),
    ],
  };
}

/* ---------- admin: crawling ---------- */

export const request = (id: string, status: Schemas["DomainRequestStatus"], extra: Partial<Schemas["DomainRequest"]> = {}): Schemas["DomainRequest"] => ({
  id,
  teamId: "t2",
  teamSlug: "advising",
  teamName: "Academic Advising",
  pattern: "*.example.org",
  reason: "Partner college publishes our transfer guides.",
  status,
  requestedBy: "u9",
  reviewedBy: null,
  requester: { id: "u9", email: "blair@example.edu", displayName: "Blair Dev" },
  reviewer: null,
  reviewNote: "",
  reviewedAt: null,
  createdAt: "2026-09-20T10:00:00Z",
  ...extra,
});
