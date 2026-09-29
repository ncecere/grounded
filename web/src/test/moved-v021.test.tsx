/*
 * The team pages v0.2.1 moved (docs/v0.2.1.md, I4): Crawl domains is a tab of
 * Data sources (Sources · Crawl domains), and every old address redirects
 * there, keeping an open request (?record=). Team settings keeps five tabs.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

const request = {
  id: "r1",
  teamId: "t1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  pattern: "*.example.org",
  reason: "Partner college publishes our transfer guides.",
  status: "pending",
  requestedBy: "u2",
  requester: { id: "u2", displayName: "Blair Dev", email: "blair@example.edu" },
  reviewNote: "",
  createdAt: "2026-09-20T10:00:00Z",
};

function routes(teamRole = "owner") {
  return {
    ...shellRoutes("none", teamRole),
    "GET /v1/teams/registrar/sources": () => [],
    "GET /v1/teams/registrar/kbs": () => [],
    "GET /v1/teams/registrar/agents": () => [],
    "GET /v1/teams/registrar/domain-requests": () => [request],
  };
}

describe("crawl domains on Data sources (I4)", () => {
  it("shows Sources · Crawl domains as pill tabs, the primary following the tab", async () => {
    mockApi(routes());
    const { container, router } = renderApp("/teams/registrar/sources");
    expect(await screen.findByRole("heading", { level: 1, name: "Data sources" })).toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist", { name: "Data source sections" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Sources", "Crawl domains"]);
    expect(screen.getByRole("button", { name: "New data source" })).toBeInTheDocument();
    expect(screen.getByText(/^Uploaded files or pages from a website/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("tab", { name: "Crawl domains" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: "crawl-domains" }));
    expect(await screen.findByRole("table", { name: "Domain requests" })).toHaveTextContent("*.example.org");
    expect(screen.queryByRole("button", { name: "New data source" })).toBeNull();
    expect(screen.getByRole("button", { name: "Request a domain" })).toBeInTheDocument();
    // The header describes the tab, once: not the Sources text above the Crawl domains text.
    expect(screen.queryByText(/^Uploaded files or pages from a website/)).toBeNull();
    expect(screen.getAllByText(/^Web sources can crawl hosts on the platform allowlist/)).toHaveLength(1);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/Data sources.*Crawl domains/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("redirects Team settings' ?tab=crawl-domains, keeping the open request", async () => {
    mockApi(routes());
    const { router } = renderApp("/teams/registrar/settings?tab=crawl-domains&record=r1");
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/sources"));
    expect(router.state.location.search).toEqual({ tab: "crawl-domains", record: "r1" });
    expect(await screen.findByRole("heading", { level: 1, name: "*.example.org" })).toBeInTheDocument();
  });

  it("redirects the older /teams/:team/domains address", async () => {
    mockApi(routes());
    const { router } = renderApp("/teams/registrar/domains");
    await waitFor(() => expect(router.state.location.pathname).toBe("/teams/registrar/sources"));
    expect(router.state.location.search).toEqual({ tab: "crawl-domains" });
    expect(await screen.findByRole("tab", { name: "Crawl domains", selected: true })).toBeInTheDocument();
  });

  it("keeps Team settings' other tabs where they were", async () => {
    mockApi({ ...routes(), "GET /v1/teams/registrar/api-keys": () => [] });
    const { router } = renderApp("/teams/registrar/settings?tab=api-keys");
    expect(await screen.findByRole("heading", { level: 2, name: "API keys" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/teams/registrar/settings");
  });
});
