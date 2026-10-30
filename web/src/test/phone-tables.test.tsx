/*
 * #140, v0.6.0 QA pass: on a 390px phone the Request a team table and the webhook tables used to sit behind sideways scrolling with the Status
 * pill clipped. Like the Prices table they stack (each row a block, each cell named by its column), so nothing scrolls sideways. A long host
 * pattern wraps inside its cell instead of widening the Approved destinations table.
 */
import { screen, within } from "@testing-library/react";
import type { Schemas } from "../api/client";
import { type Handler, mockApi, renderApp, shellRoutes } from "./harness";
import { catalogRoutes, hook, webhookSettings } from "./webhooks-fixtures";
import { scaled } from "../../test-scale";

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

const slow = { timeout: scaled(5000) };
const headers = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");
const shows = (table: HTMLElement, name: string) => headers(table).some((h) => h.startsWith(name));
const stacked = (table: HTMLElement) => expect(table).toHaveAttribute("data-stack");

const request = (extra: Partial<Schemas["TeamRequest"]> = {}): Schemas["TeamRequest"] => ({
  id: "r1", name: "Library tech", purpose: "Run library technology together.", ownerEmail: "", classification: "open", approvedClassification: "", status: "pending",
  decisionReason: "", decidedAt: null, teamSlug: "", teamName: "", revision: 1, createdAt: "2026-10-15T09:00:00Z", ...extra,
});

describe("tables on a phone (#140)", () => {
  it("Request a team stacks its rows, each cell named by its column", async () => {
    mockApi({
      ...shellRoutes("none"),
      "GET /v1/team-requests": () => ({ enabled: true, canAsk: true, blocked: "", maxOpen: 2, openCount: 1, items: [request()] }),
    });
    renderApp("/team-requests");
    const table = await screen.findByRole("table", { name: "Your team requests" }, slow);
    stacked(table);
    for (const column of ["Team", "Status", "Classification", "Outcome", "Requested"]) expect(shows(table, column)).toBe(true);
    expect(await within(table).findByRole("row", { name: /Library tech/ })).toBeInTheDocument();
  });

  it("the review queue stacks too", async () => {
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
      "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0, pendingTeamRequests: 1 }),
      "GET /v1/admin/team-requests": () => [{ ...request(), requesterId: "u9", requesterEmail: "sam@example.edu", requesterName: "Sam Student", deciderEmail: "", ownerSuspended: false }],
    });
    renderApp("/admin/teams?tab=requests");
    const table = await screen.findByRole("table", { name: "Team requests" }, slow);
    stacked(table);
    expect(shows(table, "Request")).toBe(true);
  });

  it("the webhook list stacks, so the status (on, off or paused) and the secret are on screen", async () => {
    const routes: Record<string, Handler> = {
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
      "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0, pendingTeamRequests: 0 }),
      "GET /v1/admin/settings/webhooks": () => webhookSettings(),
      ...catalogRoutes(),
      "GET /v1/admin/webhooks": () => [hook({ id: "w1", teamId: null, url: "https://hooks.example.edu/platform", events: ["team.created"], enabled: false, pausedReason: "failing" })],
    };
    mockApi(routes);
    renderApp("/admin/webhooks");
    const table = await screen.findByRole("table", { name: "Platform webhooks" }, slow);
    stacked(table);
    for (const column of ["Address", "Events", "Status", "Secret"]) expect(shows(table, column)).toBe(true);
    expect(await within(table).findByRole("row", { name: /hooks\.example\.edu\/platform/ })).toHaveTextContent(/Paused/);
  });

  it("an approved destination's very long pattern is shown whole inside its cell, in a wrapping element", async () => {
    const long = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.example.edu`;
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
      "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0, pendingTeamRequests: 0 }),
      "GET /v1/admin/settings/webhooks": () => webhookSettings(),
      ...catalogRoutes(),
      "GET /v1/webhook-destinations": () => [{ id: "x1", pattern: long, note: "n".repeat(200), createdAt: "2026-10-10T09:00:00Z" }],
      "GET /v1/admin/webhooks": () => [],
    });
    renderApp("/admin/webhooks");
    const table = await screen.findByRole("table", { name: "Approved destinations" }, slow);
    const code = await within(table).findByText(long);
    expect(code).toHaveAttribute("title", long);
    expect(code.className).toMatch(/pattern/);
    stacked(table);
    for (const column of ["Host pattern", "Note", "Approved"]) expect(shows(table, column)).toBe(true);
  });
});
