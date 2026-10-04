/*
 * Small page-level parts of the v0.4.2 shell fixes (M5): settings tables that
 * stack on a phone (VI-17, VI-31), accessible names that say what they're
 * for (AD-22), a clamped description's tooltip (VI-15) and the Add
 * connection form's field widths (VI-36).
 */
import { screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { mockApi, renderApp, shellRoutes } from "./harness";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const connection = {
  id: "c1",
  name: "Campus gateway",
  description: "",
  baseUrl: "https://ai.example.edu/v1",
  hasApiKey: true,
  apiKeyHint: "abcd",
  timeoutSeconds: 60,
  requestsPerMinute: null,
  maxConcurrentRequests: 8,
  enabled: true,
  modelCount: 2,
  revision: 1,
  createdAt: "",
  updatedAt: "",
};

describe("settings tables on a phone (VI-17, VI-31)", () => {
  it("notification settings stack, each value named by its column", async () => {
    mockApi({
      ...shellRoutes(),
      "GET /v1/notifications": () => ({ items: [], nextCursor: null, unreadCount: 0 }),
      "GET /v1/me/notification-settings": () => ({
        emailEnabled: true,
        items: [{ type: "team.invited", label: "Invited to a team", description: "Someone invited you to join a team.", mandatory: false, inApp: true, email: true }],
      }),
    });
    const { container } = renderApp("/settings/notifications");
    const table = await screen.findByRole("table", { name: "Notification settings" });
    expect(table).toHaveAttribute("data-stack");
    const cells = await within(table).findAllByRole("cell");
    await waitFor(() => expect(cells[1]).toHaveAttribute("data-label", "In the app"));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("accessible names (AD-22)", () => {
  it("names a connection's model count after the connection", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/connections": () => [connection], "GET /v1/admin/models": () => [] });
    renderApp("/admin/connections");
    const table = await screen.findByRole("table", { name: "Connections" }, { timeout: 4000 });
    expect(await within(table).findByRole("link", { name: "2 models on Campus gateway" })).toHaveAttribute("href", expect.stringContaining("connection=c1"));
  });
});

describe("Add connection (VI-36)", () => {
  it("gives Name the same width as the other endpoint fields", async () => {
    mockApi({ ...shellRoutes("platform_admin"), "GET /v1/admin/connections": () => [connection], "GET /v1/admin/models": () => [] });
    renderApp("/admin/connections?form=new");
    const name = await screen.findByRole("textbox", { name: "Name" }, { timeout: 4000 });
    const base = screen.getByRole("textbox", { name: /Base URL/ });
    expect(name.closest("div[class*='wide']")).not.toBeNull();
    expect(base.closest("div[class*='wide']")).not.toBeNull();
  });
});

describe("agent cards (VI-15)", () => {
  it("give a clamped description its full text on hover", async () => {
    const description = "Answers questions about registration, records, transcripts and graduation, with links to the forms.";
    mockApi({
      ...shellRoutes(),
      "GET /v1/agents": () => [
        { id: "a1", name: "Registrar assistant", description, teamSlug: "registrar", teamName: "Office of the Registrar", agentSlug: "registrar", audience: "team", accentColor: null },
      ],
    });
    renderApp("/agents");
    const text = await screen.findByText(description);
    expect(text).toHaveAttribute("title", description);
  });
});
