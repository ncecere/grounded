/* Break-glass (ADR-0024): the admin page, the start form, approvals, the banner, the owners' notice and reading under a session. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { BreakGlassBanner } from "../components/layout/break-glass-banner";
import { durationChoices, startProblems } from "../pages/admin/break-glass/start-dialog";
import { liveGrant, timeLeft } from "../lib/break-glass";
import type { Me } from "../session";
import { meFor, mockApi, renderApp, renderBare, shellRoutes, team } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

type Session = Schemas["BreakGlassSessionDetail"];
const reason = "Investigating support ticket 1234 about wrong answers";
const inAnHour = () => new Date(Date.now() + 60 * 60_000).toISOString();
const pat = { id: "u9", displayName: "Pat Admin", email: "pat@example.edu" };
const una = { id: "u1", displayName: "Una User", email: "una@example.edu" };

const session = (extra: Partial<Session> = {}): Session => ({
  id: "bg1",
  team: { id: "t1", slug: "registrar", name: "Office of the Registrar" },
  requestedBy: una,
  reason,
  scopes: ["documents"],
  durationMinutes: 60,
  status: "active",
  requestedAt: "2026-09-27T09:00:00Z",
  approvalDeadline: null,
  decidedBy: null,
  decidedAt: null,
  decisionNote: "",
  startedAt: "2026-09-27T09:00:00Z",
  expiresAt: inAnHour(),
  endedAt: null,
  endedBy: null,
  reads: [],
  ...extra,
});

const settings = (extra: Partial<Schemas["BreakGlassSettings"]> = {}): Schemas["BreakGlassSettings"] => ({
  approvalRequired: false,
  maxDurationMinutes: 480,
  approvalTimeoutMinutes: 60,
  defaultDurationMinutes: 60,
  minReasonLength: 20,
  updatedAt: "2026-09-27T09:00:00Z",
  updatedBy: null,
  revision: 1,
  ...extra,
});

const adminRoutes = (open: Session[], all: Session[] = open) => ({
  ...shellRoutes("platform_admin"),
  "GET /v1/admin/settings/break-glass": () => settings(),
  "GET /v1/admin/break-glass": (_: unknown, c: { search: URLSearchParams }) => ({ items: c.search.get("state") === "open" ? open : all, nextCursor: null }),
  "GET /v1/admin/teams": () => ({ items: [{ team, memberCount: 3, sourceCount: 1, kbCount: 1, agentCount: 1, documentCount: 4, storageBytes: 10 }], nextCursor: null }),
});

describe("Admin → Break-glass", () => {
  it("lists open sessions with requests first; another admin approves a request from its sheet", async () => {
    const pending = session({ id: "bg2", requestedBy: pat, status: "pending", startedAt: null, expiresAt: null, approvalDeadline: inAnHour() });
    const calls = mockApi({
      ...adminRoutes([session(), pending], [pending, session({ id: "bg0", status: "ended", endedAt: "2026-09-26T10:00:00Z", endedBy: una })]),
      "GET /v1/admin/break-glass/bg2": () => pending,
      "GET /v1/admin/break-glass/bg2/reads": () => ({ items: [], nextCursor: null }),
      "POST /v1/admin/break-glass/bg2/approve": () => session({ id: "bg2", requestedBy: pat, decidedBy: una }),
    });
    const { container } = renderApp("/admin/break-glass");
    const open = await screen.findByRole("table", { name: /Open break-glass sessions, 1 waiting for approval/ });
    const rows = within(open).getAllByRole("row");
    expect(rows[1]!).toHaveTextContent("Waiting for approval");
    expect(rows[2]!).toHaveTextContent(/minutes left|h .* left/);
    expect(await screen.findByText("Ended")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(rows[1]!).getByRole("button", { name: /Open the session on Office of the Registrar by Pat Admin/ }));
    const sheet = await screen.findByRole("region", { name: "Break-glass: Office of the Registrar" });
    expect(within(sheet).getByText(reason)).toBeInTheDocument();
    expect(within(sheet).getByText("Nothing was read.")).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    await userEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/v1/admin/break-glass/bg2/approve")).toBe(true));
  });

  it("can't approve your own request: you can only withdraw it", async () => {
    const mine = session({ status: "pending", startedAt: null, expiresAt: null, approvalDeadline: inAnHour() });
    mockApi({
      ...adminRoutes([mine]),
      "GET /v1/admin/break-glass/bg1": () => mine,
      "GET /v1/admin/break-glass/bg1/reads": () => ({ items: [], nextCursor: null }),
    });
    renderApp("/admin/break-glass?record=bg1");
    const sheet = await screen.findByRole("region", { name: "Break-glass: Office of the Registrar" });
    expect(await within(sheet).findByRole("button", { name: "Withdraw request" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("starts a session with a team, a reason, a scope and a duration", async () => {
    const calls = mockApi({
      ...adminRoutes([]),
      "POST /v1/admin/break-glass": () => session(),
      "GET /v1/admin/break-glass/bg1": () => session(),
      "GET /v1/admin/break-glass/bg1/reads": () => ({ items: [], nextCursor: null }),
    });
    const { container } = renderApp("/admin/break-glass");
    await userEvent.click(await screen.findByRole("button", { name: "Start a session" }));
    const dialog = await screen.findByRole("dialog", { name: "Start a break-glass session" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Start session" }));
    expect(await within(dialog).findByText("Choose a team.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Give a reason of at least 20 characters/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();

    await userEvent.type(within(dialog).getByRole("combobox", { name: "Team" }), "Regis");
    await userEvent.click(await screen.findByRole("option", { name: /Office of the Registrar/ }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), reason);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Documents/ }));
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Duration" }), "120");
    await userEvent.click(within(dialog).getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ team: "registrar", reason, scopes: ["documents"], durationMinutes: 120 }));
  });

  it("saves the approval setting with If-Match; auditors can't change it", async () => {
    const calls = mockApi({ ...adminRoutes([]), "PUT /v1/admin/settings/break-glass": (b) => settings({ ...(b as object), revision: 2 }) });
    const first = renderApp("/admin/break-glass?tab=settings");
    const { container } = first;
    const sw = await screen.findByRole("switch", { name: "Require a second admin's approval" });
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(sw);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Requests lapse after" }), "30");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ approvalRequired: true, maxDurationMinutes: 480, approvalTimeoutMinutes: 30 }));
    expect(calls.find((c) => c.method === "PUT")!.headers.get("If-Match")).toBe('"1"');

    first.unmount();
    vi.unstubAllGlobals();
    mockApi({ ...adminRoutes([]), ...shellRoutes("platform_auditor") });
    renderApp("/admin/break-glass?tab=settings");
    expect(await screen.findByRole("switch", { name: "Require a second admin's approval" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the break-glass banner", () => {
  it("shows the reading admin the team, the time left and End now", async () => {
    const calls = mockApi({ "GET /v1/me/break-glass": () => [session({ scopes: ["conversations", "documents"] })], "POST /v1/admin/break-glass/bg1/end": () => session({ status: "ended" }) });
    const { container } = renderBare(<BreakGlassBanner me={meFor("platform_admin") as unknown as Me} />, meFor("platform_admin"));
    const title = await screen.findByText("Break-glass: you can read Office of the Registrar's conversations and documents");
    const banner = title.closest("[role=status]") as HTMLElement;
    expect(banner).toHaveTextContent(/5\d minutes left|1 h left/);
    expect(within(banner).getByRole("link", { name: "Documents" })).toHaveAttribute("href", "/teams/registrar/sources");
    expect(within(banner).getByRole("link", { name: "Conversations" })).toHaveAttribute("href", "/admin/break-glass/bg1/conversations");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(banner).getByRole("button", { name: "End now" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/v1/admin/break-glass/bg1/end")).toBe(true));
  });

  it("isn't fetched for anyone but platform admins, and hides a session past its end", async () => {
    const calls = mockApi({ "GET /v1/me/break-glass": () => [session({ expiresAt: new Date(Date.now() - 1000).toISOString() })] });
    const owner = renderBare(<BreakGlassBanner me={meFor("none") as unknown as Me} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(owner.container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(0);
    const admin = renderBare(<BreakGlassBanner me={meFor("platform_admin") as unknown as Me} />, meFor("platform_admin"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(admin.container).toBeEmptyDOMElement();
  });
});

describe("team pages under break-glass", () => {
  it("tells the team's owners who is reading, why and until when", async () => {
    mockApi({ ...shellRoutes("none", "owner"), "GET /v1/teams/registrar/break-glass": () => [session({ requestedBy: pat })], "GET /v1/teams/registrar/sources": () => [], "GET /v1/teams/registrar/kbs": () => [], "GET /v1/teams/registrar/agents": () => [] });
    const { container } = renderApp("/teams/registrar/sources");
    const notice = (await screen.findByText("A platform admin can read this team's documents")).closest("[role=status]") as HTMLElement;
    expect(notice).toHaveTextContent("Pat Admin (pat@example.edu) has break-glass access until");
    expect(notice).toHaveTextContent(`Reason given: ${reason}`);
    expect(within(notice).getByRole("link", { name: "See what was read" })).toHaveAttribute("href", "/teams/registrar/settings?tab=audit");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens a team's data sources to a platform admin only with a documents session", async () => {
    const admin = { ...meFor("platform_admin"), teams: [] };
    const routes = { ...shellRoutes("platform_admin"), "GET /v1/me": () => admin, "GET /v1/teams/registrar": () => ({ team }), "GET /v1/teams/registrar/sources": () => [] };
    mockApi({ ...routes, "GET /v1/me/break-glass": () => [session({ scopes: ["conversations"] })] });
    const locked = renderApp("/teams/registrar/sources");
    expect(await screen.findByText("Only team members can see this")).toBeInTheDocument();
    locked.unmount();

    vi.unstubAllGlobals();
    mockApi({ ...routes, "GET /v1/me/break-glass": () => [session()] });
    const { container } = renderApp("/teams/registrar/sources");
    expect(await screen.findByText(/reading this team's data sources under break-glass/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New data source" })).toBeNull();
    expect((await screen.findAllByRole("link", { name: "Data sources" })).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("lists a team's conversations and opens a transcript under a conversations session", async () => {
    const s = session({ scopes: ["conversations"] });
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/break-glass/bg1": () => s,
      "GET /v1/me/break-glass": () => [s],
      "GET /v1/teams/registrar/conversations": () => ({
        items: [{ id: "c1", agentId: "a1", agentName: "Registrar Help", agentSlug: "help", teamSlug: "registrar", agentDeleted: false, title: "Parking permits", anonymous: false, questions: 2, createdAt: "2026-09-27T08:00:00Z", updatedAt: "2026-09-27T08:05:00Z" }],
        nextCursor: null,
      }),
      "GET /v1/conversations/c1": () => ({
        conversation: { id: "c1", agentId: "a1", agentName: "Registrar Help", agentSlug: "help", teamSlug: "registrar", agentDeleted: false, title: "Parking permits", createdAt: "2026-09-27T08:00:00Z", updatedAt: "2026-09-27T08:05:00Z" },
        messages: [
          { id: "m1", seq: 1, role: "user", text: "Where do I buy a permit?", createdAt: "2026-09-27T08:00:00Z" },
          { id: "m2", seq: 2, role: "assistant", text: "From Transportation Services.", citations: [{ n: 1, title: "Parking" }], createdAt: "2026-09-27T08:00:05Z" },
        ],
      }),
    });
    const { container } = renderApp("/admin/break-glass/bg1/conversations");
    const row = await screen.findByText("Parking permits");
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Break-glass" })).toHaveAttribute("href", "/admin/break-glass");
    expect(crumbs).toHaveTextContent("Conversations");
    await userEvent.click(row);
    const sheet = await screen.findByRole("region", { name: "Parking permits" });
    expect(within(sheet).getByText("Where do I buy a permit?")).toBeInTheDocument();
    expect(within(sheet).getByText("Sources: [1] Parking")).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    // Each read is audited on the server: nothing is fetched twice by itself.
    expect(calls.filter((c) => c.url === "/v1/teams/registrar/conversations")).toHaveLength(1);
  });
});

describe("break-glass helpers", () => {
  it("validates the start form and offers durations up to the maximum", () => {
    expect(startProblems({ team: "", reason: "short", scopes: [], duration: 60 }, 20)).toEqual({
      team: "Choose a team.",
      reason: "Give a reason of at least 20 characters: the team's owners see it.",
      scopes: "Choose what you need to read.",
    });
    expect(startProblems({ team: "registrar", reason, scopes: ["documents"], duration: 60 }, 20)).toEqual({});
    expect(durationChoices(90)).toEqual([15, 30, 60, 90]);
    expect(durationChoices(480)).toEqual([15, 30, 60, 120, 240, 480]);
  });

  it("counts down and finds a live grant by team and scope", () => {
    const now = Date.parse("2026-09-27T10:00:00Z");
    expect(timeLeft("2026-09-27T10:42:30Z", now)).toBe("42 minutes left");
    expect(timeLeft("2026-09-27T11:05:00Z", now)).toBe("1 h 5 min left");
    expect(timeLeft("2026-09-27T10:00:30Z", now)).toBe("Less than a minute left");
    const s = session({ expiresAt: "2026-09-27T11:00:00Z" });
    expect(liveGrant([s], "registrar", "documents", now)).toBe(s);
    expect(liveGrant([s], "registrar", "conversations", now)).toBeUndefined();
    expect(liveGrant([s], "other", undefined, now)).toBeUndefined();
    expect(liveGrant([s], "registrar", "documents", Date.parse("2026-09-27T11:00:00Z"))).toBeUndefined();
  });
});
