/* Admin users and teams (A4, A7, Q6, Q12, v0.2.1 I7): server facets, counts, the team detail page (the Budget card on its Overview) and the user page's sections. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { usageRows } from "../pages/admin/people/team-overview";
import { type Handler, Reply, mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const team = {
  id: "t1",
  slug: "registrar",
  name: "Office of the Registrar",
  description: "",
  maxClassification: "sensitive",
  status: "active",
  revision: 2,
  createdAt: "",
  updatedAt: "",
} as Schemas["Team"];
const summary: Schemas["TeamSummary"] = { team, memberCount: 3, ownerCount: 1, ownerInvites: 0, agentCount: 4, sourceCount: 2, kbCount: 1, documentCount: 40, storageBytes: 2_000_000 };
const user = (id: string, extra: Partial<Schemas["User"]> = {}): Schemas["User"] => ({
  id,
  email: `${id}@example.edu`,
  displayName: `Person ${id}`,
  platformRole: "none",
  status: "active",
  revision: 1,
  createdAt: "2026-09-01T10:00:00Z",
  lastLoginAt: "2026-09-26T10:00:00Z",
  teamCount: 2,
  ...extra,
});
const limit = (key: Schemas["LimitKey"], used: number | null, max: number | null, group: Schemas["LimitGroup"] = "resources"): Schemas["TeamLimit"] => ({
  key,
  group,
  unit: "count",
  period: "none",
  label: key,
  description: "",
  max,
  used,
  overridden: false,
});

const budget: Schemas["TeamBudget"] = {
  teamId: "t1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  modeOverride: "inherit",
  amount: "100.000000",
  warnPercent: null,
  defaultBudget: null,
  revision: 2,
  extensions: [],
  status: {
    mode: "enforce",
    state: "warning",
    enforced: true,
    currency: "USD",
    month: "2026-09-01",
    resetsAt: "2026-10-01T00:00:00Z",
    budget: "100.000000",
    extensions: "0.000000",
    limit: "100.000000",
    spent: "85.000000",
    percent: 85,
    warnPercent: 80,
  },
};

const routes = (role: "platform_admin" | "platform_auditor" = "platform_admin", extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes(role),
  "GET /v1/admin/users": () => ({ items: [user("u2", { platformRole: "platform_admin" })], nextCursor: null }),
  "GET /v1/admin/teams": () => ({ items: [summary], nextCursor: null }),
  "GET /v1/admin/teams/registrar": () => summary,
  "GET /v1/teams/registrar/limits": () => ({ items: [limit("knowledge_bases", 9, 10), limit("documents", 40, 1000), limit("queries_per_minute", null, 60, "queries")] }),
  "GET /v1/admin/domain-requests": () => [],
  "GET /v1/teams/registrar/audit": () => ({ items: [], nextCursor: null }),
  "GET /v1/teams/registrar/members": () => [{ user: user("u3"), role: "owner", joinedAt: "" }],
  "GET /v1/admin/costs/settings": () => ({ mode: "enforce", currency: "USD", timeZone: "UTC", warnPercent: 80, defaultBudget: null, revision: 1, updatedAt: "" }),
  "GET /v1/admin/teams/registrar/budget": () => budget,
  "GET /v1/admin/teams/registrar/limits": () => ({ items: [], revision: 1 }),
  ...extra,
});

describe("admin users and teams", () => {
  it("filters users by role on the server and shows team counts", async () => {
    const calls = mockApi(routes());
    const { container } = renderApp("/admin/users?role=platform_admin");
    const table = await screen.findByRole("table", { name: "Users" });
    expect(await within(table).findByText("Person u2")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/v1/admin/users")?.search.get("role")).toBe("platform_admin");
    expect(within(table).getByRole("columnheader", { name: /Teams/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("lists teams with agents, sources and storage", async () => {
    mockApi(routes());
    renderApp("/admin/teams?status=active");
    const table = await screen.findByRole("table", { name: "Teams" });
    const row = (await within(table).findByText("Office of the Registrar")).closest("tr")!;
    expect(row).toHaveTextContent("4"); // agents
    expect(row).toHaveTextContent("1.9 MiB");
  });

  it("says Owner invited, not No owner, while the invited owner hasn't signed in (AD-04)", async () => {
    const invited = { ...summary, memberCount: 0, ownerCount: 0, ownerInvites: 1 };
    mockApi(routes("platform_admin", { "GET /v1/admin/teams": () => ({ items: [invited], nextCursor: null }) }));
    renderApp("/admin/teams");
    const table = await screen.findByRole("table", { name: "Teams" });
    expect(await within(table).findByText("Owner invited")).toBeInTheDocument();
    expect(within(table).queryByText("No owner")).toBeNull();
  });

  it("lists open invites on an admin team's Members tab, and platform admins revoke them (AD-04)", async () => {
    const invite = { id: "i1", email: "new.owner@example.edu", role: "owner", createdAt: "2026-10-01T10:00:00Z", expiresAt: "2026-10-31T10:00:00Z" };
    const calls = mockApi(
      routes("platform_admin", {
        "GET /v1/teams/registrar/members": () => [],
        "GET /v1/teams/registrar/invites": () => [invite],
        "DELETE /v1/teams/registrar/invites/i1": () => ({ ok: true }),
      }),
    );
    const { container } = renderApp("/admin/teams/registrar?tab=members");
    const invites = (await screen.findByRole("heading", { name: "Open invites" })).closest("section")!;
    expect(within(invites).getByText("new.owner@example.edu")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(invites).getByRole("button", { name: "Revoke" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke invite" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/teams/registrar/invites/i1")).toBe(true));
  });

  it("shows auditors open invites without Revoke (AD-04)", async () => {
    const invite = { id: "i1", email: "new.owner@example.edu", role: "owner", createdAt: "2026-10-01T10:00:00Z", expiresAt: "2026-10-31T10:00:00Z" };
    mockApi(routes("platform_auditor", { "GET /v1/teams/registrar/invites": () => [invite] }));
    renderApp("/admin/teams/registrar?tab=members");
    const invites = (await screen.findByRole("heading", { name: "Open invites" })).closest("section")!;
    expect(within(invites).getByText("new.owner@example.edu")).toBeInTheDocument();
    expect(within(invites).queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("sums up budget changes in Recent changes, like the audit log", async () => {
    const change = {
      id: 9, occurredAt: "2026-09-26T10:00:00Z", actorKind: "user", actor: { kind: "user", displayName: "Dev Admin" }, action: "costs.budget_update",
      targetType: "team", targetId: team.id, targetLabel: "Office of the Registrar", targetExists: true, metadata: {}, requestId: "r",
      before: { mode: "inherit", amount: "5.000000", warnPercent: null }, after: { mode: "inherit", amount: null, warnPercent: null },
    };
    mockApi(routes("platform_admin", { "GET /v1/teams/registrar/audit": () => ({ items: [change], nextCursor: null }) }));
    renderApp("/admin/teams/registrar");
    const card = (await screen.findByRole("heading", { level: 2, name: "Recent changes" })).closest("section")!;
    expect(await within(card).findByText("Changed a team budget: Monthly budget $5.00 → none")).toBeInTheDocument();
  });

  it("opens a team on its Overview with usage, and archives from the menu (Q12)", async () => {
    const calls = mockApi(routes("platform_admin", { "PATCH /v1/admin/teams/registrar": () => ({ ...summary, team: { ...team, status: "archived" } }) }));
    const { container } = renderApp("/admin/teams/registrar");
    expect(await screen.findByRole("tab", { name: /Overview/, selected: true })).toBeInTheDocument();
    expect(await screen.findByRole("meter", { name: "knowledge_bases" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Archive/ })).toBeNull(); // not a header button
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Archive team…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Archive Office of the Registrar?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive team" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "archived" }));
  });

  it("shows the team's cost tracking and budget on its Overview, and only limits on Limits (I7)", async () => {
    const user = userEvent.setup();
    mockApi(routes());
    const { container } = renderApp("/admin/teams/registrar");
    const card = (await screen.findByRole("heading", { level: 2, name: "Budget" })).closest("section")!;
    expect(within(card).getByText("Cost tracking")).toBeInTheDocument();
    expect(within(card).getByRole("meter")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: /Change budget/ }));
    expect(await screen.findByRole("dialog", { name: "Budget of Office of the Registrar" })).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: "Limits" }));
    expect(screen.getByRole("tab", { name: "Limits", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { level: 2, name: "Budget" })).toBeNull());
    expect(screen.queryByRole("tab", { name: /Budget/ })).toBeNull();
  });

  it("titles the page after the tab it lands on when changes are discarded (AD-38)", async () => {
    const kb = { key: "knowledge_bases", group: "resources", unit: "count", period: "none", label: "Knowledge bases", description: "KBs." } as const;
    mockApi(
      routes("platform_admin", {
        "GET /v1/admin/teams/registrar/limits": () => ({ teamId: "t1", revision: 1, items: [{ ...kb, default: 10, ceiling: null, override: null, effective: 10 }] }),
      }),
    );
    renderApp("/admin/teams/registrar?tab=limits");
    const table = await screen.findByRole("table", { name: "Team resources limits for Office of the Registrar" }, { timeout: 4000 });
    await waitFor(() => expect(document.title).toMatch(/^Limits \u00b7 Office of the Registrar/));
    await userEvent.selectOptions(within(table).getByRole("combobox", { name: "Knowledge bases: team setting" }), "blocked");
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const guard = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    await userEvent.click(within(guard).getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("tab", { name: "Settings", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toMatch(/^Settings \u00b7 Office of the Registrar/));
  });

  it("puts Archive in the Settings danger zone", async () => {
    mockApi(routes());
    renderApp("/admin/teams/registrar?tab=settings");
    expect(await screen.findByText("Danger zone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive team" })).toBeInTheDocument();
  });

  it("speaks to you on your own record, and shows a refusal once (AD-18)", async () => {
    mockApi(
      routes("platform_admin", {
        "GET /v1/admin/users/u1": () => ({ user: user("u1", { platformRole: "platform_admin" }), teams: [] }),
        "GET /v1/admin/audit": () => ({ items: [], nextCursor: null }),
        "PATCH /v1/admin/users/u1": () => Reply.error(409, "last_platform_admin", "The platform needs at least one platform admin."),
      }),
    );
    renderApp("/admin/users/u1");
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: /Platform role/ }), "none");
    const dialog = await screen.findByRole("alertdialog", { name: "Remove your platform role?" });
    expect(within(dialog).getByText(/You'll lose access to the admin portal/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove platform role" }));
    expect(await within(dialog).findByText("The platform needs at least one platform admin.")).toBeInTheDocument();
    expect(screen.getAllByText("The platform needs at least one platform admin.")).toHaveLength(1);
  });

  it("shows the user page as sections with sign-ins hidden in Activity (Q6)", async () => {
    const calls = mockApi(
      routes("platform_admin", {
        "GET /v1/admin/users/u2": () => ({
          user: user("u2"),
          teams: [{ id: "t1", slug: "registrar", name: "Office of the Registrar", status: "active", maxClassification: "sensitive", role: "owner" }],
        }),
        "GET /v1/admin/audit": () => ({ items: [], nextCursor: null }),
      }),
    );
    const { container } = renderApp("/admin/users/u2");
    expect(await screen.findByText("Profile and access")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Teams" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    await waitFor(() => expect(calls.find((c) => c.url === "/v1/admin/audit")?.search.get("excludeAction")).toBe("auth."));
    expect(screen.getByRole("switch", { name: "Hide sign-ins" })).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("orders usage fullest first and leaves out unmeasured limits", () => {
    const rows = usageRows([limit("documents", 40, 1000), limit("knowledge_bases", 9, 10), limit("queries_per_minute", null, 60, "queries"), limit("agents", 1, null)]);
    expect(rows.map((r) => r.key)).toEqual(["knowledge_bases", "documents"]);
  });
});
