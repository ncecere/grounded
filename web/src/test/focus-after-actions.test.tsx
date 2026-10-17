/* Focus stays in the page after "Mark as read" and "Load more" (QA v0.6.0, #128): a button that disables itself while it works, or that goes away, used to drop focus to the page. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Schemas } from "../api/client";
import { type Call, mockApi, renderApp, shellRoutes } from "./harness";
import { scaled } from "../../test-scale";

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const slow = { timeout: scaled(5000) };

describe("Mark as read on /notifications", () => {
  type Note = Schemas["Notification"];
  const note = (id: string, title: string): Note => ({
    id, type: "web.sync_failed", title, body: "", link: "/teams/registrar/sources/s1", teamId: "t1", read: false, readAt: null, createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  });
  const setup = () => {
    const store = [note("n1", "First problem"), note("n2", "Second problem"), note("n3", "Third problem")];
    mockApi({
      ...shellRoutes(),
      "GET /v1/notifications": (_: unknown, call: Call) => {
        const list = store.filter((n) => call.search.get("unread") !== "true" || !n.read);
        return { items: list, nextCursor: null, unreadCount: store.filter((n) => !n.read).length };
      },
      ...Object.fromEntries(
        store.map((n) => [`PATCH /v1/notifications/${n.id}`, (body: unknown) => Object.assign(n, { read: (body as { read: boolean }).read })]),
      ),
    });
  };
  const press = async (button: HTMLElement) => {
    button.focus();
    await userEvent.keyboard("{Enter}");
  };

  it("leaves focus on the next notification's button when the one marked read leaves the Unread list", async () => {
    setup();
    renderApp("/notifications?tab=unread");
    const list = await screen.findByRole("list", { name: "Unread notifications" }, slow);
    await press(within(list).getByRole("button", { name: "Mark as read: First problem" }));
    await waitFor(() => expect(screen.queryByText("First problem")).toBeNull());
    expect(within(list).getByRole("button", { name: "Mark as read: Second problem" })).toHaveFocus();
    // The last one: focus goes to the one before it.
    await press(within(list).getByRole("button", { name: "Mark as read: Third problem" }));
    await waitFor(() => expect(screen.queryByText("Third problem")).toBeNull());
    expect(within(list).getByRole("button", { name: "Mark as read: Second problem" })).toHaveFocus();
  });

  it("keeps focus on the button of an item that stays (All), which becomes Mark as unread", async () => {
    setup();
    renderApp("/notifications");
    const list = await screen.findByRole("list", { name: "Notifications" }, slow);
    await press(within(list).getByRole("button", { name: "Mark as read: First problem" }));
    const undo = await within(list).findByRole("button", { name: "Mark as unread: First problem" });
    expect(undo).toHaveFocus();
  });
});

describe("Load more on /conversations", () => {
  const conv = (i: number) => ({
    id: `c${i}`, title: `Question ${i}`, agentId: "ag1", agentName: "Helper", agentSlug: "helper", teamSlug: "registrar", agentDeleted: false,
    createdAt: "2026-10-16T09:00:00Z", updatedAt: new Date(Date.UTC(2026, 9, 16, 9, 0) - i * 60_000).toISOString(),
  });
  const setup = (pages: number[][]) =>
    mockApi({
      ...shellRoutes(),
      "GET /v1/agents": () => [],
      "GET /v1/conversations": (_: unknown, call: Call) => {
        const at = Number(call.search.get("cursor") ?? 0);
        return { items: pages[at]!.map(conv), nextCursor: at + 1 < pages.length ? String(at + 1) : null };
      },
    });

  it("puts focus on the first of the new conversations when the button goes away with the last page", async () => {
    setup([[1, 2], [3, 4]]);
    renderApp("/conversations");
    const more = await screen.findByRole("button", { name: "Load more" }, slow);
    more.focus();
    await userEvent.keyboard("{Enter}");
    const first = await screen.findByRole("link", { name: /^Question 3/ }, slow);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
    expect(first).toHaveFocus();
  });

  it("keeps focus on Load more while there are more pages", async () => {
    setup([[1], [2], [3]]);
    renderApp("/conversations");
    const more = await screen.findByRole("button", { name: "Load more" }, slow);
    more.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("link", { name: /^Question 2/ }, slow);
    expect(screen.getByRole("button", { name: "Load more" })).toHaveFocus();
  });
});
