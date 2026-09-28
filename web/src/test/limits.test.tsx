/* Team limits: the admin Limits page, a team's overrides, the team usage card and limit errors. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { axe } from "vitest-axe";
import { ApiError, limitError, type Schemas } from "../api/client";
import { ApiErrorAlert } from "../components/errors";
import { fromInput, formatLimit, toInput } from "../lib/limits";
import { LimitsPage } from "../pages/admin/limits/platform";
import { AdminTeamLimitsCard } from "../pages/admin/limits/team-card";
import { TeamContext, teamCtx, type Team } from "../pages/team/common";
import { DomainRequestsPage } from "../pages/team/domains";
import { UsageCard } from "../pages/team/usage";
import { Toaster } from "@/components/ui/toast/toast";

const GiB = 1024 ** 3;

const team: Team = {
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

const me = (platformRole: "none" | "platform_admin" | "platform_auditor") => ({
  user: { id: "u1", email: "u1@example.edu", displayName: "Una User", platformRole, status: "active" },
  teams: [],
  csrfToken: "csrf-123",
  capabilities: { platformAdmin: platformRole === "platform_admin", platformAuditor: platformRole === "platform_auditor" },
});

type Def = Pick<Schemas["PlatformLimit"], "key" | "group" | "unit" | "period" | "label" | "description">;
const defs: Def[] = [
  { key: "storage_bytes", group: "resources", unit: "bytes", period: "none", label: "Storage", description: "Original documents." },
  { key: "data_sources", group: "resources", unit: "count", period: "none", label: "Data sources", description: "Sources." },
  { key: "knowledge_bases", group: "resources", unit: "count", period: "none", label: "Knowledge bases", description: "KBs." },
  { key: "crawl_pages_per_day", group: "ingestion", unit: "count", period: "day", label: "Crawled pages per day", description: "Pages." },
  { key: "concurrent_crawls", group: "ingestion", unit: "count", period: "none", label: "Concurrent crawls", description: "Crawls." },
  { key: "queries_per_minute", group: "queries", unit: "count", period: "minute", label: "Queries per minute (team)", description: "Rate." },
  { key: "user_queries_per_minute", group: "queries", unit: "count", period: "minute", label: "Queries per minute (each person)", description: "Rate." },
];

const platform = (): Schemas["PlatformLimits"] => ({
  revision: 1,
  updatedAt: "2026-09-25T10:00:00Z",
  items: defs.map((d) => ({
    ...d,
    default: d.key === "storage_bytes" ? 10 * GiB : d.key === "data_sources" ? 100 : 50,
    ceiling: d.key === "data_sources" ? 200 : null,
    builtInDefault: d.key === "storage_bytes" ? 10 * GiB : 100,
    custom: false,
  })),
});

const overrides = (): Schemas["TeamLimitOverrides"] => ({
  teamId: "t1",
  revision: 3,
  items: defs.map((d) => ({
    ...d,
    default: d.key === "storage_bytes" ? 10 * GiB : 100,
    ceiling: d.key === "data_sources" ? 200 : null,
    override: d.key === "crawl_pages_per_day" ? 20_000 : null,
    effective: d.key === "storage_bytes" ? 10 * GiB : d.key === "crawl_pages_per_day" ? 20_000 : 100,
  })),
});

const usage = (): Schemas["TeamLimits"] => ({
  items: [
    { ...defs[0]!, max: 10 * GiB, used: 2 * GiB, overridden: false },
    { ...defs[1]!, max: 5, used: 5, overridden: true },
    { ...defs[2]!, max: 0, used: 0, overridden: true },
    { ...defs[3]!, max: 5000, used: 120, overridden: false },
    { ...defs[4]!, max: 2, used: 1, overridden: false },
    { ...defs[5]!, max: 600, used: 3, overridden: false },
    { ...defs[6]!, max: 120, used: null, overridden: false },
  ],
});

/* ---------- harness ---------- */

class ApiFailure {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly details?: unknown,
  ) {}
}
type Handler = (body: unknown) => unknown;

function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; body?: unknown; headers: Headers }[] = [];
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init);
    const url = new URL(req.url);
    const text = await req.text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, url: url.pathname, body, headers: req.headers });
    const handler = routes[`${req.method} ${url.pathname}`];
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    if (!handler) return json(404, { error: { code: "not_found", message: "Not found" } });
    const out = handler(body);
    if (out instanceof ApiFailure) return json(out.status, { error: { code: out.code, message: out.message, details: out.details } });
    return json(200, { data: out });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

function renderWith(
  ui: ReactNode,
  { platformRole = "none", teamRole }: { platformRole?: "none" | "platform_admin" | "platform_auditor"; teamRole?: "owner" | "member" } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], me(platformRole));
  const root = createRootRoute({
    component: () => (
      <TeamContext.Provider value={teamCtx(team, teamRole)}>
        {ui}
        <Toaster />
      </TeamContext.Provider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

/* ---------- tests ---------- */

describe("limit values", () => {
  it("formats and parses amounts", () => {
    expect(formatLimit("bytes", "none", 10 * GiB)).toBe("10 GiB");
    expect(formatLimit("count", "day", 5000)).toBe("5,000 per day");
    expect(formatLimit("count", "none", 0)).toBe("Blocked");
    expect(formatLimit("count", "none", null)).toBe("Unlimited");
    expect(toInput("bytes", 1.5 * GiB)).toBe("1.5");
    expect(fromInput("bytes", "1.5")).toBe(1.5 * GiB);
    expect(fromInput("count", "")).toBeNull();
    expect(fromInput("count", "2.5")).toBeUndefined();
    expect(fromInput("count", "-1")).toBeUndefined();
  });

  it("explains limit errors", () => {
    const err = new ApiError(409, "limit_reached", "Your team has reached its limit of 100 data sources. Ask a platform admin to raise it.", {
      limit: "data_sources",
      max: 100,
      current: 100,
    });
    expect(limitError(err)?.title).toBe("Team limit reached");
    expect(limitError(new ApiError(429, "rate_limited", "Too many queries.", undefined, 12))?.message).toBe("Too many queries. You can try again in 12 s.");
    expect(limitError(new ApiError(400, "invalid_name", "Bad"))).toBeUndefined();
    render(<ApiErrorAlert error={err} />);
    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("Team limit reached");
    expect(alert).toHaveTextContent("limit of 100 data sources");
  });
});

describe("admin limits page", () => {
  it("edits defaults with If-Match and validates against the ceiling", async () => {
    const calls = mockApi({
      "GET /v1/admin/limits": platform,
      "PUT /v1/admin/limits": () => ({ ...platform(), revision: 2 }),
    });
    const { container } = renderWith(<LimitsPage />, { platformRole: "platform_admin" });
    const resources = await screen.findByRole("table", { name: "Team resources: defaults and ceilings" });
    // One pill tab per group; only the active group's table is shown.
    const tabs = within(screen.getByRole("tablist", { name: "Limit groups" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Team resources", "Ingestion", "Queries & chat", "Public agents"]);
    expect(screen.queryByRole("table", { name: "Queries & chat: defaults and ceilings" })).toBeNull();
    // The sticky save bar only appears with unsaved changes.
    expect(screen.queryByRole("button", { name: "Save limits" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    const sources = within(resources).getByRole("textbox", { name: "Default for Data sources" });
    await userEvent.clear(sources);
    await userEvent.type(sources, "250");
    // Above the ceiling: the save bar says it can't save yet, and the field says why (F-05, F-26).
    expect(screen.getByRole("status")).toHaveTextContent("Not saved: fix the highlighted limits");
    const save = screen.getByRole("button", { name: "Save limits" });
    expect(await axe(container)).toHaveNoViolations();

    // An invalid value on another tab is named in the error.
    await userEvent.click(screen.getByRole("tab", { name: "Ingestion" }));
    await userEvent.click(save);
    expect(await screen.findByText("Fix the highlighted limits in Team resources, then save.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    // Amounts show thousands separators except while being edited.
    const pages = screen.getByRole("textbox", { name: "Default for Crawled pages per day (per day)" });
    await userEvent.clear(pages);
    await userEvent.type(pages, "5000");
    await userEvent.tab();
    expect(pages).toHaveValue("5,000");

    await userEvent.click(screen.getByRole("tab", { name: "Team resources" }));
    const resources2 = await screen.findByRole("table", { name: "Team resources: defaults and ceilings" });
    expect(await within(resources2).findByText("The default can't be above the ceiling.")).toBeInTheDocument();
    const sources2 = within(resources2).getByRole("textbox", { name: "Default for Data sources" });
    await userEvent.clear(sources2);
    await userEvent.type(sources2, "150");
    const storage = within(resources2).getByRole("textbox", { name: "Default for Storage (GiB)" });
    await userEvent.clear(storage);
    await userEvent.type(storage, "20");
    await userEvent.click(screen.getByRole("button", { name: "Save limits" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"1"');
    expect(put.body).toEqual({
      items: [
        { key: "storage_bytes", default: 20 * GiB, ceiling: null },
        { key: "data_sources", default: 150, ceiling: 200 },
        { key: "crawl_pages_per_day", default: 5000, ceiling: null },
      ],
    });
    expect(await screen.findByText("Limits saved")).toBeInTheDocument();
  });

  it("discards unsaved changes from the save bar", async () => {
    mockApi({ "GET /v1/admin/limits": platform });
    renderWith(<LimitsPage />, { platformRole: "platform_admin" });
    const resources = await screen.findByRole("table", { name: "Team resources: defaults and ceilings" });
    const sources = within(resources).getByRole("textbox", { name: "Default for Data sources" });
    await userEvent.clear(sources);
    await userEvent.type(sources, "120");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(sources).toHaveValue("100");
    expect(screen.queryByRole("button", { name: "Save limits" })).toBeNull();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("is read-only for auditors", async () => {
    mockApi({ "GET /v1/admin/limits": platform });
    renderWith(<LimitsPage />, { platformRole: "platform_auditor" });
    const resources = await screen.findByRole("table", { name: "Team resources: defaults and ceilings" });
    expect(within(resources).getByText("10 GiB")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save limits" })).toBeNull();
  });
});

describe("admin team limits card", () => {
  it("sets, blocks and inherits limits in groups with usage, refusing values above the ceiling (D7)", async () => {
    const calls = mockApi({
      "GET /v1/admin/teams/registrar/limits": overrides,
      "GET /v1/teams/registrar/limits": usage,
      "PUT /v1/admin/teams/registrar/limits": () => ({ ...overrides(), revision: 4 }),
    });
    const { container } = renderWith(<AdminTeamLimitsCard team="registrar" teamName="Office of the Registrar" />, { platformRole: "platform_admin" });
    // Team resources is open; the other groups are collapsed with a summary.
    const table = await screen.findByRole("table", { name: "Team resources limits for Office of the Registrar" });
    expect(await within(table).findByRole("meter", { name: "Data sources: usage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ingestion/ })).toHaveAttribute("aria-expanded", "false");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.selectOptions(within(table).getByRole("combobox", { name: "Data sources: team setting" }), "custom");
    const value = within(table).getByRole("textbox", { name: "Data sources: team value" });
    await userEvent.clear(value);
    await userEvent.type(value, "500");
    // The field explains itself as you type; the save bar stays so Save shows the problem too (F-05).
    expect(screen.getByRole("status")).toHaveTextContent("Not saved: fix the highlighted limit");
    expect(within(table).getByText("The platform ceiling is 200.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save team limits" }));
    expect(await within(table).findByText("The platform ceiling is 200.")).toBeInTheDocument();

    await userEvent.clear(value);
    await userEvent.type(value, "150");
    await userEvent.selectOptions(within(table).getByRole("combobox", { name: "Knowledge bases: team setting" }), "blocked");
    await userEvent.click(screen.getByRole("button", { name: /Ingestion/ }));
    const ingestion = await screen.findByRole("table", { name: "Ingestion limits for Office of the Registrar" });
    await userEvent.selectOptions(within(ingestion).getByRole("combobox", { name: "Crawled pages per day: team setting" }), "inherit");
    await userEvent.click(screen.getByRole("button", { name: "Save team limits" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"3"');
    expect(put.body).toEqual({
      items: [
        { key: "data_sources", value: 150 },
        { key: "knowledge_bases", value: 0 },
        { key: "crawl_pages_per_day", value: null },
      ],
    });
  });
});

describe("team usage card", () => {
  it("shows usage meters, most used first, with rate limits in a disclosure (W10)", async () => {
    mockApi({ "GET /v1/teams/registrar/limits": usage, "GET /v1/teams/registrar/agents": () => [] });
    const { container } = renderWith(<UsageCard team="registrar" />, { teamRole: "owner" });
    const resources = await screen.findByRole("region", { name: "Team resources" });
    // Sorted by share used: data sources (full), storage (20 %); knowledge bases are blocked (shown first as full).
    const meters = within(resources).getAllByRole("meter");
    expect(meters.map((m) => m.getAttribute("aria-valuetext"))).toEqual(["5 of 5, at limit", "2 GiB of 10 GiB"]);
    expect(within(resources).getByText("Blocked for your team")).toBeInTheDocument();
    const ingestion = screen.getByRole("region", { name: "Ingestion" });
    expect(within(ingestion).getAllByRole("meter").map((m) => m.getAttribute("aria-valuetext"))).toEqual(["1 of 2", "120 of 5,000"]);
    expect(within(ingestion).getByText(/resets at midnight UTC/)).toBeInTheDocument();
    expect(screen.getAllByText("Set for your team")).toHaveLength(2);
    // Limits without a running total are in the disclosure; no public caps without a public agent.
    expect(screen.queryByText("Up to 120 per minute")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Rate limits and per-person caps/ }));
    expect(await screen.findByText("120 per minute")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Public agents" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows the public caps only when the team has a public agent", async () => {
    const pub = { key: "public_queries_per_agent_per_day", group: "public", unit: "count", period: "day", label: "Public queries per agent per day", description: "", max: 100, used: 90, overridden: false };
    mockApi({
      "GET /v1/teams/registrar/limits": () => ({ items: [...usage().items, pub] }),
      "GET /v1/teams/registrar/agents": () => [{ id: "a1", audience: "public", published: { version: 1 }, draft: { kbs: [] } }],
    });
    renderWith(<UsageCard team="registrar" />, { teamRole: "owner" });
    const pubGroup = await screen.findByRole("region", { name: "Public agents" });
    expect(within(pubGroup).getByRole("meter")).toHaveAttribute("aria-valuetext", "90 of 100, near limit");
  });
});

describe("team domain requests", () => {
  it("names who asked and who reviewed", async () => {
    mockApi({
      "GET /v1/teams/registrar/domain-requests": () => [
        {
          id: "r1",
          teamId: "t1",
          teamSlug: "registrar",
          teamName: "Office of the Registrar",
          pattern: "*.example.org",
          reason: "Partner college publishes our transfer guides.",
          status: "approved",
          requestedBy: "u2",
          reviewedBy: "u3",
          requester: { id: "u2", displayName: "Blair Dev", email: "blair@example.edu" },
          reviewer: { id: "u3", displayName: "Pat Admin", email: "pat@example.edu" },
          reviewNote: "OK",
          reviewedAt: "2026-09-21T10:00:00Z",
          createdAt: "2026-09-20T10:00:00Z",
        },
      ],
    });
    renderWith(<DomainRequestsPage />, { teamRole: "owner" });
    const table = await screen.findByRole("table", { name: "Domain requests" });
    expect(await within(table).findByText("Blair Dev")).toBeInTheDocument();
    expect(within(table).getByText("blair@example.edu")).toBeInTheDocument();
    expect(within(table).queryByText("u2")).toBeNull();
    // The review is on the request's record page (D4), opened from the row menu.
    await userEvent.click(within(table).getByRole("button", { name: "Actions for *.example.org" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "View details" }));
    const sheet = await screen.findByRole("region", { name: "*.example.org" });
    expect(within(sheet).getByText(/Pat Admin/)).toBeInTheDocument();
    expect(within(sheet).getByText("Partner college publishes our transfer guides.")).toBeInTheDocument();
  });
});
