/*
 * Phones (below 600px, docs/v0.2.0.md §7): no permanent icon rail (the
 * sidebar is a drawer from the top bar's button), page headers keep only the
 * primary action visible with the rest in "…", and tables start with their
 * low-priority columns hidden.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
beforeEach(() => {
  // A 390px-wide phone: every max-width query up to 48rem matches.
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: /max-width/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("on a phone", () => {
  it("opens the sidebar as a drawer from the top bar, and closes it on navigation", async () => {
    const user = userEvent.setup();
    mockApi({ ...shellRoutes(), "GET /v1/agents": () => [] });
    const { router, container } = renderApp("/");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("complementary", { name: "Workspace sidebar" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    const nav = within(drawer).getByRole("navigation", { name: "Main" });
    // Full labels, not the icon rail.
    expect(within(nav).getByText("Discover agents")).not.toHaveClass("sr-only");
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(within(nav).getByRole("link", { name: "Conversations" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/conversations"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
  });

  it("keeps only the primary action in a page header and moves the rest into …", async () => {
    const user = userEvent.setup();
    mockApi({ ...shellRoutes(), "GET /v1/agents": () => [], "GET /v1/teams/registrar/sources": () => [], "GET /v1/teams/registrar/kbs": () => [], "GET /v1/teams/registrar/agents": () => [] });
    renderApp("/teams/registrar");
    await screen.findByRole("heading", { level: 1, name: "Office of the Registrar" });
    const header = screen.getByRole("heading", { level: 1 }).closest("div[class*=header]") as HTMLElement;
    expect(within(header).queryByRole("link", { name: "Team settings" })).toBeNull();
    await user.click(within(header).getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Team settings" })).toHaveAttribute("href", "/teams/registrar/settings");
  });

  it("starts the Budgets table without its low-priority columns (the Columns menu brings them back)", async () => {
    const status: Schemas["TeamBudgetState"] = {
      mode: "enforce", state: "warning", enforced: true, currency: "USD", month: "2026-09-01", resetsAt: "2026-10-01T04:00:00Z", budget: "100.000000",
      extensions: "0.000000", limit: "100.000000", spent: "85.000000", percent: 85, warnPercent: 80,
    };
    const budgets: Schemas["BudgetList"] = {
      mode: "enforce", currency: "USD", timeZone: "America/New_York", month: "2026-09-01", resetsAt: "2026-10-01T04:00:00Z",
      items: [{ teamId: "t1", teamSlug: "registrar", teamName: "Office of the Registrar", modeOverride: "inherit", ownBudget: true, status, projected: "110.000000" }],
    };
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/models": () => [],
      "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0 }),
      "GET /v1/admin/costs/settings": () => ({ mode: "enforce", currency: "USD", timeZone: "America/New_York", warnPercent: 80, defaultBudget: null, revision: 1, updatedAt: "2026-09-20T10:00:00Z" }),
      "GET /v1/admin/costs/budgets": () => budgets,
    });
    renderApp("/admin/costs?tab=budgets");
    const table = await screen.findByRole("table", { name: /Budgets for September 2026/ });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    for (const shown of ["Team", "Budget this month", "Spent", "State"]) expect(headers.some((h) => h?.startsWith(shown))).toBe(true);
    for (const hidden of ["Mode", "Share", "Projected"]) expect(headers.some((h) => h?.startsWith(hidden))).toBe(false);
  });
});
