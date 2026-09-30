/*
 * Withdrawing a pending domain request (roadmap J4) on Data sources → Crawl domains: the person who asked,
 * or a team admin or owner, gets "Withdraw request…" in the row menu and on the request's page, with a confirmation.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => vi.unstubAllGlobals());

const request = (id: string, pattern: string, status: string, requestedBy: string) => ({
  id,
  teamId: "t1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  pattern,
  reason: "Partner college publishes our transfer guides.",
  status,
  requestedBy,
  reviewedBy: null,
  requester: { id: requestedBy, displayName: requestedBy === "u1" ? "Una User" : "Blair Dev", email: `${requestedBy}@example.edu` },
  reviewer: null,
  reviewNote: "",
  reviewedAt: null,
  createdAt: "2026-09-20T10:00:00Z",
});

// u1 is the signed-in user (harness meFor).
const mine = request("r1", "docs.example.org", "pending", "u1");
const theirs = request("r2", "wiki.example.org", "pending", "u2");
const approved = request("r3", "news.example.org", "approved", "u1");

function routes(teamRole: string, list = [mine, theirs, approved]) {
  let current = list;
  return {
    ...shellRoutes("none", teamRole),
    "GET /v1/teams/registrar/sources": () => [],
    "GET /v1/teams/registrar/domain-requests": () => current,
    "DELETE /v1/teams/registrar/domain-requests/r1": () => {
      current = current.filter((r) => r.id !== "r1");
      return { ok: true };
    },
  };
}

async function rowMenu(pattern: string) {
  await userEvent.click(await screen.findByRole("button", { name: `Actions for ${pattern}` }));
  return screen.findByRole("menu");
}

describe("withdrawing a domain request (J4)", () => {
  it("lets an editor withdraw their own pending request from its row, after confirming", async () => {
    const calls = mockApi(routes("editor"));
    const { container } = renderApp("/teams/registrar/sources?tab=crawl-domains");
    const table = await screen.findByRole("table", { name: "Domain requests" });
    await waitFor(() => expect(table).toHaveTextContent("docs.example.org"));

    // Someone else's request and an approved one can't be withdrawn by an editor.
    for (const pattern of ["wiki.example.org", "news.example.org"]) {
      const menu = await rowMenu(pattern);
      expect(within(menu).queryByRole("menuitem", { name: "Withdraw request…" })).toBeNull();
      await userEvent.keyboard("{Escape}");
    }

    const menu = await rowMenu("docs.example.org");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Withdraw request…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Withdraw the request for docs.example.org?" });
    expect(dialog).toHaveTextContent("Platform admins will no longer see it.");
    expect(await axe(dialog)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw request" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/teams/registrar/domain-requests/r1")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("table", { name: "Domain requests" })).not.toHaveTextContent("docs.example.org"));
    expect(await screen.findByText("Request withdrawn")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("withdraws from the request's page and closes it", async () => {
    const calls = mockApi(routes("editor"));
    const { container, router } = renderApp("/teams/registrar/sources?tab=crawl-domains&record=r1");
    expect(await screen.findByRole("heading", { level: 1, name: "docs.example.org" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Withdraw request…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Withdraw the request for docs.example.org?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw request" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: "crawl-domains" }));
    const table = await screen.findByRole("table", { name: "Domain requests" });
    await waitFor(() => expect(table).not.toHaveTextContent("docs.example.org"));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offers a team admin every pending request, and a member only their own", async () => {
    mockApi(routes("admin"));
    const { unmount } = renderApp("/teams/registrar/sources?tab=crawl-domains");
    let menu = await rowMenu("wiki.example.org");
    expect(within(menu).getByRole("menuitem", { name: "Withdraw request…" })).toBeInTheDocument();
    unmount();

    mockApi(routes("member"));
    renderApp("/teams/registrar/sources?tab=crawl-domains");
    menu = await rowMenu("docs.example.org");
    expect(within(menu).getByRole("menuitem", { name: "Withdraw request…" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    menu = await rowMenu("wiki.example.org");
    expect(within(menu).queryByRole("menuitem", { name: "Withdraw request…" })).toBeNull();
  });
});
