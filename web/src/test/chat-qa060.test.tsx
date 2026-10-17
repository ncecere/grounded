/* Chat polish from the v0.6.0 QA pass (#124-#127): the composer's counter, the retrieval header, bidi isolation, the conversation list. */
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderApp, shellRoutes, sse } from "./harness";

const card = {
  id: "ag1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  description: "Registration and records.",
  accentColor: "#0021a5",
  welcomeMessage: "Hi! Ask me about registration.",
  starterQuestions: [],
  citationMode: "snippet_link",
  status: "active",
};
const chatPath = "/a/registrar/registrar-assistant";
const routes = (extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}) => ({
  ...shellRoutes(),
  "GET /v1/agents/registrar/registrar-assistant": () => card,
  "GET /v1/agents": () => [card],
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
beforeAll(() => {
  window.scrollTo = () => {};
});

describe("composer length (#127)", () => {
  it("counts characters like the server, not UTF-16 units: 5000 emoji fit in 8000", async () => {
    mockApi(routes());
    renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    fireEvent.change(box, { target: { value: "😀".repeat(5000) } });
    expect(await screen.findByText("5,000 / 8,000")).toBeInTheDocument();
    expect(box).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: /send|submit/i })).toBeEnabled();
    // 8000 characters are still allowed, 8001 are not.
    fireEvent.change(box, { target: { value: "😀".repeat(8000) } });
    expect(screen.getByRole("button", { name: /send|submit/i })).toBeEnabled();
    fireEvent.change(box, { target: { value: "a".repeat(8001) } });
    expect(await screen.findByText("8,001 / 8,000 (too long)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send|submit/i })).toBeDisabled();
  });
});

const usage = { input: 9, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 10 };
/** An answer whose retrieval searched for `query`. */
const answerFor = (query: string): [string, unknown][] => [
  ["conversation", { conversationId: "c1", userMessageId: "um1", agentVersion: 1 }],
  ["retrieval", { query, hits: [{ n: 1, title: "Drop/Add", snippet: "…" }] }],
  ["message_start", { messageId: "m1" }],
  ["text_delta", { delta: "Ok." }],
  ["message_end", { messageId: "m1", stopReason: "stop", text: "Ok.", citations: [], usage, refused: false, noContext: false }],
  ["done", {}],
];
const ask = async (question: string, events: [string, unknown][]) => {
  mockApi(routes({ "POST /v1/agents/registrar/registrar-assistant/chat": () => sse(events) }));
  renderApp(chatPath);
  const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
  fireEvent.change(box, { target: { value: question } });
  await userEvent.click(screen.getByRole("button", { name: /send|submit/i }));
};

describe("retrieval header (#125)", () => {
  it("prints a line or two of a long question, and the step's panel has all of it", async () => {
    const question = "word ".repeat(1600).trim(); // 7999 characters
    await ask(question, answerFor(question));
    const header = await screen.findByRole("button", { name: /Searched the knowledge base for/ });
    expect(header.textContent!.length).toBeLessThan(250);
    expect(header).toHaveTextContent(/for “word word .*…”/);
    await userEvent.click(header);
    const step = header.parentElement!; // the Tool: its trigger and panel
    expect(within(step).getByText((t) => t.includes(question))).toBeInTheDocument();
  });

  it("keeps a short question whole", async () => {
    await ask("drop a class", answerFor("drop a class"));
    expect(await screen.findByRole("button", { name: /Searched the knowledge base for “drop a class”/ })).toBeInTheDocument();
  });
});

describe("the chat page's conversation list (#124)", () => {
  const conv = (i: number) => ({
    id: `c${i}`, title: `Question ${i}`, agentId: "ag1", agentName: card.name, agentSlug: card.slug, teamSlug: "registrar", agentDeleted: false,
    createdAt: "2026-10-16T09:00:00Z", updatedAt: new Date(Date.UTC(2026, 9, 16, 9, 0) - i * 60_000).toISOString(),
  });
  it("has Load more, which follows the cursor to the conversations past the first 50", async () => {
    const all = Array.from({ length: 63 }, (_, i) => conv(i + 1));
    const calls = mockApi(
      routes({
        "GET /v1/conversations": (_b, call) => (call.search.get("cursor") === "p2" ? { items: all.slice(50), nextCursor: null } : { items: all.slice(0, 50), nextCursor: "p2" }),
      }),
    );
    renderApp(chatPath);
    const list = await screen.findByRole("navigation", { name: "Conversations with Registrar assistant" });
    await within(list).findByRole("link", { name: /^Question 1(?!\d)/ });
    expect(within(list).getAllByRole("link")).toHaveLength(50);
    await userEvent.click(within(list).getByRole("button", { name: "Load more" }));
    expect(await within(list).findByRole("link", { name: /^Question 63(?!\d)/ })).toBeInTheDocument();
    expect(within(list).getAllByRole("link")).toHaveLength(63);
    expect(within(list).queryByRole("button", { name: "Load more" })).toBeNull();
    const mine = calls.filter((c) => c.url === "/v1/conversations" && c.search.get("agentId") === "ag1");
    expect(mine.map((c) => c.search.get("cursor"))).toEqual([null, "p2"]);
  });
});
