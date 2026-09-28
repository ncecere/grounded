/* Test helpers for the Phase 3 pages: a fetch mock with status codes and SSE bodies, and renderers. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { routeTree } from "../router";

export type Call = { method: string; url: string; search: URLSearchParams; body?: unknown; rawBody?: string; headers: Headers; signal?: AbortSignal };

/** A reply: JSON data (wrapped in {data}), an error, or a raw Response (e.g. SSE). */
export class Reply {
  constructor(
    readonly status: number,
    readonly payload: unknown,
    readonly headers: Record<string, string> = {},
  ) {}
  static error(status: number, code: string, message = code, details?: Record<string, unknown>, headers: Record<string, string> = {}) {
    return new Reply(status, { error: { code, message, details } }, headers);
  }
}

export type Handler = (body: unknown, call: Call) => unknown;

/** Replaces fetch; routes are keyed "METHOD /path". Unmatched routes return 404. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(String(input), "http://localhost"), init);
    const url = new URL(req.url);
    const rawBody = req.method === "GET" ? "" : await req.clone().text();
    let body: unknown;
    try {
      body = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      body = undefined;
    }
    const call: Call = { method: req.method, url: url.pathname, search: url.searchParams, body, rawBody, headers: req.headers, signal: init?.signal ?? req.signal };
    calls.push(call);
    const handler = routes[`${req.method} ${url.pathname}`];
    const json = (status: number, payload: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...headers } });
    if (!handler) return json(404, { error: { code: "not_found", message: "Not found" } });
    const out = await handler(body, call);
    if (out instanceof Response) return out;
    if (out instanceof Reply) return json(out.status, out.payload, out.headers);
    return json(200, { data: out });
  });
  return calls;
}

/** An SSE body from [event, data] pairs; chunks are split at arbitrary points to exercise the parser. */
export function sse(events: [string, unknown][], opts: { splitEvery?: number; hold?: Promise<void> } = {}) {
  const text = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(": ping\n\n");
  const enc = new TextEncoder();
  const size = opts.splitEvery ?? 17;
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let i = 0; i < text.length; i += size) controller.enqueue(enc.encode(text.slice(i, i + size)));
        if (opts.hold) await opts.hold;
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

/** A stream that sends `events` and then stays open until aborted. */
export function openSSE(events: [string, unknown][], signal?: AbortSignal) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const [e, d] of events) controller.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`));
        signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

export const meFor = (role: "none" | "platform_admin" | "platform_auditor" = "none", teamRole = "owner") => ({
  user: { id: "u1", email: "una@example.edu", displayName: "Una User", platformRole: role, status: "active" },
  teams: [{ id: "t1", slug: "registrar", name: "Office of the Registrar", status: "active", maxClassification: "sensitive", role: teamRole }],
  csrfToken: "csrf-123",
  capabilities: { platformAdmin: role === "platform_admin", platformAuditor: role === "platform_auditor" },
});

export const team = {
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

/** Routes every signed-in page needs (shell, sidebar, breadcrumbs). */
export const shellRoutes = (role: Parameters<typeof meFor>[0] = "none", teamRole = "owner"): Record<string, Handler> => ({
  "GET /v1/me": () => meFor(role, teamRole),
  "GET /v1/auth/config": () => ({ oidcEnabled: false, devAuthEnabled: true, loginUrl: "/auth/login", teamRequestUrl: null, devAccounts: [] }),
  "GET /v1/teams/registrar": () => ({ team, role: teamRole }),
  "GET /v1/conversations": () => ({ items: [], nextCursor: null }),
  "GET /v1/classifications": () => [
    { key: "open", name: "Open", description: "", rank: 0, maxAudience: "public", revision: 1, createdAt: "", updatedAt: "" },
    { key: "sensitive", name: "Sensitive", description: "", rank: 1, maxAudience: "team", revision: 1, createdAt: "", updatedAt: "" },
    { key: "restricted", name: "Restricted", description: "", rank: 2, maxAudience: "team", revision: 1, createdAt: "", updatedAt: "" },
  ],
  "GET /v1/embedding-profiles": () => [],
  "GET /v1/maintenance": () => ({ enabled: false, reason: "", plannedEndAt: null, startedAt: null }),
  "GET /v1/me/break-glass": () => [],
  "GET /v1/teams/registrar/break-glass": () => [],
});

export function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, qc };
}

/** Renders a component inside a bare router and query client (me preloaded). */
export function renderBare(ui: ReactNode, me: unknown = meFor()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], me);
  const root = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return { ...render(<QueryClientProvider client={qc}><RouterProvider router={router as never} /></QueryClientProvider>), qc };
}
