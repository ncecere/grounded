/* The team overview (tabs in the URL, clickable counts, getting started) and the audit logs (labels and filters). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { actionLabel } from "../components/audit/labels";
import { toAuditFilters } from "../components/audit/filters";
import { describeWeights, fusionErrors, fusionFormOf, fusionPatch } from "../pages/team/kbs/fusion-form";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

type Entry = Schemas["AuditEntry"];
const entry = (id: number, over: Partial<Entry>): Entry => ({
  id,
  occurredAt: "2026-09-26T09:00:00Z",
  actorKind: "user",
  actor: { kind: "user", userId: "u1", displayName: "Una User", email: "una@example.edu" },
  action: "agent.publish",
  targetType: "agent",
  targetId: "ag1",
  targetLabel: "Registrar assistant",
  targetExists: true,
  metadata: {},
  requestId: "r1",
  ...over,
});

const entries = [
  entry(3, {}),
  entry(2, {
    action: "kb.delete",
    targetType: "knowledge_base",
    targetId: "k9",
    targetLabel: "Old handbook",
    targetExists: false,
  }),
  entry(1, {
    actorKind: "api_key",
    actor: { kind: "api_key", userId: "u1", displayName: "Una User", email: "una@example.edu", apiKeyName: "loader" },
    action: "document.upload",
    targetType: "data_source",
    targetId: "s1",
    targetLabel: "Policies",
  }),
];

const member = (id: string, name: string, role: string) => ({
  user: { id, email: `${id}@example.edu`, displayName: name, status: "active" },
  role,
  revision: 1,
  createdAt: "2026-09-25T10:00:00Z",
});

const draft = { id: "ag1", name: "Helper", slug: "helper", status: "active", published: null, draft: { kbs: [] }, disabledReason: "" };

const counts = { total: 3, pending: 0, processing: 0, ready: 2, failed: 1, skipped: 0, bytes: 2048, chunks: 40 };

function routes(opts: { teamRole?: string; sources?: unknown[]; agents?: unknown[]; kbs?: unknown[] } = {}): Record<string, Handler> {
  return {
    ...shellRoutes("none", opts.teamRole ?? "owner"),
    "GET /v1/teams/registrar/sources": () => opts.sources ?? [{ id: "s1", name: "Policies", documents: counts }],
    "GET /v1/teams/registrar/kbs": () => opts.kbs ?? [],
    "GET /v1/teams/registrar/agents": () => opts.agents ?? [],
    "GET /v1/teams/registrar/members": () => [member("u1", "Una User", "owner"), member("u2", "Blair Dev", "editor")],
    "GET /v1/teams/registrar/invites": () => [],
    "GET /v1/teams/registrar/limits": () => ({ items: [] }),
    "GET /v1/teams/registrar/audit": (_b, call) => ({ items: call.search.get("limit") === "5" ? entries.slice(0, 2) : entries, nextCursor: null }),
  };
}

describe("team overview", () => {
  it("links the counts, shows recent changes and opens the audit log tab", async () => {
    mockApi(routes({ agents: [{ ...draft, published: {}, draft: { kbs: [{ kbId: "k1" }] } }], kbs: [{ id: "k1", name: "KB" }] }));
    const { container, router } = renderApp("/teams/registrar");
    const counts = await screen.findByRole("region", { name: "At a glance" });
    expect(within(counts).getByRole("link", { name: "Data sources" })).toHaveAttribute("href", "/teams/registrar/sources");
    expect(within(counts).getByRole("link", { name: "Knowledge bases" })).toHaveAttribute("href", "/teams/registrar/kbs");
    expect(within(counts).getByRole("link", { name: "Agents" })).toHaveAttribute("href", "/teams/registrar/agents");
    expect(within(counts).getByRole("link", { name: "Documents ready" })).toHaveAttribute("href", "/teams/registrar/sources");
    expect(within(counts).queryByText("Passages indexed")).toBeNull();
    expect(await within(counts).findByText("1 live")).toBeInTheDocument();
    expect(within(counts).getByText("1 used by agents")).toBeInTheDocument();
    // Every step is done: no getting started. The team has sources, so the primary action is New agent.
    expect(screen.queryByText("Getting started")).toBeNull();
    expect(screen.getByRole("link", { name: "New agent" })).toHaveAttribute("href", "/teams/registrar/agents");
    const recent = await screen.findByRole("list", { name: "Recent changes" });
    const rows = within(recent).getAllByRole("link");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Una User·Published agent·Registrar assistant");
    expect(rows[0]!.getAttribute("href")).toBe("/teams/registrar/settings?tab=audit&record=3");
    expect(await axe(container)).toHaveNoViolations();

    // The audit log lives in Team settings now (D1).
    await userEvent.click(screen.getByRole("link", { name: "View all" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/settings"));
    expect(router.state.location.search).toEqual({ tab: "audit" });
    expect(await screen.findByRole("table", { name: "Audit log" })).toBeInTheDocument();
    // The breadcrumb follows the tab (F-12).
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByText("Team settings")).toBeInTheDocument();
    expect(within(crumbs).getByText("Audit log")).toHaveAttribute("aria-current", "page");
    // Back returns to the overview.
    router.history.back();
    expect(await screen.findByRole("list", { name: "Recent changes" })).toBeInTheDocument();
  }, 15000);

  it("lists what needs attention, and nothing when all is well", async () => {
    const limits = {
      items: [
        { key: "documents", group: "resources", unit: "count", period: "total", label: "Documents", description: "", max: 100, used: 85, overridden: false },
        { key: "data_sources", group: "resources", unit: "count", period: "total", label: "Data sources", description: "", max: 10, used: 1, overridden: false },
      ],
    };
    const off = { ...draft, id: "ag2", name: "Old helper", status: "disabled_by_platform", disabledReason: "Answers leaked a phone list." };
    mockApi({
      ...routes({ agents: [off] }),
      "GET /v1/teams/registrar/limits": () => limits,
      "GET /v1/teams/registrar/domain-requests": () => [
        { id: "d1", pattern: "*.example.org", status: "pending" },
        { id: "d2", pattern: "*.example.net", status: "pending" },
      ],
    });
    const { container } = renderApp("/teams/registrar");
    const list = await screen.findByRole("list", { name: "Needs attention" });
    await within(list).findByText("Documents: 85 % used");
    // The count adds up what the rows say: 1 document, 2 requests, 1 limit, 1 agent.
    expect(list.closest("section")!.querySelector("header, [class*=header]")).toHaveTextContent("5");
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining("1 document failed in Policies"),
      expect.stringContaining("2 domain requests waiting for review"),
      expect.stringContaining("Documents: 85 % used"),
      expect.stringContaining("Old helper was turned off by a platform admin"),
    ]);
    expect(links[0]).toHaveAttribute("href", "/teams/registrar/sources/s1?tab=documents&status=failed");
    expect(links[1]).toHaveAttribute("href", "/teams/registrar/sources?tab=crawl-domains");
    expect(links[2]).toHaveAttribute("href", "/teams/registrar/settings?tab=usage");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows no attention block when all is well", async () => {
    mockApi(routes({ sources: [{ id: "s1", name: "Policies", documents: { ...counts, failed: 0 } }] }));
    renderApp("/teams/registrar");
    await screen.findByRole("list", { name: "Recent changes" });
    expect(screen.queryByText("Needs attention")).toBeNull();
  });

  it("redirects the old team tab address and shows who, what and which target", async () => {
    mockApi(routes());
    const { container, router } = renderApp("/teams/registrar?tab=audit");
    const table = await screen.findByRole("table", { name: "Audit log" });
    expect(router.state.location.pathname).toBe("/teams/registrar/settings");
    await within(table).findByText("Old handbook");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Published agent");
    // One line per cell: the action code is in the entry's sheet.
    expect(rows[0]).not.toHaveTextContent("agent.publish");
    expect(within(rows[0]!).getByRole("link", { name: "Registrar assistant" })).toHaveAttribute("href", "/teams/registrar/agents/ag1");
    // A deleted target keeps its name, without a link.
    expect(rows[1]).toHaveTextContent("Old handbook");
    expect(rows[1]).toHaveTextContent("Knowledge base (deleted)");
    expect(within(rows[1]!).queryByRole("link")).toBeNull();
    // API key actors name the key.
    expect(rows[2]).toHaveTextContent("Una User");
    expect(rows[2]).toHaveTextContent("API key: loader");
    expect(screen.getByRole("tab", { name: "Audit log", selected: true })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("filters the audit log by area, person and date range, in the URL", async () => {
    const calls = mockApi(routes());
    const { router } = renderApp("/teams/registrar/settings?tab=audit");
    await screen.findByRole("table", { name: "Audit log" });
    const audit = () => calls.filter((c) => c.url.endsWith("/audit"));
    await userEvent.click(screen.getByRole("combobox", { name: "Area" }));
    await userEvent.click(await screen.findByRole("option", { name: "Knowledge bases (all)" }));
    await waitFor(() => expect(audit().at(-1)!.search.get("action")).toBe("kb."));
    await userEvent.click(screen.getByRole("combobox", { name: "Person" }));
    await userEvent.click(await screen.findByRole("option", { name: /Blair Dev/ }));
    await waitFor(() => expect(audit().at(-1)!.search.get("actorUserId")).toBe("u2"));
    expect(audit().at(-1)!.search.get("action")).toBe("kb.");
    await userEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    await waitFor(() => expect(audit().at(-1)!.search.get("from")).toBeTruthy());
    const last = audit().at(-1)!;
    expect(new Date(last.search.get("to")!).getTime() - new Date(last.search.get("from")!).getTime()).toBeGreaterThanOrEqual(7 * 86_400_000 - 3_600_000);
    expect(router.state.location.search).toMatchObject({ tab: "audit", action: "kb.", person: "u2", range: "7d" });
  });

  it("opens an entry in a sheet with its before/after, from a link", async () => {
    const changed = entry(9, { action: "kb.update", targetType: "knowledge_base", targetId: "k1", targetLabel: "Handbook", before: { name: "Old" }, after: { name: "New" } });
    mockApi({ ...routes(), "GET /v1/teams/registrar/audit/9": () => changed });
    const { container } = renderApp("/teams/registrar/settings?tab=audit&record=9");
    const sheet = await screen.findByRole("region", { name: "Changed knowledge base" });
    expect(within(sheet).getByText("kb.update")).toBeInTheDocument();
    expect(within(sheet).getByRole("table", { name: /What changed: Changed knowledge base/ })).toBeInTheDocument();
    // Plain field names and values, not JSON.
    const changes = within(sheet).getByRole("table", { name: /What changed/ });
    expect(within(changes).getByRole("row", { name: /Name/ })).toHaveTextContent("NameOldNew");
    expect(sheet).not.toHaveTextContent('"New"');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("getting started", () => {

  it("walks a new team through setup, and can be dismissed", async () => {
    localStorage.clear();
    mockApi(routes({ sources: [], kbs: [{ id: "k1", name: "KB" }], agents: [draft] }));
    const { container } = renderApp("/teams/registrar");
    const card = (await screen.findByRole("heading", { name: "Getting started" })).closest("section")!;
    const steps = within(card).getAllByRole("listitem");
    await waitFor(() => expect(steps.map((st) => st.textContent?.startsWith("Done"))).toEqual([false, true, true, false]));
    expect(within(card).getByRole("link", { name: "New data source" })).toHaveAttribute("href", "/teams/registrar/sources");
    expect(within(card).getByRole("link", { name: "Open Helper" })).toHaveAttribute("href", "/teams/registrar/agents/ag1?tab=share");
    // One primary per view: while the checklist shows, its current step is the page's action, not the header's too.
    expect(screen.getAllByRole("link", { name: "New data source" })).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(card).getByRole("button", { name: "Dismiss Getting started" }));
    expect(screen.queryByRole("heading", { name: "Getting started" })).toBeNull();
    expect(localStorage.getItem("grounded.gettingStarted.dismissed.registrar")).toBe("1");
    // Dismissed: the header offers it again.
    expect(await screen.findByRole("link", { name: "New data source" })).toHaveAttribute("href", "/teams/registrar/sources");
  });

  it("gives members the agents they can chat with and the knowledge bases they can query (W13)", async () => {
    const card = { id: "ag1", teamSlug: "registrar", teamName: "Registrar", slug: "helper", name: "Helper", description: "Answers questions.", accentColor: "", status: "active", audience: "team", group: "team" };
    mockApi({ ...routes({ teamRole: "member", sources: [], kbs: [{ id: "k1", name: "Handbook", description: "" }] }), "GET /v1/agents": () => [card] });
    const { container } = renderApp("/teams/registrar");
    const agents = await screen.findByRole("list", { name: "Agents you can chat with" });
    expect(await within(agents).findByRole("link", { name: /Helper/ })).toHaveAttribute("href", "/a/registrar/helper");
    const kbs = screen.getByRole("list", { name: "Knowledge bases you can query" });
    expect(within(kbs).getByRole("link", { name: /Handbook/ })).toHaveAttribute("href", "/teams/registrar/kbs/k1");
    expect(screen.queryByText("Getting started")).toBeNull();
    expect(screen.queryByRole("region", { name: "At a glance" })).toBeNull();
    expect(screen.queryByText("Recent changes")).toBeNull();
    expect(screen.queryByRole("link", { name: "New data source" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("audit and form helpers", () => {
  it("labels actions and turns the filter bar into API filters", () => {
    expect(actionLabel("agent.publish")).toBe("Published agent");
    expect(actionLabel("widget.spin_up")).toBe("Widget: spin up");
    expect(toAuditFilters({ action: "", person: "", from: "", to: "" })).toEqual({});
    const f = toAuditFilters({ action: "agent.", person: "u1", from: "2026-09-01", to: "2026-09-02" });
    expect(f.action).toBe("agent.");
    expect(f.actorUserId).toBe("u1");
    expect(new Date(f.to!).getTime() - new Date(f.from!).getTime()).toBe(2 * 24 * 3600 * 1000);
    // A reversed range drops "to" rather than sending a request the API rejects.
    expect(toAuditFilters({ action: "", person: "", from: "2026-09-05", to: "2026-09-01" }).to).toBeUndefined();
  });

  it("builds the knowledge base fusion patch", () => {
    const base = { fusionWeights: null, effectiveFusionWeights: { vector: 1, keyword: 0.5 } } as unknown as Schemas["KnowledgeBase"];
    const own = { ...base, fusionWeights: { vector: 0.7, keyword: 0.3 }, effectiveFusionWeights: { vector: 0.7, keyword: 0.3 } } as Schemas["KnowledgeBase"];
    expect(fusionFormOf(base)).toEqual({ useDefault: true, vector: "1", keyword: "0.5" });
    expect(fusionPatch({ useDefault: true, vector: "1", keyword: "0.5" }, base)).toEqual({});
    expect(fusionPatch({ useDefault: false, vector: "0.8", keyword: "0" }, base)).toEqual({ fusionWeights: { vector: 0.8, keyword: 0 } });
    expect(fusionPatch({ useDefault: true, vector: "0.7", keyword: "0.3" }, own)).toEqual({ useDefaultFusionWeights: true });
    expect(fusionPatch(fusionFormOf(own), own)).toEqual({});
    expect(fusionErrors({ useDefault: false, vector: "0", keyword: "0" }).form).toBe("At least one weight must be above 0.");
    expect(fusionErrors({ useDefault: false, vector: "1.5", keyword: "x" })).toMatchObject({ vector: expect.any(String), keyword: expect.any(String) });
    expect(describeWeights({ vector: 0.7, keyword: 0.3 })).toBe("Vector 0.7 · keyword 0.3");
  });
});
