import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { badgeText, bellLabel, latestNotificationsQuery, POLL_MS, timeAgo } from "../components/notifications/api";
import { type Call, Reply, mockApi, renderApp, shellRoutes } from "./harness";

/* The bell and its popover, the inbox (/notifications) and the settings page (docs/phase4-publishing.md §8). */

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

type Note = Schemas["Notification"];

const note = (id: string, title: string, over: Partial<Note> = {}): Note => ({
  id,
  type: "web.sync_failed",
  title,
  body: "The web source Catalog in Office of the Registrar failed to sync: the site was down.",
  link: "/teams/registrar/sources/s1",
  teamId: "t1",
  read: false,
  readAt: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...over,
});

const items = [
  note("n1", "Sync failed: Catalog (Office of the Registrar)"),
  note("n2", "Domain request approved: docs.example.edu", { type: "web.domain_request", link: "/teams/registrar/domains" }),
  note("n3", "You were added to Office of the Registrar", { type: "team.membership", read: true, readAt: "2026-09-25T10:00:00Z", link: "/teams/registrar" }),
];

const settingsItem = (type: Schemas["NotificationType"], label: string, mandatory = false, inApp = true, email = true) => ({
  type,
  label,
  description: `About ${label.toLowerCase()}.`,
  mandatory,
  inApp,
  email,
});

const settings = (emailEnabled = true) => ({
  emailEnabled,
  items: [
    settingsItem("team.invited", "Invited to a team", true),
    settingsItem("web.sync_failed", "Web source sync failed"),
    settingsItem("source.classification_lowered", "Source classification lowered", true),
    settingsItem("team.daily_limit", "Team daily limit reached", false, true, false),
  ],
});

function routes(opts: { unread?: number; emailEnabled?: boolean } = {}) {
  return {
    ...shellRoutes(),
    "GET /v1/notifications": (_: unknown, call: Call) => {
      const unreadOnly = call.search.get("unread") === "true";
      const type = call.search.get("type");
      const list = items.filter((n) => (!unreadOnly || !n.read) && (!type || n.type === type));
      return { items: list, nextCursor: null, unreadCount: opts.unread ?? 2 };
    },
    "PATCH /v1/notifications/n1": (body: unknown) => ({ ...items[0], read: (body as { read: boolean }).read }),
    "POST /v1/notifications/read-all": () => ({ updated: 2 }),
    "GET /v1/me/notification-settings": () => settings(opts.emailEnabled ?? true),
    "PUT /v1/me/notification-settings": (body: unknown) => {
      const change = (body as { items: { type: string; inApp: boolean; email: boolean }[] }).items[0]!;
      const s = settings(opts.emailEnabled ?? true);
      return { ...s, items: s.items.map((i) => (i.type === change.type ? { ...i, ...change } : i)) };
    },
  };
}

describe("notification helpers", () => {
  it("names the bell, caps the badge and polls every 60 s and on focus", () => {
    expect(bellLabel(3)).toBe("Notifications, 3 unread");
    expect(bellLabel(0)).toBe("Notifications, 0 unread");
    expect(bellLabel(undefined)).toBe("Notifications");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(250)).toBe("99+");
    const q = latestNotificationsQuery();
    expect(POLL_MS).toBe(60_000);
    expect(q.refetchInterval).toBe(60_000);
    expect(q.refetchOnWindowFocus).toBe(true);
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(timeAgo("2026-09-26T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-09-26T11:55:00Z", now)).toMatch(/5 minutes ago/);
    expect(timeAgo("2026-09-25T12:00:00Z", now)).toMatch(/yesterday/);
  });
});

describe("notification bell", () => {
  it("shows the unread count and the latest items in a popover", async () => {
    const calls = mockApi(routes({ unread: 2 }));
    const { container } = renderApp("/");
    const bell = await screen.findByRole("button", { name: "Notifications, 2 unread" });
    expect(bell).toHaveTextContent("2");
    await userEvent.click(bell);
    const popup = await screen.findByRole("dialog", { name: "Notifications" });
    const list = within(popup).getByRole("list", { name: "Latest notifications" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByRole("link", { name: "Unread: Sync failed: Catalog (Office of the Registrar)" })).toHaveAttribute("href", "/teams/registrar/sources/s1");
    expect(within(list).getByRole("link", { name: "You were added to Office of the Registrar" })).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();

    await userEvent.click(within(list).getByRole("button", { name: "Mark as read: Sync failed: Catalog (Office of the Registrar)" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ read: true }));
    await userEvent.click(within(popup).getByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/v1/notifications/read-all")).toBe(true));
    expect(within(popup).getByRole("link", { name: "Notification settings" })).toHaveAttribute("href", "/settings/notifications");
    await userEvent.click(within(popup).getByRole("link", { name: "View all" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull());
  });

  it("has no badge when everything is read", async () => {
    mockApi(routes({ unread: 0 }));
    renderApp("/");
    const bell = await screen.findByRole("button", { name: "Notifications, 0 unread" });
    expect(bell).not.toHaveTextContent(/\d/);
  });
});

describe("notifications inbox", () => {
  it("filters by unread and type, and marks everything read", async () => {
    const calls = mockApi(routes());
    const { container } = renderApp("/notifications");
    const list = await screen.findByRole("list", { name: "Notifications" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getAllByText(/failed to sync: the site was down/)).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "All", selected: true })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole("tab", { name: "Unread" }));
    const unread = await screen.findByRole("list", { name: "Unread notifications" });
    await waitFor(() => expect(within(unread).getAllByRole("listitem")).toHaveLength(2));
    expect(calls.some((c) => c.url === "/v1/notifications" && c.search.get("unread") === "true")).toBe(true);

    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    await userEvent.click(await screen.findByRole("option", { name: "Web source sync failed" }));
    await waitFor(() => expect(calls.some((c) => c.search.get("type") === "web.sync_failed" && c.search.get("unread") === "true")).toBe(true));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Unread notifications" })).getAllByRole("listitem")).toHaveLength(1));

    // F-13: with a type filter the button says what it marks, and sends the filter.
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Mark these as read" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/v1/notifications/read-all")?.body).toEqual({ type: "web.sync_failed" }));
  });

  it("keeps the type filter in the URL", async () => {
    const calls = mockApi(routes());
    const { router } = renderApp("/notifications?type=web.sync_failed");
    await screen.findByRole("list", { name: "Notifications" });
    expect(calls.some((c) => c.url === "/v1/notifications" && c.search.get("type") === "web.sync_failed")).toBe(true);
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    await userEvent.click(await screen.findByRole("option", { name: "All types" }));
    await waitFor(() => expect(router.state.location.searchStr).toBe(""));
  });

  it("shows an empty state, and no Mark all as read with nothing unread (Q5)", async () => {
    mockApi({ ...routes(), "GET /v1/notifications": () => ({ items: [], nextCursor: null, unreadCount: 0 }) });
    renderApp("/notifications?tab=unread");
    expect(await screen.findByText("No unread notifications.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark (all|these) as read/ })).toBeNull();
  });
});

describe("notification settings", () => {
  it("toggles channels, and locks required events", async () => {
    const calls = mockApi(routes());
    const { container } = renderApp("/settings/notifications");
    const table = await screen.findByRole("table", { name: "Notification settings" });
    const locked = within(table).getByRole("switch", { name: "Email: Source classification lowered" });
    expect(locked).toBeChecked();
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(within(table).getAllByText("Required")).toHaveLength(2);
    expect(within(table).getAllByText(/Always sent; it can't be turned off/)).toHaveLength(2);
    expect(within(table).getByRole("switch", { name: "Email: Team daily limit reached" })).not.toBeChecked();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(table).getByRole("switch", { name: "Email: Web source sync failed" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ items: [{ type: "web.sync_failed", inApp: true, email: false }] }));
    await waitFor(() => expect(within(table).getByRole("switch", { name: "Email: Web source sync failed" })).not.toBeChecked());
    // Each change says it was saved (P-20).
    const row = within(table).getByRole("switch", { name: "Email: Web source sync failed" }).closest("tr")!;
    expect(await within(row).findByRole("status")).toHaveTextContent("Saved");
    await userEvent.click(within(table).getByRole("switch", { name: "In the app: Web source sync failed" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ items: [{ type: "web.sync_failed", inApp: false, email: false }] }));
  });

  it("explains when this instance sends no email", async () => {
    mockApi(routes({ emailEnabled: false }));
    renderApp("/settings/notifications");
    expect(await screen.findByText("Email isn't set up")).toBeInTheDocument();
    const email = await screen.findByRole("switch", { name: "Email: Web source sync failed" });
    expect(email).not.toBeChecked();
    expect(email).toHaveAttribute("aria-disabled", "true");
    // No claim that required notifications go by email (Q5).
    expect(screen.getByText(/always shown in the app\./)).toBeInTheDocument();
    expect(screen.queryByText(/by email/)).toBeNull();
  });

  it("is linked from the user menu", async () => {
    mockApi(routes());
    renderApp("/");
    await userEvent.click(await screen.findByRole("button", { name: /Una User/ }));
    const item = await screen.findByRole("menuitem", { name: "Notification settings" });
    expect(item).toHaveAttribute("href", "/settings/notifications");
  });

  it("reports a rejected change", async () => {
    mockApi({ ...routes(), "PUT /v1/me/notification-settings": () => Reply.error(400, "notification_mandatory", "Required") });
    renderApp("/settings/notifications");
    await userEvent.click(await screen.findByRole("switch", { name: "Email: Web source sync failed" }));
    expect((await screen.findAllByText("Couldn't save the setting")).length).toBeGreaterThan(0);
  });
});
