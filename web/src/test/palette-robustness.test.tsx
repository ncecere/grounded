/*
 * ⌘K under stress (docs/v0.2.0.md §7, M5): a reviewer's renderer froze after
 * quick open → type → Escape cycles while a server search was on its way.
 * Closing cancels the search and drops a late answer, reopening never
 * searches for the old text, quick cycles stay quiet, and a long list of
 * conversations is capped.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { type Call, mockApi, renderApp, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const searches = (calls: Call[]) => calls.filter((c) => c.url === "/v1/search");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hour = 3_600_000;

const conversation = (i: number, title: string, agent = "Records helper") => ({
  type: "conversation",
  id: `c${i}`,
  label: title,
  secondary: agent,
  teamSlug: "registrar",
  agentSlug: agent === "Records helper" ? "records" : "student",
  updatedAt: new Date(Date.now() - (i + 1) * hour).toISOString(),
});

async function ready() {
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 1 });
  return user;
}

describe("command palette robustness (M5)", () => {
  it("cancels the search on close, drops a late answer, and doesn't search for the old text when reopened", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/agents": () => [],
      "GET /v1/search": async () => {
        await held;
        return [conversation(1, "Transcript fees")];
      },
    });
    renderApp("/");
    const user = await ready();
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await user.type(within(dialog).getByRole("combobox"), "transcript");
    await waitFor(() => expect(searches(calls)).toHaveLength(1));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
    expect(searches(calls)[0]!.signal?.aborted).toBe(true);
    release();
    await pause(50);
    expect(screen.queryByRole("option", { name: /Transcript fees/ })).toBeNull();

    // Reopened at once: empty, and no search for "transcript" again.
    await user.keyboard("{Control>}k{/Control}");
    const again = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(again).getByRole("combobox")).toHaveValue("");
    await pause(300);
    expect(searches(calls)).toHaveLength(1);
    expect(within(again).queryByRole("option", { name: /Transcript fees/ })).toBeNull();
  });

  it("stays quiet through quick open, type and close cycles with slow searches", async () => {
    const errors = vi.spyOn(console, "error");
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/agents": () => [],
      "GET /v1/search": async (_b, call) => {
        await pause(400);
        return Array.from({ length: 30 }, (_, i) => conversation(i, `How do I request a ${call.search.get("q")}?`));
      },
    });
    renderApp("/teams/registrar");
    const user = await ready();
    for (let i = 0; i < 12; i++) {
      await user.keyboard("{Control>}k{/Control}");
      const dialog = await screen.findByRole("dialog", { name: "Command palette" });
      await user.type(within(dialog).getByRole("combobox"), ["members", "audit log", "transcript"][i % 3]!);
      if (i % 4 === 3) await pause(SEARCH_WAIT);
      await user.keyboard("{Escape}");
    }
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
    const before = searches(calls).length;
    // Only the cycles that waited past the debounce searched, and every one of them was cancelled.
    expect(before).toBeLessThanOrEqual(3);
    expect(searches(calls).every((c) => c.signal?.aborted)).toBe(true);
    await pause(600);
    expect(searches(calls)).toHaveLength(before);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // No update loops or updates of unmounted parts (act() notices from the pauses aside).
    expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => !m.includes("not wrapped in act"))).toEqual([]);
  });

  it("shows three conversations and More conversations…, with agent and date for the same title", async () => {
    const hits = [
      { type: "agent", id: "a1", label: "Records helper", secondary: "Office of the Registrar", teamSlug: "registrar", agentSlug: "records", canOpen: true, canChat: true },
      conversation(1, "How do I request a transcript?"),
      conversation(2, "How do I request a transcript?", "Student help"),
      conversation(3, "Transcript fees"),
      ...Array.from({ length: 40 }, (_, i) => conversation(i + 4, `Transcript question ${i}`)),
    ];
    mockApi({ ...shellRoutes(), "GET /v1/agents": () => [], "GET /v1/search": () => hits });
    const { router } = renderApp("/");
    const user = await ready();
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    await user.type(within(dialog).getByRole("combobox"), "transcript");
    const group = await within(dialog).findByRole("group", { name: "Conversations" });
    const options = within(group).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^How do I request a transcript\?Records helper · \w{3} \d+, \d{4}/),
      expect.stringMatching(/^How do I request a transcript\?Student help · \w{3} \d+, \d{4}/),
      "Transcript feesRecords helper · 4 hours ago",
      "More conversations…Conversations page",
    ]);
    // The agent matched on its description: the server found it, so it stays listed.
    expect(within(dialog).getByRole("group", { name: "Chat with an agent" })).toHaveTextContent("Records helper");
    expect(await axe(document.body)).toHaveNoViolations();

    await user.click(options[3]!);
    await waitFor(() => expect(router.state.location.pathname).toBe("/conversations"));
    expect(router.state.location.search).toMatchObject({ q: "transcript" });
  });
});

/** Longer than the search debounce (180 ms). */
const SEARCH_WAIT = 250;
