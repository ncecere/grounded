/* E18: a profile page for the signed-in person, and their personal API keys across teams, both from the account menu. */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Reply, meFor, mockApi, renderApp, shellRoutes } from "./harness";

const key = (over: Record<string, unknown>) => ({
  id: "k1", name: "Laptop script", kind: "personal", prefix: "gk_ab12", userId: "u1", scopes: ["query"], knowledgeBaseIds: null, agentIds: null,
  contact: { id: "u1", name: "Una User", email: "una@example.edu" }, expiresAt: null, lastUsedAt: null, revokedAt: null, createdAt: "2026-09-01T10:00:00Z", ...over,
});

const library = { id: "t2", slug: "library", name: "University Library", status: "active", maxClassification: "open", role: "member" };
const archived = { id: "t3", slug: "old-project", name: "Old project", status: "archived", maxClassification: "open", role: "editor" };

/** Una belongs to the registrar (owner), the library (member) and an archived project. */
const me = (extra: Record<string, unknown> = {}) => {
  const base = meFor();
  return { ...base, user: { ...base.user, createdAt: "2026-03-02T09:00:00Z", lastLoginAt: "2026-10-12T08:30:00Z", ...extra }, teams: [...base.teams, library, archived] };
};

const routes = (keys: Record<string, unknown>) => ({
  ...shellRoutes(),
  "GET /v1/me": () => me(),
  ...Object.fromEntries(Object.entries(keys).map(([slug, v]) => [`GET /v1/teams/${slug}/api-keys`, typeof v === "function" ? v : () => v])),
});

describe("Profile", () => {
  it("says who you are, your teams and where the rest of your account is", async () => {
    mockApi(routes({}));
    const { container } = renderApp("/settings/profile");
    expect(await screen.findByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    const who = screen.getByRole("region", { name: "You" });
    expect(within(who).getByText("Una User")).toBeInTheDocument();
    expect(within(who).getByText("una@example.edu")).toBeInTheDocument();
    expect(within(who).getByText("Mar 2, 2026")).toBeInTheDocument(); // member since
    expect(within(who).getByText(/Oct 12, 2026/)).toBeInTheDocument(); // last sign-in

    const teams = screen.getByRole("region", { name: "Your teams" });
    expect(within(teams).getByRole("link", { name: "Office of the Registrar" })).toHaveAttribute("href", "/teams/registrar");
    expect(within(teams).getByText("Owner")).toBeInTheDocument();
    expect(within(teams).getByRole("link", { name: "University Library" })).toHaveAttribute("href", "/teams/library");
    expect(within(teams).getByText("Member")).toBeInTheDocument();
    expect(within(teams).getByText("Archived")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "API keys" })).toHaveAttribute("href", "/settings/api-keys");
    expect(screen.getByRole("link", { name: "Notification settings" })).toHaveAttribute("href", "/settings/notifications");
    expect(screen.getByRole("link", { name: "Connected apps" })).toHaveAttribute("href", "/settings/connected-apps");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("works for a person in no team, and does not offer them an API keys page they cannot use", async () => {
    const lone = { ...me(), teams: [] };
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/me": () => lone });
    renderApp("/settings/profile");
    expect(await screen.findByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("You are not in a team yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connected apps" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "API keys" })).toBeNull();
  });
});

describe("Your API keys", () => {
  it("lists your personal keys from every team, and nobody else's, with a link to each key's page", async () => {
    mockApi(
      routes({
        registrar: [
          key({}),
          key({ id: "k2", name: "Someone else's", userId: "u9", prefix: "gk_zz99" }), // a team admin sees every member's keys
          key({ id: "k3", name: "CI pipeline", kind: "service", prefix: "gk_svc1" }), // a service key we are the contact of
        ],
        library: [key({ id: "k4", name: "Catalog sync", prefix: "gk_li44", expiresAt: "2099-01-01T00:00:00Z", lastUsedAt: "2026-10-01T10:00:00Z" })],
        "old-project": [key({ id: "k5", name: "Old export", prefix: "gk_old5" })],
      }),
    );
    const { container } = renderApp("/settings/api-keys");
    expect(await screen.findByRole("heading", { level: 1, name: "API keys" })).toBeInTheDocument();

    const reg = await screen.findByRole("region", { name: "Office of the Registrar" });
    expect(within(reg).getByRole("link", { name: "Laptop script" })).toHaveAttribute("href", "/teams/registrar/settings?tab=api-keys&record=k1");
    expect(within(reg).getByText("gk_ab12")).toBeInTheDocument();
    expect(screen.queryByText("Someone else's")).toBeNull();
    expect(screen.queryByText("CI pipeline")).toBeNull();

    const lib = screen.getByRole("region", { name: "University Library" });
    expect(within(lib).getByRole("link", { name: "Catalog sync" })).toHaveAttribute("href", "/teams/library/settings?tab=api-keys&record=k4");
    expect(within(lib).getByText(/Oct 1, 2026/)).toBeInTheDocument(); // last used

    const old = screen.getByRole("region", { name: "Old project" });
    expect(within(old).getByText("Archived")).toBeInTheDocument();
    expect(within(old).getByRole("link", { name: "Old export" })).toBeInTheDocument();
    expect(within(old).queryByRole("link", { name: /Create/ })).toBeNull(); // nothing can be created in an archived team
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says when a team has none, and sends you to the team's keys page to create one", async () => {
    mockApi(routes({ registrar: [], library: [], "old-project": [] }));
    renderApp("/settings/api-keys");
    const reg = await screen.findByRole("region", { name: "Office of the Registrar" });
    expect(await within(reg).findByText("No personal keys in this team.")).toBeInTheDocument();
    expect(within(reg).getByRole("link", { name: "Create a key in Office of the Registrar" })).toHaveAttribute("href", "/teams/registrar/settings?tab=api-keys");
    expect(screen.getByRole("link", { name: "Create a key in University Library" })).toHaveAttribute("href", "/teams/library/settings?tab=api-keys");
  });

  it("opens the create dialog on the team's page when you choose to create a key", async () => {
    mockApi({
      ...routes({ registrar: [], library: [], "old-project": [] }),
      "GET /v1/teams/library": () => ({ team: { ...library, description: "", revision: 1, createdAt: "", updatedAt: "" }, role: "member" }),
    });
    renderApp("/settings/api-keys");
    await userEvent.click(await screen.findByRole("link", { name: "Create a key in Office of the Registrar" }));
    expect(await screen.findByRole("dialog", { name: /key/i })).toBeInTheDocument();
  });

  it("keeps the other teams when one team's keys fail to load", async () => {
    mockApi(
      routes({
        registrar: () => Reply.error(500, "internal", "boom"),
        library: [key({ id: "k4", name: "Catalog sync", prefix: "gk_li44" })],
        "old-project": [],
      }),
    );
    renderApp("/settings/api-keys");
    const reg = await screen.findByRole("region", { name: "Office of the Registrar" });
    expect(await within(reg).findByRole("alert")).toHaveTextContent(/could not load/i);
    expect(within(screen.getByRole("region", { name: "University Library" })).getByRole("link", { name: "Catalog sync" })).toBeInTheDocument();
  });

  it("explains that keys belong to a team when you are in none", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/me": () => ({ ...me(), teams: [] }) });
    renderApp("/settings/api-keys");
    expect(await screen.findByText(/API keys belong to a team/)).toBeInTheDocument();
  });
});

describe("The account menu", () => {
  it("links Profile and API keys", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/agents": () => [] });
    renderApp("/");
    await userEvent.click(await screen.findByRole("button", { name: /Una User/ }));
    expect(await screen.findByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "/settings/profile");
    expect(screen.getByRole("menuitem", { name: "API keys" })).toHaveAttribute("href", "/settings/api-keys");
    expect(screen.getByRole("menuitem", { name: "Connected apps" })).toHaveAttribute("href", "/settings/connected-apps");
  });

  it("leaves out API keys for a person in no team, who has none", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/me": () => ({ ...me(), teams: [] }) });
    renderApp("/settings/profile");
    await userEvent.click(await screen.findByRole("button", { name: /Account:\s*Una User/ }));
    expect(await screen.findByRole("menuitem", { name: "Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "API keys" })).toBeNull();
  });
});
