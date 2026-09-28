/* Maintenance mode (docs/phase5-deploy.md §5 P5): the admin page, the shell banner and the actions it disables. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { MaintenanceBanner } from "../components/layout/maintenance-banner";
import type { Me } from "../session";
import { SourceDetail } from "../pages/sources/detail";
import { meFor, mockApi, renderApp, renderBare, shellRoutes } from "./harness";
import { common, crawl, mockApi as mockWebApi, renderWith, webRoutes, webSource } from "./web-harness";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

const reason = "Moving to a new embedding model";
const member = (teamRole: string) => meFor("none", teamRole) as unknown as Me;
const off: Schemas["MaintenanceStatus"] = { enabled: false, reason: "", plannedEndAt: null, startedAt: null };
const on: Schemas["MaintenanceStatus"] = { enabled: true, reason, plannedEndAt: "2026-09-28T18:00:00Z", startedAt: "2026-09-27T09:00:00Z" };
const settings = (st: Schemas["MaintenanceStatus"], revision = 1): Schemas["MaintenanceSettings"] => ({
  ...st,
  startedBy: st.enabled ? { id: "u9", displayName: "Pat Admin", email: "pat@example.edu" } : null,
  updatedBy: null,
  updatedAt: "2026-09-27T09:00:00Z",
  revision,
});

describe("Admin → Maintenance", () => {
  it("turns maintenance mode on after a reason and a confirmation that says what pauses, with If-Match", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/admin/settings/maintenance": () => settings(off),
      "PUT /v1/admin/settings/maintenance": (b) => settings({ ...on, ...(b as object), plannedEndAt: null }, 2),
    });
    const { container } = renderApp("/admin/maintenance");
    const sw = await screen.findByRole("switch", { name: "Pause ingestion" });
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText(/Uploads, new web sources, Sync now/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(sw);
    await userEvent.click(await screen.findByRole("button", { name: "Turn on maintenance mode" }));
    expect(await screen.findByText("Give a reason: users see it while maintenance mode is on.", { selector: "span" })).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    await userEvent.type(screen.getByRole("textbox", { name: "Reason" }), reason);
    await userEvent.click(screen.getByRole("button", { name: "Turn on maintenance mode" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Turn on maintenance mode?" });
    expect(within(dialog).getByText(/Scheduled syncs and crawls/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Keeps working: Sign-in, chat/)).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn on maintenance mode" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("If-Match")).toBe('"1"');
    expect(put.body).toEqual({ enabled: true, reason, plannedEndAt: null });
    expect(await screen.findByText(/Turned on .* by Pat Admin/)).toBeInTheDocument();
  });

  it("turns it off without a confirmation; auditors can't change it", async () => {
    const calls = mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/maintenance": () => on,
      "GET /v1/admin/settings/maintenance": () => settings(on),
      "PUT /v1/admin/settings/maintenance": () => settings(off, 2),
    });
    renderApp("/admin/maintenance");
    expect(await screen.findByRole("textbox", { name: "Reason" })).toHaveValue(reason);
    await userEvent.click(screen.getByRole("switch", { name: "Pause ingestion" }));
    expect(screen.getByText("Paused work continues when you save")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn off maintenance mode" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ enabled: false }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("is read-only for auditors", async () => {
    mockApi({ ...shellRoutes("platform_auditor"), "GET /v1/admin/settings/maintenance": () => settings(off) });
    renderApp("/admin/maintenance");
    const sw = await screen.findByRole("switch", { name: "Pause ingestion" });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(sw);
    expect(screen.queryByRole("button", { name: "Turn on maintenance mode" })).toBeNull();
  });
});

describe("the maintenance banner", () => {
  it("shows the reason and planned end to team owners, and a Manage link to platform admins", async () => {
    mockApi({ "GET /v1/maintenance": () => on });
    const { container } = renderBare(<MaintenanceBanner me={member("owner")} />);
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Maintenance: ingestion is paused");
    expect(banner).toHaveTextContent(reason);
    expect(banner).toHaveTextContent(/Planned to end/);
    expect(within(banner).queryByRole("link", { name: "Manage" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("links platform admins to the setting, in the app shell", async () => {
    mockApi({
      ...shellRoutes("platform_admin"),
      "GET /v1/maintenance": () => on,
      "GET /v1/admin/settings/maintenance": () => settings(on),
    });
    renderApp("/admin/maintenance");
    const banner = (await screen.findByText("Maintenance: ingestion is paused")).closest("[role=status]") as HTMLElement;
    expect(within(banner).getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/admin/maintenance");
  });

  it("isn't shown (or fetched) for members, and not while maintenance mode is off", async () => {
    const calls = mockApi({ "GET /v1/maintenance": () => on });
    const { container } = renderBare(<MaintenanceBanner me={member("member")} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(0);

    vi.unstubAllGlobals();
    mockApi({ "GET /v1/maintenance": () => off });
    const editor = renderBare(<MaintenanceBanner me={member("editor")} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(editor.container).toBeEmptyDOMElement();
  });
});

describe("paused actions on a source", () => {
  it("disables Upload files with the reason", async () => {
    mockWebApi({
      ...common,
      "GET /v1/maintenance": () => on,
      "GET /v1/teams/registrar/sources/s1": () => webSource({ type: "upload", web: null, name: "Policies", lastSyncAt: null, nextSyncAt: null }),
      "GET /v1/teams/registrar/sources/s1/documents": () => ({ items: [], nextCursor: null }),
      "GET /v1/teams/registrar/sources/s1/tags": () => [],
      "GET /v1/teams/registrar/kbs": () => [],
    });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const upload = await screen.findByRole("button", { name: "Upload files" });
    await waitFor(() => expect(upload).toBeDisabled());
    expect(upload).toHaveAccessibleDescription(`Uploading is paused for maintenance: ${reason}`);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("disables Sync now with the reason, and says a parked crawl waits for maintenance", async () => {
    mockWebApi({ ...webRoutes(webSource()), "GET /v1/maintenance": () => on });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const sync = await screen.findByRole("button", { name: "Sync now" });
    await waitFor(() => expect(sync).toBeDisabled());
    expect(sync).toHaveAccessibleDescription(`Syncing is paused for maintenance: ${reason}`);
  });

  it("shows a crawl parked for maintenance", async () => {
    mockWebApi({ ...webRoutes(webSource({ activeCrawl: crawl({ waitingReason: "maintenance" }) })), "GET /v1/maintenance": () => on });
    const { container } = renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const panel = await screen.findByRole("region", { name: "Crawl waiting" });
    expect(within(panel).getByText("Paused for maintenance")).toBeInTheDocument();
    expect(within(panel).getAllByText(/continues by itself when maintenance ends/).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("leaves the actions alone for viewers and while maintenance mode is off", async () => {
    const calls = mockWebApi({ ...webRoutes(webSource()), "GET /v1/maintenance": () => off });
    renderWith(<SourceDetail sourceId="s1" />, { role: "editor" });
    const sync = await screen.findByRole("button", { name: "Sync now" });
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/maintenance")).toBe(true));
    expect(sync).toBeEnabled();
  });
});
