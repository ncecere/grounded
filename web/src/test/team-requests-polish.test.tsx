/* #140: a request decided by someone else closes the Approve and Decline dialogs; /team-requests is named in the breadcrumb and title; Withdraw promises "ask again" only when asking is possible. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Schemas } from "../api/client";
import { type Handler, Reply, mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const req = (extra: Partial<Schemas["TeamRequest"]> = {}): Schemas["TeamRequest"] => ({
  id: "r1", name: "Library tech", purpose: "Run library technology together.", ownerEmail: "", classification: "open", approvedClassification: "", status: "pending",
  decisionReason: "", decidedAt: null, teamSlug: "", teamName: "", revision: 1, createdAt: "2026-10-15T09:00:00Z", ...extra,
});
const adminReq = (extra: Partial<Schemas["AdminTeamRequest"]> = {}): Schemas["AdminTeamRequest"] => ({
  ...req(), requesterId: "u9", requesterEmail: "sam@example.edu", requesterName: "Sam Student", deciderEmail: "", ownerSuspended: false, ...extra,
});
const mineOf = (extra: Partial<Schemas["TeamRequestsOverview"]> = {}): Schemas["TeamRequestsOverview"] => ({ enabled: true, canAsk: true, blocked: "", maxOpen: 2, openCount: 1, items: [req()], ...extra });

const adminRoutes = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
  "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0, pendingTeamRequests: 1 }),
  "GET /v1/agent-templates": () => [],
  "GET /v1/admin/team-requests": () => [adminReq()],
  ...extra,
});

async function openAction(action: string) {
  const table = await screen.findByRole("table", { name: "Team requests" }, { timeout: scaled(5000) });
  await userEvent.click(await within(table).findByRole("button", { name: "Actions for Library tech" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: action }));
}

describe("a request someone else decided first", () => {
  it("closes the Approve dialog, refreshes the queue and says why", async () => {
    const calls = mockApi(adminRoutes({ "POST /v1/admin/team-requests/r1/approve": () => Reply.error(409, "request_already_decided", "This request was already decided or withdrawn") }));
    renderApp("/admin/teams?tab=requests");
    await openAction("Approve…");
    const dialog = await screen.findByRole("dialog", { name: /Approve "Library tech"/ });
    const queue = () => calls.filter((c) => c.url === "/v1/admin/team-requests" && c.method === "GET").length;
    const before = queue();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and create the team" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Approve/ })).toBeNull());
    expect(await screen.findByText('"Library tech" was already decided')).toBeInTheDocument();
    await waitFor(() => expect(queue()).toBeGreaterThan(before));
  });

  it("closes the Decline dialog too (a changed revision, 412)", async () => {
    const calls = mockApi(adminRoutes({ "POST /v1/admin/team-requests/r1/decline": () => Reply.error(412, "precondition_failed", "stale") }));
    renderApp("/admin/teams?tab=requests");
    await openAction("Decline…");
    const dialog = await screen.findByRole("dialog", { name: /Decline "Library tech"/ });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Use the existing team");
    await userEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Decline/ })).toBeNull());
    expect(await screen.findByText('"Library tech" was already decided')).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/v1/admin/team-requests/r1/decline")).toHaveLength(1);
  });

  it("keeps the dialog open for another error", async () => {
    mockApi(adminRoutes({ "POST /v1/admin/team-requests/r1/decline": () => Reply.error(500, "internal", "Something broke") }));
    renderApp("/admin/teams?tab=requests");
    await openAction("Decline…");
    const dialog = await screen.findByRole("dialog", { name: /Decline "Library tech"/ });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Use the existing team");
    await userEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    expect(await within(dialog).findByText(/Something broke/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Decline/ })).toBeInTheDocument();
  });
});

describe("/team-requests", () => {
  it("is called Team requests in the breadcrumb and the tab title, not Home", async () => {
    mockApi({ ...shellRoutes("none"), "GET /v1/team-requests": () => mineOf() });
    renderApp("/team-requests");
    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" }, { timeout: scaled(5000) });
    await waitFor(() => expect(crumbs).toHaveTextContent(/^Team requests$/));
    expect(crumbs).not.toHaveTextContent("Home");
    await waitFor(() => expect(document.title).toMatch(/^Team requests · /));
  });
});

describe("the Withdraw dialog", () => {
  const withdrawText = async (overview: Schemas["TeamRequestsOverview"]) => {
    mockApi({ ...shellRoutes("none"), "GET /v1/team-requests": () => overview });
    renderApp("/team-requests");
    const table = await screen.findByRole("table", { name: "Your team requests" }, { timeout: scaled(5000) });
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Library tech" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Withdraw…" }));
    return (await screen.findByRole("alertdialog")).textContent ?? "";
  };

  it("says you can ask again when asking is possible, also when only the open-request limit is reached", async () => {
    expect(await withdrawText(mineOf())).toContain("You can ask again afterwards.");
  });
  it("says it for a full limit: withdrawing frees a place", async () => {
    expect(await withdrawText(mineOf({ canAsk: false, blocked: "limit", openCount: 2 }))).toContain("You can ask again afterwards.");
  });
  it("does not say it while the Team requests switch is off", async () => {
    const text = await withdrawText(mineOf({ enabled: false, canAsk: false, blocked: "off" }));
    expect(text).toContain("The platform admins will no longer see it.");
    expect(text).not.toContain("ask again");
  });
  it("does not say it for an account that may not ask", async () => {
    expect(await withdrawText(mineOf({ canAsk: false, blocked: "group" }))).not.toContain("ask again");
  });
});

describe("approving a request whose owner is suspended (#140)", () => {
  const suspended = (extra: Partial<Schemas["AdminTeamRequest"]> = {}) => adminReq({ ownerSuspended: true, ...extra });
  const open = async () => {
    renderApp("/admin/teams?tab=requests");
    await openAction("Approve…");
    return screen.findByRole("dialog", { name: /Approve "Library tech"/ });
  };

  it("warns up front, asks for a different owner and sends nothing without one", async () => {
    const calls = mockApi(adminRoutes({ "GET /v1/admin/team-requests": () => [suspended()] }));
    const dialog = await open();
    expect(within(dialog).getByText("The owner's account is suspended")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/sam@example\.edu is suspended and cannot sign in/);
    const owner = within(dialog).getByRole("textbox", { name: /Owner/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and create the team" }));
    expect(await within(dialog).findByText("Enter the email of a different owner.")).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith("/approve"))).toHaveLength(0);
    // The suspended person cannot be named again.
    await userEvent.type(owner, "Sam@Example.edu");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and create the team" }));
    expect(await within(dialog).findByText("sam@example.edu is the suspended account. Choose a different owner.")).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith("/approve"))).toHaveLength(0);
  });

  it("approves with the explicit owner", async () => {
    const calls = mockApi(adminRoutes({
      "GET /v1/admin/team-requests": () => [suspended()],
      "POST /v1/admin/team-requests/r1/approve": () => adminReq({ status: "approved", teamSlug: "library-tech", teamName: "Library tech", revision: 2, decidedAt: "2026-10-15T10:00:00Z" }),
    }));
    const dialog = await open();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Owner/ }), "casey@example.edu");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and create the team" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Approve/ })).toBeNull());
    const sent = calls.filter((c) => c.url === "/v1/admin/team-requests/r1/approve").at(-1)!;
    expect(sent.body).toEqual({ slug: "library-tech", name: "Library tech", maxClassification: "open", ownerEmail: "casey@example.edu" });
    expect(await screen.findByText("casey@example.edu is its owner.")).toBeInTheDocument();
  });

  it("offers no owner field while the owner is active, and shows it when the server refuses the owner", async () => {
    mockApi(adminRoutes({ "POST /v1/admin/team-requests/r1/approve": () => Reply.error(409, "owner_suspended", "The account that would own this team is suspended: choose a different owner") }));
    const dialog = await open();
    expect(within(dialog).queryByText("The owner's account is suspended")).toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: /Owner/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and create the team" }));
    expect(await within(dialog).findByText("The owner's account is suspended")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Owner/ })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Approve/ })).toBeInTheDocument();
  });
});

describe("the requester's page and the classification (#140)", () => {
  it("shows the level the reviewer approved, and what was asked for when it differs", async () => {
    mockApi({
      ...shellRoutes("none"),
      "GET /v1/team-requests": () => mineOf({ items: [
        req({ id: "a", name: "Raised", status: "approved", classification: "open", approvedClassification: "sensitive", teamSlug: "raised", teamName: "Raised", decidedAt: "2026-10-14T09:00:00Z" }),
        req({ id: "b", name: "Same", status: "approved", classification: "open", approvedClassification: "open", teamSlug: "same", teamName: "Same", decidedAt: "2026-10-14T09:00:00Z" }),
        req({ id: "c", name: "Waiting", classification: "restricted" }),
      ] }),
    });
    renderApp("/team-requests");
    const table = await screen.findByRole("table", { name: "Your team requests" }, { timeout: scaled(5000) });
    const raised = await within(table).findByRole("row", { name: /Raised/ });
    expect(raised).toHaveTextContent("Sensitive");
    expect(raised).toHaveTextContent("Asked for Open");
    const same = within(table).getByRole("row", { name: /Same/ });
    expect(same).toHaveTextContent("Open");
    expect(same).not.toHaveTextContent("Asked for");
    expect(within(table).getByRole("row", { name: /Waiting/ })).toHaveTextContent("Restricted");
  });
});
