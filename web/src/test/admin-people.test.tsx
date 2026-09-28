/* Admin users and teams (A4, A7, Q6, Q12): server facets, counts, the team detail page and the user page's sections. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { usageRows } from "../pages/admin/people/team-overview";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";

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
const summary: Schemas["TeamSummary"] = { team, memberCount: 3, ownerCount: 1, agentCount: 4, sourceCount: 2, kbCount: 1, documentCount: 40, storageBytes: 2_000_000 };
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

const routes = (role: "platform_admin" | "platform_auditor" = "platform_admin", extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes(role),
  "GET /v1/admin/users": () => ({ items: [user("u2", { platformRole: "platform_admin" })], nextCursor: null }),
  "GET /v1/admin/teams": () => ({ items: [summary], nextCursor: null }),
  "GET /v1/admin/teams/registrar": () => summary,
  "GET /v1/teams/registrar/limits": () => ({ items: [limit("knowledge_bases", 9, 10), limit("documents", 40, 1000), limit("queries_per_minute", null, 60, "queries")] }),
  "GET /v1/admin/domain-requests": () => [],
  "GET /v1/teams/registrar/audit": () => ({ items: [], nextCursor: null }),
  "GET /v1/teams/registrar/members": () => [{ user: user("u3"), role: "owner", joinedAt: "" }],
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
    expect(row).toHaveTextContent("2 MB");
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

  it("puts Archive in the Settings danger zone", async () => {
    mockApi(routes());
    renderApp("/admin/teams/registrar?tab=settings");
    expect(await screen.findByText("Danger zone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive team" })).toBeInTheDocument();
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
