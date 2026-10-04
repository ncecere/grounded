/*
 * Shell fixes from the v0.2.1 walkthrough: ⌘K puts an exact name first (a tab
 * above the page holding it) and names the usage tab as the tab does, an
 * unknown or unavailable ?tab= is rewritten to the tab shown, switching tabs
 * drops the other tab's parameters, the page title never names a tab that
 * isn't shown, the 404 title has no page name, and sidebar conversation links
 * are named "question, Agent".
 */
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { PageTabs, useUrlTab } from "../components/page-tabs";
import { tabSearch } from "../lib/tabs";
import { meFor, mockApi, renderApp, shellRoutes, team } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const spendStatus = {
  mode: "track",
  state: "ok",
  enforced: false,
  currency: "USD",
  month: "2026-09-01",
  resetsAt: "2026-10-01T04:00:00Z",
  budget: null,
  extensions: "0.000000",
  limit: null,
  spent: "0.240000",
  percent: null,
  warnPercent: 80,
};
const byKind = { chat: "0.240000", embedding: "0.000000", systemone: "0.000000", moderation: "0.000000", ocr: "0.000000", mcp: "0.000000", rerank: "0.000000" };
const spend = {
  status: spendStatus,
  timeZone: "UTC",
  from: "2026-09-01",
  to: "2026-09-29",
  total: { spend: "0.240000", byKind, tokens: 5000, requests: 2, unpriced: false },
  agents: [],
  models: [],
};

async function openPalette(path: string) {
  const utils = renderApp(path);
  const user = userEvent.setup();
  await screen.findByRole("navigation", { name: "Main" });
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  const input = within(dialog).getByRole("combobox", { name: "Command palette" });
  return { ...utils, user, dialog, input };
}

describe("⌘K ranks an exact name first", () => {
  const adminRoutes = () => ({
    ...shellRoutes("platform_admin"),
    "GET /v1/admin/models": () => [],
    "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0 }),
    "GET /v1/agents": () => [],
    "GET /v1/search": () => [],
  });

  it.each([
    ["legal holds", "/admin/retention", { tab: "holds" }],
    ["profile migrations", "/admin/embedding-profiles", { tab: "migrations" }],
    ["migrations", "/admin/embedding-profiles", { tab: "migrations" }],
    ["budget", "/admin/costs", { tab: "budgets" }],
  ])("opens the tab for “%s” with Enter, not the page holding it", async (text, pathname, search) => {
    mockApi(adminRoutes());
    const { router, user, dialog, input } = await openPalette("/");
    await user.type(input, text);
    await waitFor(() => expect(within(dialog).getAllByRole("option")[0]).toHaveAttribute("data-highlighted"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe(pathname));
    expect(router.state.location.search).toMatchObject(search);
  });

  it("takes “features” and “evaluations” to the feature switches on Admin → Settings (AD-39)", async () => {
    mockApi(adminRoutes());
    const { router, user, dialog, input } = await openPalette("/");
    await user.type(input, "evaluations");
    expect(within(dialog).getAllByRole("option")[0]).toHaveTextContent("Features");
    await user.clear(input);
    await user.type(input, "features");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/settings"));
    expect(router.state.location.hash).toBe("features");
  });

  // v0.4.0 walkthrough (adm-3): the new settings are found by their names, and "rerank" no longer leads to SystemOne.
  it.each([
    // Its own page since v0.4.2 (OW-2); "Reranking settings" goes to the page's settings.
    ["reranking", "/admin/reranking", "", "Reranking"],
    ["reranking settings", "/admin/reranking", "settings", "Reranking settings"],
    ["saved answers", "/admin/settings", "features", "Saved answers"],
    ["answer cache", "/admin/settings", "features", "Saved answers"],
    // Admin → Settings (AD-39) by what it holds.
    ["time zone", "/admin/settings", "", "Settings"],
  ])("opens “%s”", async (text, pathname, hash, first) => {
    mockApi(adminRoutes());
    const { router, user, dialog, input } = await openPalette("/");
    await user.type(input, text);
    await waitFor(() => expect(within(dialog).getAllByRole("option")[0]).toHaveTextContent(first));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe(pathname));
    expect(router.state.location.hash).toBe(hash);
  });

  it.each([
    ["stream checked", "Moderation"],
    ["buffer", "Moderation"],
    ["failed questions", "Analytics"],
  ])("finds “%s” on %s", async (text, page) => {
    mockApi(adminRoutes());
    const { user, dialog, input } = await openPalette("/");
    await user.type(input, text);
    await waitFor(() => expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toContain(`${page}Admin`));
  });

  it("doesn't offer SystemOne for “rerank”", async () => {
    mockApi(adminRoutes());
    const { user, dialog, input } = await openPalette("/");
    await user.type(input, "rerank");
    await waitFor(() => expect(within(dialog).getAllByRole("option")[0]).toHaveTextContent("RerankingAdmin"));
    expect(within(dialog).queryByRole("option", { name: /SystemOne/ })).toBeNull();
  });

  it("names the usage command “Usage & spend” for an owner while cost tracking is on, and puts it first for “spend”", async () => {
    mockApi({ ...shellRoutes("none", "owner"), "GET /v1/agents": () => [], "GET /v1/search": () => [], "GET /v1/teams/registrar/spend": () => spend });
    const { router, user, dialog, input } = await openPalette("/teams/registrar");
    await user.type(input, "spend");
    await waitFor(() => expect(within(dialog).getAllByRole("option")[0]).toHaveTextContent("Usage & spendTeam settings"));
    expect(within(dialog).queryByRole("option", { name: /Usage & limits/ })).toBeNull();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/settings"));
    expect(router.state.location.search).toMatchObject({ tab: "usage" });
  });
});

describe("page tabs in the address", () => {
  function renderTabs(path: string) {
    const tabs = ["alpha", "beta", "gamma"] as const;
    function Page() {
      const [tab, setTab] = useUrlTab(tabs, { keep: ["range"] });
      return (
        <PageTabs
          label="Sections"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "alpha", label: "Alpha", content: "alpha content" },
            { value: "beta", label: "Beta", content: "beta content" },
            { value: "gamma", label: "Gamma", hidden: true, content: "gamma content" },
          ]}
        />
      );
    }
    const root = createRootRoute();
    const page = createRoute({ getParentRoute: () => root, path: "/", validateSearch: tabSearch(tabs, { passthrough: true }), component: Page });
    const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [path] }) });
    return { ...render(<RouterProvider router={router as never} />), router };
  }

  it("rewrites an unknown tab to the first one", async () => {
    const { router } = renderTabs("/?tab=keys&range=7d");
    expect(await screen.findByRole("tab", { name: "Alpha", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.searchStr).toBe("?range=7d"));
  });

  it("rewrites a tab the viewer doesn't get to the first one they get", async () => {
    const { router } = renderTabs("/?tab=gamma");
    expect(await screen.findByRole("tab", { name: "Alpha", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.searchStr).toBe(""));
    expect(router.history.length).toBe(1);
  });

  it("drops the other tab's parameters when switching, and keeps the page's", async () => {
    const user = userEvent.setup();
    const { router, container } = renderTabs("/?tab=beta&range=7d&top=agents&record=r1");
    await user.click(await screen.findByRole("tab", { name: "Alpha" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ range: "7d" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Team settings addresses and titles", () => {
  const teamRoutes = {
    "GET /v1/teams/registrar/members": () => [],
    "GET /v1/teams/registrar/invites": () => [],
    "GET /v1/teams/registrar/limits": () => ({ items: [] }),
    "GET /v1/teams/registrar/keys": () => [],
    "GET /v1/teams/registrar/audit": () => ({ items: [], nextCursor: null }),
  };

  it("never titles the usage tab “Usage & limits” while the spend is loading for an owner", async () => {
    let answer: () => void = () => {};
    const answered = new Promise<void>((r) => (answer = r));
    mockApi({
      ...shellRoutes("none", "owner"),
      ...teamRoutes,
      "GET /v1/teams/registrar/spend": async () => {
        await answered;
        return spend;
      },
    });
    renderApp("/teams/registrar/settings?tab=usage");
    await screen.findByRole("tab", { selected: true });
    await waitFor(() => expect(document.title).toMatch(/^Team settings · /));
    expect(document.title).not.toContain("Usage & limits");
    answer();
    await waitFor(() => expect(document.title).toMatch(/^Usage & spend · Team settings · /));
  });

  it("rewrites ?tab=keys to Members", async () => {
    mockApi({ ...shellRoutes("none", "owner"), ...teamRoutes, "GET /v1/teams/registrar/spend": () => spend });
    const { router } = renderApp("/teams/registrar/settings?tab=keys");
    expect(await screen.findByRole("tab", { name: "Members", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.searchStr).toBe(""));
  });

  it("sends platform staff who ask for the usage tab to Members, with a link to the team's admin page", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), ...teamRoutes, "GET /v1/me": () => ({ ...meFor("platform_auditor"), teams: [] }), "GET /v1/teams/registrar": () => ({ team }) });
    const { router, container } = renderApp("/teams/registrar/settings?tab=usage");
    expect(await screen.findByRole("tab", { name: "Members", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.searchStr).toBe(""));
    expect(screen.queryByRole("tab", { name: /Usage/ })).toBeNull();
    expect(screen.getByText(/Its usage, spend and limits are on its/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "admin page" })).toHaveAttribute("href", "/admin/teams/registrar");
    expect(screen.getByText(`The members, audit log and general details of ${team.name}.`)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("shell titles and names", () => {
  it("titles an unknown admin address “Page not found · Admin”", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/models": () => [], "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0 }) });
    renderApp("/admin/zzz");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toMatch(/^Page not found · Admin · /));
  });

  it("names a recent conversation link “question, Agent” as one text", async () => {
    const conversation = {
      id: "c1",
      agentId: "a1",
      agentName: "Records helper",
      agentSlug: "records",
      teamSlug: "registrar",
      agentDeleted: false,
      title: "How do I order a transcript?",
      createdAt: "2026-09-28T10:00:00Z",
      updatedAt: "2026-09-28T10:00:00Z",
    };
    mockApi({ ...shellRoutes(), "GET /v1/agents": () => [], "GET /v1/conversations": () => ({ items: [conversation], nextCursor: null }) });
    renderApp("/agents");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const link = await within(nav).findByRole("link", { name: "How do I order a transcript?, Records helper" });
    const spoken = [...link.querySelectorAll("span")].filter((el) => !el.closest("[aria-hidden]") && el.children.length === 0 && el.textContent);
    expect(spoken.map((el) => el.textContent)).toEqual(["How do I order a transcript?, Records helper"]);
  });
});
