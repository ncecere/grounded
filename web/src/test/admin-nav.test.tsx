/*
 * The admin sidebar after the v0.2.1 regroup (docs/v0.2.1.md I1): Overview and
 * 7 groups of 23 items (MCP servers joined Models in v0.3, Reranking in v0.4.2), remembered open groups from before the regroup, and ⌘K reaching
 * the pages that became tabs (Profile migrations, Legal holds).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { currentGroups } from "../components/layout/admin-groups";
import { adminNav, adminSections } from "../components/layout/nav";
import { mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const expected: [string | undefined, string[]][] = [
  [undefined, ["Overview"]],
  ["People", ["Users", "Teams", "SSO groups"]],
  ["Content", ["Shared sources", "Agents", "Crawl domains", "Parsing & OCR"]],
  ["Models", ["Connections", "Models", "Embedding profiles", "MCP servers", "SystemOne", "Reranking"]],
  ["Usage & spend", ["Analytics", "Costs", "Limits"]],
  ["Safety", ["Classifications", "Moderation", "Public access"]],
  ["Records", ["Logs", "Retention", "Break-glass"]],
  ["Operations", ["Maintenance"]],
];

const routes = () => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/models": () => [{ id: "s1", kind: "systemone", displayName: "Judge", status: "enabled" }],
  "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0 }),
  "GET /v1/agents": () => [],
  "GET /v1/search": () => [],
});

describe("admin sidebar groups (I1)", () => {
  it("has Overview, then 7 groups with 23 items, in the agreed order", () => {
    expect(adminSections.map((s): [string | undefined, string[]] => [s.label, s.items.map((i) => i.label)])).toEqual(expected);
    expect(adminNav).toHaveLength(1 + 23);
  });

  it("shows every group's items once opened, and opens only the current page's group by itself", async () => {
    const user = userEvent.setup();
    mockApi({ ...routes(), "GET /v1/admin/audit": () => ({ items: [], nextCursor: null }) });
    const { container } = renderApp("/admin/logs");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(await within(nav).findByRole("link", { name: "Logs" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Records" })).toHaveAttribute("aria-expanded", "true");
    for (const [label, items] of expected.slice(1)) {
      if (label === "Records") continue;
      const header = within(nav).getByRole("button", { name: label! });
      expect(header).toHaveAttribute("aria-expanded", "false");
      await user.click(header);
      await waitFor(() => expect(within(nav).getByRole("link", { name: items[0]! })).toBeInTheDocument());
    }
    for (const [, items] of expected) for (const item of items) expect(within(nav).getByRole("link", { name: item })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Profile migrations" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Legal holds" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps groups remembered before the regroup open under their new names, and the current group open whatever was saved", async () => {
    expect(currentGroups(["People", "Policy", "Monitoring", "Gone"])).toEqual(["People", "Safety", "Usage & spend", "Records"]);
    // Saved with the old labels, and the current page's group (Models) not among them.
    localStorage.setItem("grounded.adminNavOpen", JSON.stringify(["Policy"]));
    mockApi({ ...routes(), "GET /v1/admin/embedding-profiles": () => [], "GET /v1/admin/catalog-usage": () => ({ profiles: [], models: [] }) });
    renderApp("/admin/embedding-profiles?tab=migrations");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(await within(nav).findByRole("link", { name: "Embedding profiles" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Models" })).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("button", { name: "Safety" })).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("button", { name: "Records" })).toHaveAttribute("aria-expanded", "false");
    // The old labels are rewritten.
    expect(JSON.parse(localStorage.getItem("grounded.adminNavOpen") ?? "[]")).toEqual(["Safety"]);
  });
});

describe("⌘K admin pages (I1)", () => {
  async function palette(path: string) {
    const user = userEvent.setup();
    const utils = renderApp(path);
    await screen.findByRole("navigation", { name: "Main" });
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const input = within(dialog).getByRole("combobox", { name: "Command palette" });
    return { ...utils, user, dialog, input };
  }

  it("takes “profile migration” to the Migrations tab of Embedding profiles", async () => {
    mockApi({ ...routes(), "GET /v1/admin/profile-migrations": () => [], "GET /v1/admin/embedding-profiles": () => [], "GET /v1/admin/catalog-usage": () => ({ profiles: [], models: [] }) });
    const { router, user, dialog, input } = await palette("/");
    await user.type(input, "profile migration");
    await user.click(await within(dialog).findByRole("option", { name: /Profile migrations/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/embedding-profiles"));
    expect(router.state.location.search).toEqual({ tab: "migrations" });
    expect(await screen.findByRole("tab", { name: "Migrations", selected: true })).toBeInTheDocument();
  });

  it("takes “legal hold” to the Legal holds tab of Retention", async () => {
    mockApi({ ...routes(), "GET /v1/admin/legal-holds": () => [], "GET /v1/admin/retention": () => null });
    const { router, user, dialog, input } = await palette("/");
    await user.type(input, "legal hold");
    await user.click(await within(dialog).findByRole("option", { name: /Legal holds/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/retention"));
    expect(router.state.location.search).toEqual({ tab: "holds" });
    expect(await screen.findByRole("tab", { name: "Legal holds", selected: true })).toBeInTheDocument();
  });

  it.each([
    ["oauth", /Features/],
    ["setup guide", /Features/],
    ["failing", /Overview/],
    ["connected apps", /Connected apps/],
  ])("finds “%s”", async (text, option) => {
    mockApi(routes());
    const { dialog, input, user } = await palette("/");
    await user.type(input, text);
    expect(await within(dialog).findByRole("option", { name: option })).toBeInTheDocument();
  });
});
