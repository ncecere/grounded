/* The navigation shell (D1, D6, D8): stable sidebar, moved pages and redirects, ⌘K by name, not-found, Conversations. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { groupByDay } from "../lib/group-by-day";
import { Reply, meFor, mockApi, renderApp, shellRoutes, team } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const card = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  description: "Answers registration questions",
  accentColor: "",
  welcomeMessage: "",
  starterQuestions: [],
  citationMode: "inline",
  status: "active",
  audience: "team",
  shortName: null,
  group: "team",
  ...over,
});

const conversation = (id: string, title: string, updatedAt: string, over: Record<string, unknown> = {}) => ({
  id,
  agentId: "a1",
  agentName: "Registrar assistant",
  agentSlug: "registrar-assistant",
  teamSlug: "registrar",
  agentDeleted: false,
  title,
  createdAt: updatedAt,
  updatedAt,
  ...over,
});

describe("workspace sidebar", () => {
  it("keeps the same shape off team pages: Discover agents, Conversations and the last-used team", async () => {
    localStorage.setItem("grounded.lastTeam", "registrar");
    mockApi({ ...shellRoutes(), "GET /v1/agents": () => [] });
    const { container } = renderApp("/agents");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Discover agents" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Conversations" })).toHaveAttribute("href", "/conversations");
    // The team section is shown on every workspace page.
    expect(within(nav).getByRole("link", { name: "Data sources" })).toHaveAttribute("href", "/teams/registrar/sources");
    expect(within(nav).getByRole("link", { name: "Team settings" })).toHaveAttribute("href", "/teams/registrar/settings");
    // Domain requests and API keys left the primary nav.
    expect(within(nav).queryByRole("link", { name: "API keys" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Domain requests" })).toBeNull();
    expect(await screen.findByRole("heading", { level: 1, name: "Discover agents" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Discover agents");
    expect(screen.getByRole("complementary", { name: "Workspace sidebar" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("follows the chat page's team in the team switcher (F-22)", async () => {
    const qa = { ...team, id: "t2", slug: "qa-team", name: "QA Team" };
    mockApi({
      ...shellRoutes(),
      "GET /v1/me": () => ({
        ...meFor(),
        teams: [
          { id: "t1", slug: "registrar", name: "Office of the Registrar", status: "active", maxClassification: "sensitive", role: "owner" },
          { id: "t2", slug: "qa-team", name: "QA Team", status: "active", maxClassification: "sensitive", role: "editor" },
        ],
      }),
      "GET /v1/teams/qa-team": () => ({ team: qa, role: "editor" }),
      "GET /v1/agents/qa-team/qa-helper": () => card({ id: "a2", teamSlug: "qa-team", teamName: "QA Team", slug: "qa-helper", name: "QA Helper" }),
    });
    renderApp("/a/qa-team/qa-helper");
    expect(await screen.findByRole("button", { name: /Current workspace:\s*QA Team/ })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Data sources" })).toHaveAttribute("href", "/teams/qa-team/sources");
    await waitFor(() => expect(localStorage.getItem("grounded.lastTeam")).toBe("qa-team"));
  });
});

describe("moved pages", () => {
  it("redirects the old team pages into Team settings tabs", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/teams/registrar/api-keys": () => [], "GET /v1/teams/registrar/kbs": () => [] });
    const { router } = renderApp("/teams/registrar/api-keys");
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/settings"));
    expect(router.state.location.search).toEqual({ tab: "api-keys" });
    expect(await screen.findByRole("heading", { level: 1, name: "Team settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "API keys" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { level: 2, name: "API keys" })).toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist", { name: "Team settings sections" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Members", "Usage & limits", "API keys", "Audit log", "General"]);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/Office of the Registrar.*Team settings.*API keys/);
  });

  it("disables Leave team for the only owner, with the reason (P-04)", async () => {
    const user = userEvent.setup();
    mockApi({
      ...shellRoutes(),
      "GET /v1/teams/registrar/members": () => [
        { user: { id: "u1", email: "una@example.edu", displayName: "Una User", status: "active" }, role: "owner", revision: 1, createdAt: "2026-09-01T10:00:00Z" },
        { user: { id: "u2", email: "blair@example.edu", displayName: "Blair", status: "active" }, role: "editor", revision: 1, createdAt: "2026-09-01T10:00:00Z" },
      ],
      "GET /v1/teams/registrar/invites": () => [],
    });
    const { container } = renderApp("/teams/registrar/settings?tab=general");
    expect(await screen.findByRole("heading", { name: "Danger zone" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Leave team" })).toBeDisabled());
    expect(screen.getByText(/You're the only owner/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("tab", { name: "Members" }));
    const members = await screen.findByRole("table", { name: "Team members" });
    // Leave is in the row menu, disabled with the reason (W6).
    await user.click(await within(members).findByRole("button", { name: "Actions for Una User" }));
    const leave = await screen.findByRole("menuitem", { name: /Leave team/ });
    expect(leave).toHaveAttribute("aria-disabled", "true");
    expect(leave).toHaveTextContent("You're the only owner");
  });

  it("disables Leave team for a membership an SSO group manages, saying the next sign-in would add it again", async () => {
    mockApi({
      ...shellRoutes("none", "editor"),
      "GET /v1/teams/registrar/members": () => [
        { user: { id: "u1", email: "una@example.edu", displayName: "Una User", status: "active" }, role: "editor", revision: 1, createdAt: "2026-09-01T10:00:00Z",
          managedBy: { ruleId: "r1", group: "advising-staff" } },
        { user: { id: "u2", email: "blair@example.edu", displayName: "Blair", status: "active" }, role: "owner", revision: 1, createdAt: "2026-09-01T10:00:00Z" },
      ],
    });
    const { container } = renderApp("/teams/registrar/settings?tab=general");
    expect(await screen.findByRole("heading", { name: "Danger zone" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Leave team" })).toBeDisabled());
    expect(screen.getByText("Your membership comes from an SSO group, so leaving here wouldn't last.")).toBeInTheDocument();
    expect(screen.getByText(/Managed by SSO group advising-staff: you'd be added again at your next sign-in/)).toBeInTheDocument();
    expect(screen.queryByText(/An admin or owner can add you again/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("redirects the old admin log and crawling addresses", async () => {
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/access-log": () => ({ items: [], nextCursor: null }),
      "GET /v1/admin/models": () => [],
      "GET /v1/admin/crawl-allowlist": () => [],
      "GET /v1/admin/domain-requests": () => [],
    });
    const { router } = renderApp("/admin/access-log");
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/logs"));
    expect(router.state.location.search).toEqual({ tab: "access" });
    expect(await screen.findByRole("tab", { name: "Access log", selected: true })).toBeInTheDocument();
    await router.navigate({ href: "/admin/crawling" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/crawl-domains"));
    expect(await screen.findByRole("heading", { level: 1, name: "Crawl domains" })).toBeInTheDocument();
  });
});

describe("not found (P-05)", () => {
  it("shows the not-found page for an unknown team", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/teams/nope": () => Reply.error(404, "team_not_found") });
    const { container } = renderApp("/teams/nope");
    expect(await screen.findByRole("heading", { level: 1, name: "Team not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
    // The sidebar falls back to the user's own team.
    expect(screen.getByRole("button", { name: /Current workspace:\s*Office of the Registrar/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("command palette (P-01)", () => {
  it("finds agents, knowledge bases and sources by name (on the server, E15)", async () => {
    const user = userEvent.setup();
    mockApi({
      ...shellRoutes(),
      "GET /v1/agents": () => [card()],
      "GET /v1/search": () => [
        { type: "knowledge_base", id: "k1", label: "Registrar handbook", secondary: "Office of the Registrar", teamSlug: "registrar" },
      ],
    });
    const { router } = renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await user.type(within(dialog).getByRole("combobox", { name: "Command palette" }), "handbook");
    await user.click(await within(dialog).findByRole("option", { name: /Registrar handbook/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/kbs/k1"));
  });
});

describe("Conversations page", () => {
  it("groups by day", () => {
    const now = new Date(2026, 8, 26, 12);
    const groups = groupByDay(
      [
        conversation("c1", "A", new Date(2026, 8, 26, 9).toISOString()),
        conversation("c2", "B", new Date(2026, 8, 25, 9).toISOString()),
        conversation("c3", "C", new Date(2026, 8, 20, 9).toISOString()),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", expect.stringContaining("September 20")]);
  });

  it("searches on the server with the text, agent and range from the URL, and offers rename and delete", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/agents": () => [card()],
      "GET /v1/conversations": (_b, call) =>
        call.search.get("limit") === "5"
          ? { items: [], nextCursor: null }
          : { items: [conversation("c1", "Transcript request", new Date().toISOString())], nextCursor: null },
    });
    const { router, container } = renderApp("/conversations?q=transcript&agent=a1&range=7d");
    expect(await screen.findByRole("heading", { level: 1, name: "Conversations" })).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: /Transcript request/ });
    expect(link).toHaveAttribute("href", "/a/registrar/registrar-assistant?c=c1");
    expect(screen.getByRole("heading", { level: 2, name: "Today" })).toBeInTheDocument();
    const list = calls.filter((c) => c.url === "/v1/conversations" && c.search.get("limit") === "50");
    const last = list[list.length - 1]!;
    expect(last.search.get("q")).toBe("transcript");
    expect(last.search.get("agentId")).toBe("a1");
    expect(last.search.get("from")).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();

    await user.clear(screen.getByRole("searchbox", { name: "Search conversations" }));
    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).q).toBeUndefined());

    await user.click(screen.getByRole("button", { name: "Actions for Transcript request" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Rename…", "Export as Markdown", "Export as JSON", "Delete…"]);
  });
});
