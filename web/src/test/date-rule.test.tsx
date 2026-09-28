/* One date rule (G13): lists show relative times with the full date on hover; record pages show absolute dates; no ISO dates. */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { dayLabel } from "../components/analytics/format";
import { CrawlingPage } from "../pages/admin/crawling/page";
import { mockApi, renderApp, shellRoutes } from "./harness";
import { mockApi as mockWebApi, renderWith } from "./web-harness";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000 + 3_600_000).toISOString();

/** A relative <time> with the full date as its title. */
function expectRelative(el: HTMLElement, text: RegExp) {
  const time = el.querySelector("time");
  expect(time).not.toBeNull();
  expect(time).toHaveTextContent(text);
  expect(time!.getAttribute("title")).toMatch(/\d{4}/);
}

describe("the date rule (G13)", () => {
  it("Home's recent conversations show when, relatively", async () => {
    const conv = { id: "c1", agentId: "ag1", agentName: "Registrar help", agentSlug: "registrar-help", teamSlug: "registrar", agentDeleted: false, title: "Dropping", createdAt: ago(3), updatedAt: ago(3) };
    mockApi({ ...shellRoutes(), "GET /v1/conversations": () => ({ items: [conv], nextCursor: null }), "GET /v1/agents": () => [] });
    const { container } = renderApp("/");
    // The card's link (the sidebar lists it too, without a date).
    const card = (await screen.findByText("Continue where you left off")).closest("section, [class*=card]") as HTMLElement;
    expectRelative(await within(card).findByRole("link", { name: /Dropping/ }), /3 days ago/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("open invites say when they expire, relatively", async () => {
    mockApi({
      ...shellRoutes(),
      "GET /v1/teams/registrar/members": () => [],
      "GET /v1/teams/registrar/invites": () => [{ id: "i1", email: "new@example.edu", role: "member", expiresAt: ahead(3), createdAt: ago(0) }],
    });
    renderApp("/teams/registrar/settings?tab=members");
    const table = await screen.findByRole("table", { name: "Open invites" });
    expectRelative(within(table).getAllByRole("row")[1]!, /in 3 days/);
  });

  it("the crawl allowlist shows when an entry was added, relatively", async () => {
    mockWebApi({
      "GET /v1/admin/crawl-allowlist": () => [{ id: "a1", pattern: "*.example.edu", note: "", createdBy: null, createdAt: ago(2) }],
      "GET /v1/admin/domain-requests": () => [],
    });
    renderWith(<CrawlingPage />, { platformRole: "platform_admin" });
    await userEvent.click(await screen.findByRole("tab", { name: "Allowlist" }));
    const table = await screen.findByRole("table", { name: "Crawl allowlist" });
    expectRelative(within(table).getAllByRole("row")[1]!, /2 days ago/);
  });

  it("analytics days read as dates, not ISO", () => {
    expect(dayLabel("2026-09-26")).toBe("Sep 26, 2026");
    expect(dayLabel("not a day")).toBe("not a day");
  });
});
