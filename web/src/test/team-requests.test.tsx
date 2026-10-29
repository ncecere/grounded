/* In-app team requests (v0.6.0, E3): the person's page, the admin queue and its dialogs, the Features switch, and the entry points. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { areaOf, entryTitle } from "../components/audit/labels";
import { type Handler, Reply, meFor, mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const req = (extra: Partial<Schemas["TeamRequest"]> = {}): Schemas["TeamRequest"] => ({
  id: "r1",
  name: "Library tech",
  purpose: "Run library technology together.",
  ownerEmail: "",
  classification: "open",
  approvedClassification: "",
  status: "pending",
  decisionReason: "",
  decidedAt: null,
  teamSlug: "",
  teamName: "",
  revision: 1,
  createdAt: "2026-10-15T09:00:00Z",
  ...extra,
});
const mineOf = (extra: Partial<Schemas["TeamRequestsOverview"]> = {}): Schemas["TeamRequestsOverview"] => ({
  enabled: true,
  canAsk: true,
  blocked: "",
  maxOpen: 2,
  openCount: 1,
  items: [req()],
  ...extra,
});
const adminReq = (extra: Partial<Schemas["AdminTeamRequest"]> = {}): Schemas["AdminTeamRequest"] => ({
  ...req(),
  requesterId: "u9",
  requesterEmail: "sam@example.edu",
  requesterName: "Sam Student",
  deciderEmail: "",
  ownerSuspended: false,
  ...extra,
});
const settings = (extra: Partial<Schemas["TeamRequestSettings"]> = {}): Schemas["TeamRequestSettings"] => ({ enabled: true, maxOpen: 2, allowedGroup: "", revision: 4, updatedAt: "2026-10-15T08:00:00Z", ...extra });

const noTeamMe = (teamRequests: boolean) => ({ ...meFor("none"), teams: [], capabilities: { platformAdmin: false, platformAuditor: false, teamRequests } });

describe("Request a team (the person's page)", () => {
  it("lists the person's requests with their outcome, and asks for a team with every field checked first", async () => {
    const calls = mockApi({
      ...shellRoutes("none"),
      "GET /v1/team-requests": () => mineOf({ items: [req(), req({ id: "r2", name: "Done team", status: "approved", teamSlug: "done", teamName: "Done team", decidedAt: "2026-10-14T09:00:00Z" }), req({ id: "r3", name: "No thanks", status: "declined", decisionReason: "A team already covers this", decidedAt: "2026-10-14T09:00:00Z" })] }),
      "POST /v1/team-requests": () => new Reply(201, { data: req({ id: "r9", name: "Reading room" }) }),
    });
    const { container } = renderApp("/team-requests");
    const table = await screen.findByRole("table", { name: "Your team requests" }, { timeout: scaled(5000) });
    expect(await within(table).findByRole("row", { name: /Library tech/ })).toHaveTextContent("Waiting for review");
    expect(within(table).getByRole("row", { name: /Done team/ })).toHaveTextContent("Open Done team");
    expect(within(table).getByRole("row", { name: /No thanks/ })).toHaveTextContent("A team already covers this");
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("button", { name: "New request" }));
    const dialog = await screen.findByRole("dialog", { name: "Request a team" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findByText("Enter a name.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Say what the team is for/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Choose the highest classification/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    await userEvent.type(within(dialog).getByRole("textbox", { name: "Team name" }), "Reading room");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What is it for/ }), "Quiet study technology.");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /Highest classification/ }), "Sensitive");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Owner/ }), "casey@example.edu");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Request a team" })).toBeNull());
    expect(calls.find((c) => c.method === "POST" && c.url === "/v1/team-requests")?.body).toEqual({
      name: "Reading room",
      purpose: "Quiet study technology.",
      classification: "sensitive",
      ownerEmail: "casey@example.edu",
    });
  });

  it("says why the person cannot ask: the feature is off, an SSO group is required, or the limit is reached; and keeps their requests", async () => {
    for (const [overview, text] of [
      [mineOf({ enabled: false, canAsk: false, blocked: "off" }), /Team requests aren't turned on here/],
      [mineOf({ canAsk: false, blocked: "group" }), /Your account isn't allowed to request a team/],
      [mineOf({ canAsk: false, blocked: "limit", openCount: 2 }), /You have as many open requests as allowed/],
    ] as const) {
      mockApi({ ...shellRoutes("none"), "GET /v1/team-requests": () => overview });
      const { unmount } = renderApp("/team-requests");
      expect(await screen.findByText(text, undefined, { timeout: scaled(5000) })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New request" })).toBeDisabled();
      expect(await screen.findByRole("row", { name: /Library tech/ })).toBeInTheDocument();
      unmount();
    }
  });

  it("withdraws a pending request after confirmation, and Cancel withdraws nothing", async () => {
    const calls = mockApi({
      ...shellRoutes("none"),
      "GET /v1/team-requests": () => mineOf(),
      "POST /v1/team-requests/r1/withdraw": () => ({ ok: true }),
    });
    renderApp("/team-requests");
    const table = await screen.findByRole("table", { name: "Your team requests" }, { timeout: scaled(5000) });
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Library tech" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Withdraw…" }));
    let dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/withdraw"))).toBe(false);
    await userEvent.click(within(table).getByRole("button", { name: "Actions for Library tech" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Withdraw…" }));
    dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw request" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/v1/team-requests/r1/withdraw")).toHaveLength(1));
  });
});

describe("the way into an approved team", () => {
  it("offers Open team only when the person owns it, and says who does when they named someone else (#136)", async () => {
    const approved = (id: string, name: string, ownerEmail: string) =>
      req({ id, name, status: "approved", teamSlug: id, teamName: name, ownerEmail, decidedAt: "2026-10-14T09:00:00Z" });
    mockApi({
      ...shellRoutes("none"),
      "GET /v1/team-requests": () =>
        mineOf({ items: [approved("own", "Mine", ""), approved("named-me", "Named me", "Una@Example.edu"), approved("other", "Casey's", "casey@localhost")] }),
    });
    renderApp("/team-requests");
    const table = await screen.findByRole("table", { name: "Your team requests" }, { timeout: scaled(5000) });
    const row = async (name: RegExp) => within(table).findByRole("row", { name });
    expect(await row(/Mine/)).toHaveTextContent("Open Mine");
    expect(await row(/Named me/)).toHaveTextContent("Open Named me"); // their own address, in any case
    const other = await row(/Casey's/);
    expect(other).toHaveTextContent("Owned by casey@localhost");
    expect(within(other).queryByRole("link", { name: /Open Casey's/ })).toBeNull();
    // The row menu (its only item for an approved request is Open team) is there for their own team and absent for the other.
    expect(within(await row(/Mine/)).getByRole("button")).toBeInTheDocument();
    expect(within(other).queryByRole("button")).toBeNull();
  });
});

describe("entry points", () => {
  it("Home offers the in-app page to someone without a team while it is on, and the outside link while it is off", async () => {
    mockApi({ ...shellRoutes("none"), "GET /v1/me": () => noTeamMe(true), "GET /v1/auth/config": () => ({ oidcEnabled: false, devAuthEnabled: true, loginUrl: "/auth/login", teamRequestUrl: "https://forms.example.edu/team", devAccounts: [] }) });
    const on = renderApp("/");
    const link = await screen.findByRole("link", { name: "Request a new team" }, { timeout: scaled(5000) });
    expect(link).toHaveAttribute("href", "/team-requests");
    on.unmount();

    mockApi({ ...shellRoutes("none"), "GET /v1/me": () => noTeamMe(false), "GET /v1/auth/config": () => ({ oidcEnabled: false, devAuthEnabled: true, loginUrl: "/auth/login", teamRequestUrl: "https://forms.example.edu/team", devAccounts: [] }) });
    renderApp("/");
    const outside = await screen.findByRole("link", { name: "Request a new team" }, { timeout: scaled(5000) });
    expect(outside).toHaveAttribute("href", "https://forms.example.edu/team");
  });
});

const adminRoutes = (role: "platform_admin" | "platform_auditor", extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  ...shellRoutes(role),
  "GET /v1/admin/teams": () => ({ items: [], nextCursor: null }),
  "GET /v1/admin/attention": () => ({ pendingDomainRequests: 0, pendingTeamRequests: 2 }),
  "GET /v1/agent-templates": () => [{ id: "service-desk-faq", name: "Service desk FAQ", description: "", builtIn: true, accentColor: "", welcomeMessage: "", starterQuestions: [], config: {} }],
  "GET /v1/admin/team-requests": () => [
    adminReq(),
    adminReq({ id: "r2", name: "Older", status: "declined", decisionReason: "Not now", decidedAt: "2026-10-14T09:00:00Z", deciderEmail: "admin@example.edu" }),
    adminReq({ id: "r3", name: "Another", requesterName: "Pat", requesterEmail: "pat@example.edu", ownerEmail: "casey@example.edu" }),
  ],
  ...extra,
});

describe("Admin → Teams › Requests", () => {
  it("has the tab with the number waiting, and the sidebar count beside Teams", async () => {
    mockApi(adminRoutes("platform_admin"));
    const { container } = renderApp("/admin/teams?tab=requests");
    await screen.findByRole("tab", { name: /Requests/ }, { timeout: scaled(5000) });
    // Two of the three requests are pending; the count arrives with the queue.
    await waitFor(() => expect(screen.getByRole("tab", { name: /Requests/ })).toHaveTextContent("2"));
    const table = await screen.findByRole("table", { name: "Team requests" });
    expect(await within(table).findByRole("row", { name: /Library tech/ })).toHaveTextContent("Sam Student");
    expect(within(table).getByRole("row", { name: /Older/ })).toHaveTextContent("Declined");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    // The People group is open: it holds the current page.
    await waitFor(() => expect(within(nav).getByRole("link", { name: /Teams/ })).toHaveTextContent("2 pending team requests"));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("approves a request: the address comes from the name, a taken address is said on its field, and the decision carries the revision", async () => {
    let taken = true;
    const calls = mockApi(
      adminRoutes("platform_admin", {
        "POST /v1/admin/team-requests/r1/approve": () =>
          taken ? Reply.error(409, "slug_taken", "A team with that slug already exists") : adminReq({ status: "approved", teamSlug: "library-tech", teamName: "Library Technology", revision: 2, decidedAt: "2026-10-15T10:00:00Z" }),
      }),
    );
    renderApp("/admin/teams?tab=requests");
    const table = await screen.findByRole("table", { name: "Team requests" }, { timeout: scaled(5000) });
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Library tech" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Approve…" }));
    const dialog = await screen.findByRole("dialog", { name: /Approve "Library tech"/ });
    expect(within(dialog).getByRole("textbox", { name: /Address/ })).toHaveValue("library-tech");
    expect(dialog).toHaveTextContent("sam@example.edu");
    expect(within(dialog).getByRole("combobox", { name: /Highest classification/ })).toHaveDisplayValue("Open (requested)");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /First agent/ }), "Service desk FAQ");

    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and create the team" }));
    expect(await within(dialog).findByText("A team with that address already exists.")).toBeInTheDocument();
    taken = false;
    const address = within(dialog).getByRole("textbox", { name: /Address/ });
    await userEvent.clear(address);
    await userEvent.type(address, "library-tech-2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and create the team" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Approve/ })).toBeNull());
    const sent = calls.filter((c) => c.method === "POST" && c.url === "/v1/admin/team-requests/r1/approve").at(-1)!;
    expect(sent.body).toEqual({ slug: "library-tech-2", name: "Library tech", maxClassification: "open", starterTemplateId: "service-desk-faq" });
    expect(sent.headers.get("If-Match")).toBe('"1"');
  });

  it("declines a request only with a reason, shows the named owner, and lets Cancel decide nothing", async () => {
    const calls = mockApi(adminRoutes("platform_admin", { "POST /v1/admin/team-requests/r3/decline": () => adminReq({ id: "r3", status: "declined" }) }));
    renderApp("/admin/teams?tab=requests");
    const table = await screen.findByRole("table", { name: "Team requests" }, { timeout: scaled(5000) });
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Another" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Decline…" }));
    const dialog = await screen.findByRole("dialog", { name: /Decline "Another"/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    expect(await within(dialog).findByText(/Say why/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Use the existing team");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Decline/ })).toBeNull());
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    await userEvent.click(within(table).getByRole("button", { name: "Actions for Another" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "View…" }));
    const view = await screen.findByRole("dialog", { name: "Another" });
    expect(within(view).getByRole("textbox", { name: "Owner" })).toHaveValue("casey@example.edu");
    expect(within(view).getByRole("textbox", { name: "Purpose" })).toHaveValue("Run library technology together.");
    await userEvent.click(within(view).getAllByRole("button", { name: "Close" }).at(-1)!);

    await userEvent.click(within(table).getByRole("button", { name: "Actions for Another" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Decline…" }));
    const again = await screen.findByRole("dialog", { name: /Decline "Another"/ });
    await userEvent.type(within(again).getByRole("textbox", { name: "Reason" }), "Use the existing team");
    await userEvent.click(within(again).getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/v1/admin/team-requests/r3/decline")).toHaveLength(1));
    expect(calls.find((c) => c.url === "/v1/admin/team-requests/r3/decline")?.body).toEqual({ reason: "Use the existing team" });
  });

  it("is read only for an auditor, and a decided request can only be viewed", async () => {
    mockApi(adminRoutes("platform_auditor"));
    renderApp("/admin/teams?tab=requests");
    const table = await screen.findByRole("table", { name: "Team requests" }, { timeout: scaled(5000) });
    expect(await screen.findByText(/Auditors can view team requests/)).toBeInTheDocument();
    await userEvent.click(await within(table).findByRole("button", { name: "Actions for Library tech" }));
    expect(await screen.findByRole("menuitem", { name: "View…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Approve…" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Decline…" })).toBeNull();
  });
});

describe("Admin → Settings › Features › Team requests", () => {
  const featureRoutes = (role: "platform_admin" | "platform_auditor", st = settings()): Record<string, Handler> => ({
    ...shellRoutes(role),
    "GET /v1/admin/settings/team-requests": () => st,
  });

  it("turns the feature on, and asks before turning it off", async () => {
    const calls = mockApi({
      ...featureRoutes("platform_admin", settings({ enabled: false })),
      "PUT /v1/admin/settings/team-requests": (b) => settings({ ...(b as object), revision: 5 }),
    });
    renderApp("/admin/settings");
    const sw = await screen.findByRole("switch", { name: "Allow team requests" }, { timeout: scaled(5000) });
    expect(sw).not.toBeChecked();
    await userEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ enabled: true, maxOpen: 2, allowedGroup: "" });
    expect(calls.find((c) => c.method === "PUT")?.headers.get("If-Match")).toBe('"4"');
    await waitFor(() => expect(screen.getByRole("switch", { name: "Allow team requests" })).toBeChecked());

    await userEvent.click(screen.getByRole("switch", { name: "Allow team requests" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Requests already open stay in the queue");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    await userEvent.click(screen.getByRole("switch", { name: "Allow team requests" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Turn team requests off" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "PUT").at(-1)?.body).toMatchObject({ enabled: false });
  });

  it("sets who may ask: a number from 1 to 20 and an optional SSO group", async () => {
    const calls = mockApi({ ...featureRoutes("platform_admin"), "PUT /v1/admin/settings/team-requests": (b) => settings({ ...(b as object), revision: 5 }) });
    renderApp("/admin/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Who may ask…" }, { timeout: scaled(5000) }));
    const dialog = await screen.findByRole("dialog", { name: "Who may ask for a team" });
    const max = within(dialog).getByRole("spinbutton", { name: /Open requests per person/ });
    await userEvent.clear(max);
    await userEvent.type(max, "25");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Enter a whole number from 1 to 20.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    await userEvent.clear(max);
    await userEvent.type(max, "3");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /SSO group/ }), "Library-Staff");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ enabled: true, maxOpen: 3, allowedGroup: "Library-Staff" });
  });

  it("is read only for an auditor", async () => {
    mockApi(featureRoutes("platform_auditor"));
    renderApp("/admin/settings");
    const sw = await screen.findByRole("switch", { name: "Allow team requests" }, { timeout: scaled(5000) });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Who may ask…" })).toBeNull();
  });
});

describe("audit log wording", () => {
  it("names the team request actions and their area", () => {
    const e = (action: string) => ({ action, after: null, targetLabel: "Library tech" });
    expect(entryTitle(e("team_request.create"))).toBe("Asked for a team: Library tech");
    expect(entryTitle(e("team_request.approve"))).toBe("Approved a team request: Library tech");
    expect(entryTitle(e("team_request.decline"))).toBe("Declined a team request: Library tech");
    expect(entryTitle(e("team_request.withdraw"))).toBe("Withdrew a team request: Library tech");
    expect(areaOf("team_request.approve")).toBe("Team requests");
  });
});
