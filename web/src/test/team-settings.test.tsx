/* Team settings: which tabs each role sees (F-24, DESIGN §3.5) and the General tab (D3). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { settingsDescription } from "../pages/team/settings/page";
import { type Handler, meFor, mockApi, renderApp, shellRoutes, team } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const member = (id: string, name: string, role: string) => ({
  user: { id, email: `${id}@example.edu`, displayName: name, status: "active" },
  role,
  revision: 1,
  createdAt: "2026-09-25T10:00:00Z",
});

function routes(platformRole: "none" | "platform_admin" = "none", teamRole?: string): Record<string, Handler> {
  return {
    ...shellRoutes(platformRole, teamRole ?? "owner"),
    ...(teamRole
      ? {}
      : {
          "GET /v1/me": () => ({ ...meFor(platformRole), teams: [] }),
          "GET /v1/teams/registrar": () => ({ team }),
        }),
    "GET /v1/teams/registrar/members": () => [member("u1", "Una User", "owner"), member("u2", "Blair Dev", "editor")],
    "GET /v1/teams/registrar/invites": () => [],
    "GET /v1/teams/registrar/agents": () => [],
    "GET /v1/teams/registrar/kbs": () => [],
    "GET /v1/teams/registrar/limits": () => ({ items: [] }),
  };
}

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);

describe("team settings tabs", () => {
  it("hides Usage & limits and the audit log from members (F-24)", async () => {
    mockApi(routes("none", "member"));
    renderApp("/teams/registrar/settings");
    await screen.findByRole("table", { name: "Team members" });
    expect(tabNames()).toEqual(["Members", "API keys", "General"]);
  });

  it("shows editors every tab", async () => {
    mockApi(routes("none", "editor"));
    renderApp("/teams/registrar/settings");
    await screen.findByRole("table", { name: "Team members" });
    // Five tabs: Crawl domains moved to Data sources (I4).
    expect(tabNames()).toEqual(["Members", "Usage & limits", "API keys", "Audit log", "General"]);
    // The description names what the tabs hold, General included.
    expect(screen.getByText("Members, usage, API keys, the audit log and general details of Office of the Registrar.")).toBeInTheDocument();
  });

  it("describes the page by what each reader's tabs hold", () => {
    expect(settingsDescription("Advising", { role: "owner", spend: true })).toBe("Members, usage and spend, API keys, the audit log and general details of Advising.");
    expect(settingsDescription("Advising", { role: "editor", spend: false })).toBe("Members, usage, API keys, the audit log and general details of Advising.");
    expect(settingsDescription("Advising", { role: "member", spend: false })).toBe("The members, API keys and general details of Advising.");
    expect(settingsDescription("Advising", { spend: true })).toBe("The members, audit log and general details of Advising.");
  });

  it("has no open-invites section without invites (W6)", async () => {
    const calls = mockApi(routes("none", "owner"));
    renderApp("/teams/registrar/settings");
    await screen.findByRole("table", { name: "Team members" });
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/invites"))).toBe(true));
    expect(screen.queryByText("Open invites")).toBeNull();
    expect(screen.queryByText("No open invites.")).toBeNull();
  });

  it("lists open invites when there are some", async () => {
    mockApi({
      ...routes("none", "owner"),
      "GET /v1/teams/registrar/invites": () => [{ id: "i1", email: "new@example.edu", role: "member", createdAt: "2026-09-25T10:00:00Z", expiresAt: "2026-10-25T10:00:00Z" }],
    });
    renderApp("/teams/registrar/settings");
    expect(await screen.findByRole("table", { name: "Open invites" })).toHaveTextContent("new@example.edu");
  });
});

describe("general tab", () => {
  it("is read-only for owners, with Leave in the Danger zone", async () => {
    mockApi(routes("none", "owner"));
    const { container } = renderApp("/teams/registrar/settings?tab=general");
    const general = (await screen.findByRole("heading", { name: "General" })).closest("section, div")!;
    expect(within(general as HTMLElement).queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(screen.getByText(/Platform admins rename teams/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Leave this team" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive team" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("lets platform admins rename and archive the team, with one save bar", async () => {
    const calls = mockApi({
      ...routes("platform_admin"),
      "PATCH /v1/admin/teams/registrar": (body) => ({ team: { ...team, ...(body as object), revision: 2 } }),
    });
    const { container } = renderApp("/teams/registrar/settings?tab=general");
    const name = await screen.findByRole("textbox", { name: "Name" });
    expect(screen.queryByRole("heading", { name: "Leave this team" })).toBeNull();
    await userEvent.clear(name);
    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByText("Not saved: fix the highlighted field")).toBeInTheDocument();
    await userEvent.type(name, "Registrar");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({ name: "Registrar", description: "" });
    expect(patch.headers.get("If-Match")).toBe('"1"');
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "Archive team" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive team" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)!.body).toEqual({ status: "archived" }));
  });
});
