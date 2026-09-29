import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { routeTree } from "../router";

/* ---------- fixtures ---------- */

const team = {
  id: "t1",
  slug: "registrar",
  name: "Office of the Registrar",
  description: "",
  maxClassification: "restricted",
  status: "active",
  revision: 1,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
};

const me = (platformRole: "none" | "platform_admin" | "platform_auditor" = "none") => ({
  user: { id: "u1", email: "una@example.edu", displayName: "Una User", platformRole, status: "active" },
  teams: [{ id: "t1", slug: "registrar", name: "Office of the Registrar", status: "active", maxClassification: "restricted", role: "owner" }],
  csrfToken: "csrf-123",
  capabilities: { platformAdmin: platformRole === "platform_admin", platformAuditor: platformRole === "platform_auditor" },
});

const authConfig = { oidcEnabled: false, devAuthEnabled: true, loginUrl: "/auth/login", teamRequestUrl: null, devAccounts: [] };

/** Replaces fetch with canned {"data": ...} responses keyed by "METHOD path". */
function mockApi(routes: Record<string, () => unknown>) {
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init);
    const url = new URL(req.url);
    const handler = routes[`${req.method} ${url.pathname}`];
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    if (!handler) return json(404, { error: { code: "not_found", message: "Not found" } });
    return json(200, { data: handler() });
  });
}

const teamRoutes = {
  "GET /v1/auth/config": () => authConfig,
  "GET /v1/teams/registrar": () => ({ team, role: "owner" }),
  "GET /v1/teams/registrar/sources": () => [],
  "GET /v1/teams/registrar/kbs": () => [],
  "GET /v1/teams/registrar/members": () => [],
  "GET /v1/teams/registrar/invites": () => [],
  "GET /v1/teams/registrar/audit": () => ({ items: [], nextCursor: null }),
  "GET /v1/classifications": () => [],
  "GET /v1/embedding-profiles": () => [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

function renderApp(path = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router };
}

describe("app shell", () => {
  it("has landmarks, a skip link, the team switcher and the portal switch, and no axe violations", async () => {
    mockApi({ ...teamRoutes, "GET /v1/me": () => me("platform_admin") });
    const { container } = renderApp("/");

    expect(await screen.findByRole("heading", { level: 1, name: "Welcome, Una" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).closest("header")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("aria-expanded", "true");

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    // Workspace mode is the plain user experience: no admin pages in the sidebar.
    expect(within(nav).queryByRole("link", { name: "Users" })).toBeNull();
    const portal = screen.getByRole("navigation", { name: "Portal" });
    expect(within(portal).getByRole("link", { name: "Workspace" })).toHaveAttribute("aria-current", "page");
    expect(within(portal).getByRole("link", { name: "Admin" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Home");
    expect(screen.getByRole("button", { name: /Current workspace:\s*Office of the Registrar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Account:\s*Una User/ })).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("gives someone without a team fitting copy, their own initials and a team request only when configured (P-08)", async () => {
    const noTeam = { ...me(), user: { ...me().user, displayName: "Casey Dev" }, teams: [] };
    mockApi({ ...teamRoutes, "GET /v1/me": () => noTeam, "GET /v1/agents": () => [] });
    const first = renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome, Casey" })).toBeInTheDocument();
    expect(screen.getByText(/To build your own, join a team/)).toBeInTheDocument();
    expect(screen.queryByText(/your teams have published/)).toBeNull();
    expect(screen.getByText("You aren't on a team yet.")).toBeInTheDocument();
    // Without a request form or help link: ask a platform admin.
    expect(screen.getByText(/To join a team, ask one of its owners to add you\. Not sure who\? Ask a platform admin\./)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Request a new team" })).toBeNull();
    const switcher = screen.getByRole("button", { name: /Current workspace:\s*Casey Dev/ });
    expect(switcher).toHaveTextContent("CD");
    expect(switcher).toHaveTextContent("No team yet");
    expect(await axe(first.container)).toHaveNoViolations();
    first.unmount();

    mockApi({ ...teamRoutes, "GET /v1/me": () => noTeam, "GET /v1/agents": () => [], "GET /v1/auth/config": () => ({ ...authConfig, teamRequestUrl: "https://help.example.edu/new-team" }) });
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Request a new team" })).toHaveAttribute("href", "https://help.example.edu/new-team");
  });

  it("says how to get onto a team in the workspace switcher, with the platform's help link", async () => {
    const noTeam = { ...me(), user: { ...me().user, displayName: "Casey Dev" }, teams: [] };
    mockApi({
      ...teamRoutes,
      "GET /v1/me": () => noTeam,
      "GET /v1/agents": () => [],
      "GET /v1/auth/config": () => ({ ...authConfig, instance: { name: "Grounded", orgName: "", theme: "neutral", logoUrl: null, supportUrl: "https://help.example.edu/ai" } }),
    });
    const { container } = renderApp("/");
    const help = await screen.findByRole("link", { name: "Get help" });
    expect(help).toHaveAttribute("href", "https://help.example.edu/ai");
    await userEvent.click(screen.getByRole("button", { name: /Current workspace:\s*Casey Dev/ }));
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent(/You aren't on a team yet\. To join a team, ask one of its owners to add you, or ask for help getting onto one\./);
    expect(within(menu).getByRole("menuitem", { name: "Get help" })).toHaveAttribute("href", "https://help.example.edu/ai");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("hides the portal switch and admin pages from people without a platform role", async () => {
    mockApi({ ...teamRoutes, "GET /v1/me": () => me("none") });
    renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Users" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Portal" })).toBeNull();
  });

  it("switches platform admins between the workspace and admin portals, returning to the last page in each", async () => {
    const user = userEvent.setup();
    mockApi({
      ...teamRoutes,
      "GET /v1/me": () => me("platform_admin"),
      "GET /v1/admin/users": () => ({ items: [], nextCursor: null }),
      "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
      "GET /v1/admin/domain-requests": () => [],
      "GET /v1/admin/models": () => [],
      "GET /v1/admin/attention": () => ({ pendingDomainRequests: 2 }),
    });
    const { router, container } = renderApp("/teams/registrar/sources");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(await within(nav).findByRole("link", { name: "Data sources" })).toHaveAttribute("aria-current", "page");

    const portal = screen.getByRole("navigation", { name: "Portal" });
    await user.click(within(portal).getByRole("link", { name: "Admin" }));
    // The admin portal opens on its Overview (D6).
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
    // Pages load lazily: the portal switches once the page's route has loaded.
    await waitFor(() => expect(within(portal).getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page"));
    // Admin mode: grouped platform pages, no team switcher or team pages.
    expect(await within(nav).findByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    // Groups other than the current page's start collapsed to their headers.
    expect(within(nav).queryByRole("link", { name: "Logs" })).toBeNull();
    for (const group of ["People", "Content", "Policy", "Monitoring"]) {
      const header = within(nav).getByRole("button", { name: group });
      expect(header).toHaveAttribute("aria-expanded", "false");
      await user.click(header);
      expect(header).toHaveAttribute("aria-expanded", "true");
    }
    expect(within(nav).getByRole("link", { name: "Logs" })).toBeInTheDocument();
    // SystemOne is listed only once a SystemOne model exists.
    expect(within(nav).queryByRole("link", { name: "SystemOne" })).toBeNull();
    // P-16: the pending domain requests are counted beside Crawl domains.
    await waitFor(() => expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toContain("Crawl domains2 pending domain requests"));
    expect(within(nav).getByRole("link", { name: "Limits" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Data sources" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Current workspace/ })).toBeNull();
    expect(screen.getByText("Platform admin")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(within(nav).getByRole("link", { name: "Teams" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/teams"));

    await user.click(within(portal).getByRole("link", { name: "Workspace" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/sources"));
    await user.click(within(portal).getByRole("link", { name: "Admin" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/teams"));

    // The groups stay as they were left (the admin sidebar was mounted again); arriving on a page of a closed group opens it.
    const adminNav = await screen.findByRole("navigation", { name: "Main" });
    await user.click(await within(adminNav).findByRole("button", { name: "Monitoring" }));
    expect(within(adminNav).getByRole("button", { name: "Monitoring" })).toHaveAttribute("aria-expanded", "false");
    expect(within(adminNav).getByRole("button", { name: "Policy" })).toHaveAttribute("aria-expanded", "true");
    await router.navigate({ to: "/admin/logs" });
    await waitFor(() => expect(within(adminNav).getByRole("button", { name: "Monitoring" })).toHaveAttribute("aria-expanded", "true"));
    expect(JSON.parse(localStorage.getItem("grounded.adminNavOpen") ?? "[]")).toEqual(expect.arrayContaining(["People", "Policy", "Monitoring"]));
  });

  it("opens Admin on Overview for someone who hasn't used it in this session, even after another admin did", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem("grounded.lastHref.someone-else.admin", "/admin/group-mapping");
    mockApi({ ...teamRoutes, "GET /v1/me": () => me("platform_admin"), "GET /v1/admin/models": () => [], "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0 }) });
    const { router } = renderApp("/teams/registrar/sources");
    const portal = await screen.findByRole("navigation", { name: "Portal" });
    await user.click(within(portal).getByRole("link", { name: "Admin" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
  });

  it("shows team pages, the team breadcrumb and a read-only admin badge for auditors", async () => {
    mockApi({ ...teamRoutes, "GET /v1/me": () => me("platform_auditor"), "GET /v1/admin/audit": () => ({ items: [], nextCursor: null }) });
    const { router } = renderApp("/teams/registrar/sources");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(await within(nav).findByRole("link", { name: "Data sources" })).toHaveAttribute("aria-current", "page");
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() => expect(crumbs).toHaveTextContent("Office of the Registrar"));
    expect(crumbs).toHaveTextContent("Data sources");

    // The old address redirects to Logs; auditors see one "Read-only" badge in the shell.
    await router.navigate({ href: "/admin/audit" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/logs"));
    expect(await screen.findByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByText(/Auditor · read-only/)).toBeNull();
  });

  it("shows platform staff who aren't members only the team overview, and explains content is private", async () => {
    mockApi({
      ...teamRoutes,
      "GET /v1/me": () => ({ ...me("platform_admin"), teams: [] }),
      "GET /v1/teams/registrar": () => ({ team }),
    });
    const { container } = renderApp("/teams/registrar/sources");
    expect(await screen.findByText("Only team members can see this.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(team.name);
    expect(screen.getByRole("link", { name: "Open in Admin" })).toHaveAttribute("href", "/admin/teams/registrar");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Team settings" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Data sources" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "API keys" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("command palette", () => {
  it("opens with Ctrl+K and navigates to a team", async () => {
    const user = userEvent.setup();
    mockApi({ ...teamRoutes, "GET /v1/me": () => me("none") });
    const { router } = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Welcome, Una" });

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await user.type(within(dialog).getByRole("combobox", { name: "Command palette" }), "Registrar");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar"));
    expect(await screen.findByRole("heading", { level: 1, name: "Office of the Registrar" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
  });

  it("runs a quick action: New data source opens the create dialog on the sources page", async () => {
    const user = userEvent.setup();
    mockApi({ ...teamRoutes, "GET /v1/me": () => me("none") });
    const { router } = renderApp("/teams/registrar");
    await screen.findByRole("heading", { level: 1, name: "Office of the Registrar" });

    await user.click(screen.getByRole("button", { name: /Search or jump to/ }));
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await user.type(within(dialog).getByRole("combobox", { name: "Command palette" }), "new data source");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/sources"));
    expect(await screen.findByRole("dialog", { name: "New data source" })).toBeInTheDocument();
  });
});
