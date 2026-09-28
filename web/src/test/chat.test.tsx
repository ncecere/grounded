/* The chat page: streaming, final-text replacement, citations, Stop, errors before the stream, feedback, stored conversations, axe. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { applyChatEvent, chatErrorText, pendingAssistant } from "../pages/chat/stream";
import { Reply, mockApi, openSSE, renderApp, shellRoutes, sse } from "./harness";

const card = {
  id: "ag1",
  teamSlug: "registrar",
  teamName: "Office of the Registrar",
  slug: "registrar-assistant",
  name: "Registrar assistant",
  description: "Registration and records.",
  accentColor: "#0021a5",
  welcomeMessage: "Hi! Ask me about registration.",
  starterQuestions: ["How do I drop a class?", "How do I order a transcript?"],
  citationMode: "snippet_link",
  status: "active",
};

const citation = {
  n: 1,
  documentId: "d1",
  sourceId: "s1",
  title: "Drop/Add",
  snippet: "Students may drop or add courses during drop/add.",
  headingPath: ["Registration", "Drop/Add"],
  url: "https://registrar.example.edu/registration/drop-add/",
};

const usage = { input: 900, output: 120, reasoning: 40, cacheRead: 0, cacheWrite: 0, total: 1020 };

const answerEvents = (text = "You can drop a class in the student portal [1].", conversationId = "c1"): [string, unknown][] => [
  ["conversation", { conversationId, userMessageId: "um1", agentVersion: 1 }],
  ["retrieval", { query: "drop a class", hits: [{ n: 1, title: "Drop/Add", snippet: "…" }] }],
  ["message_start", { messageId: "m1" }],
  ["thinking_delta", { delta: "The user asks about dropping." }],
  ["text_delta", { delta: "RAW streamed draft " }],
  ["text_delta", { delta: "[1, 2]" }],
  ["message_end", { messageId: "m1", stopReason: "stop", text, citations: [citation], usage, refused: false, noContext: false }],
  ["done", {}],
];

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

describe("chat stream reducer", () => {
  it("accumulates deltas and replaces them with message_end.text", () => {
    let a = pendingAssistant();
    for (const [e, d] of answerEvents()) if (e !== "conversation") a = applyChatEvent(a, e, d);
    expect(a.text).toBe("You can drop a class in the student portal [1].");
    expect(a.thinking).toBe("The user asks about dropping.");
    expect(a.citations).toHaveLength(1);
    expect(a.steps).toEqual([{ kind: "retrieval", query: "drop a class", hitCount: 1 }]);
    expect(a.status).toBe("done");
    expect(a.id).toBe("m1");
  });

  it("tracks tool calls and their results in tool mode", () => {
    let a = pendingAssistant();
    a = applyChatEvent(a, "tool_call", { id: "t1", name: "search_knowledge", arguments: { query: "transcript fee" } });
    a = applyChatEvent(a, "retrieval", { query: "transcript fee", hits: [{ n: 1, title: "Fees", snippet: "" }] });
    a = applyChatEvent(a, "tool_result", { id: "t1", isError: false, hitCount: 1 });
    expect(a.steps).toEqual([{ kind: "tool", id: "t1", name: undefined, query: "transcript fee", hitCount: 1, isError: false }]);
    a = applyChatEvent(a, "error", { code: "incomplete_answer", message: "x" });
    expect(a.status).toBe("error");
  });
});

describe("chat page", () => {
  it("shows the welcome and starter questions with no axe violations", async () => {
    mockApi(routes());
    const { container } = renderApp(chatPath);
    expect(await screen.findByRole("heading", { level: 1, name: "Registrar assistant" })).toBeInTheDocument();
    expect(await screen.findByText("Hi! Ask me about registration.")).toBeInTheDocument();
    const starters = screen.getByRole("group", { name: "Suggested questions" });
    expect(within(starters).getAllByRole("button")).toHaveLength(2);
    // One "New conversation" (at the top of the list), no duplicate in the header.
    expect(screen.getAllByRole("button", { name: /New conversation/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Conversation actions" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    // Narrow screens open the list in a sheet.
    await userEvent.click(screen.getByRole("button", { name: "Show conversations" }));
    const sheet = await screen.findByRole("dialog", { name: "Conversations" });
    expect(within(sheet).getByRole("button", { name: /New conversation/ })).toBeInTheDocument();
    expect(await axe(sheet)).toHaveNoViolations();
  });

  it("shows the app sidebar as icons, the agent's team with a preview, and conversations by day (W11)", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    const conv = (id: string, title: string, updatedAt: string) => ({ id, title, agentId: "ag1", agentName: card.name, agentSlug: card.slug, teamSlug: "registrar", agentDeleted: false, createdAt: updatedAt, updatedAt });
    mockApi(
      routes({
        "GET /v1/conversations": () => ({ items: [conv("c1", "Drop a class", now.toISOString()), conv("c2", "Transcript fee", earlier)], nextCursor: null }),
      }),
    );
    const { container } = renderApp(chatPath);
    await screen.findByRole("heading", { level: 1, name: "Registrar assistant" });
    // Two columns: the app sidebar is collapsed to icons on chat pages.
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(localStorage.getItem("grounded.sidebarCollapsed")).toBeNull();
    // The team name links to Discover agents (the preview card is a hover enhancement).
    expect(screen.getByRole("link", { name: /^Office of the Registrar: see agents/ })).toHaveAttribute("href", "/agents");
    const list = screen.getByRole("navigation", { name: "Conversations with Registrar assistant" });
    const today = await within(list).findByRole("region", { name: "Today" });
    expect(within(today).getByRole("link", { name: /Drop a class/ })).toBeInTheDocument();
    expect(within(list).getAllByRole("region")).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("streams an answer, replaces the raw text with the final text, and focuses a cited source", async () => {
    const calls = mockApi(routes({ "POST /v1/agents/registrar/registrar-assistant/chat": () => sse(answerEvents()) }));
    const { container, router } = renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    await userEvent.type(box, "How do I drop a class?{Enter}");

    expect(await screen.findByText(/You can drop a class in the student portal/)).toBeInTheDocument();
    expect(screen.queryByText(/RAW streamed draft/)).toBeNull();
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/chat"))!;
    expect(post.body).toEqual({ message: "How do I drop a class?", stream: true });
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-123");
    expect(post.headers.get("Accept")).toBe("text/event-stream");
    expect(box).toHaveValue("");
    await waitFor(() => expect(router.state.location.search).toEqual({ c: "c1" }));
    // ConversationAnnouncer (a polite status) says how the answer ended.
    await waitFor(() => expect(screen.getAllByRole("status").some((el) => el.textContent?.trim() === "Answer ready")).toBe(true));

    // The marker is a keyboard-reachable button that moves focus to the source card.
    const marker = await screen.findByRole("button", { name: "Source 1: Drop/Add" });
    await userEvent.click(marker);
    const cardEl = screen.getByRole("listitem", { name: "Source 1: Drop/Add" });
    await waitFor(() => expect(cardEl).toHaveFocus());
    expect(within(cardEl).getByRole("link", { name: /Drop\/Add/ })).toHaveAttribute("href", citation.url);
    expect(within(cardEl).getByText("Registration › Drop/Add")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Searched the knowledge base for “drop a class”/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a withheld answer as an alert, without copy or rating buttons, and announces it as not answered (F-10)", async () => {
    const notice = "The assistant can't answer right now. Please try again later.";
    mockApi(
      routes({
        "POST /v1/agents/registrar/registrar-assistant/chat": () =>
          sse([
            ["conversation", { conversationId: "c1", userMessageId: "um1", agentVersion: 1 }],
            ["message_start", { messageId: "m1" }],
            ["moderation", { stage: "output", action: "unavailable", notice }],
            ["message_end", { messageId: "m1", stopReason: "stop", text: notice, citations: [], usage, refused: false, noContext: false }],
            ["done", {}],
          ]),
      }),
    );
    renderApp(chatPath);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message Registrar assistant" }), "Hello?{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Safety check unavailable");
    expect(alert).toHaveTextContent(notice);
    await waitFor(() => expect(screen.getAllByRole("status").some((el) => el.textContent?.startsWith("Not answered."))).toBe(true));
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy answer" })).toBeNull();
    expect(screen.getAllByRole("status").some((el) => el.textContent?.trim() === "Answer ready")).toBe(false);
  });

  it("continues the conversation with its ID", async () => {
    let n = 0;
    const calls = mockApi(routes({ "POST /v1/agents/registrar/registrar-assistant/chat": () => sse(answerEvents(n++ ? "Second answer." : "First answer.")) }));
    renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    await userEvent.type(box, "First{Enter}");
    await screen.findByText("First answer.");
    await userEvent.type(box, "Second{Enter}");
    await screen.findByText("Second answer.");
    const posts = calls.filter((c) => c.method === "POST" && c.url.endsWith("/chat"));
    expect(posts[1]!.body).toEqual({ message: "Second", conversationId: "c1", stream: true });
  });

  it("Stop aborts the request, keeps the partial answer and returns focus to the composer", async () => {
    let signal: AbortSignal | undefined;
    mockApi(
      routes({
        "POST /v1/agents/registrar/registrar-assistant/chat": (_b, call) => {
          signal = call.signal;
          return openSSE([["conversation", { conversationId: "c2", userMessageId: "u", agentVersion: 1 }], ["message_start", { messageId: "m2" }], ["text_delta", { delta: "Partial answer" }]], call.signal);
        },
      }),
    );
    renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    await userEvent.type(box, "Long question{Enter}");
    expect(await screen.findByText("Partial answer")).toBeInTheDocument();
    const stop = screen.getByRole("button", { name: "Stop generating" });
    await userEvent.click(stop);
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByText("Stopped. This is a partial answer.")).toBeInTheDocument();
    expect(screen.getByText("Partial answer")).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("explains errors that stop a question before streaming and gives the question back", async () => {
    mockApi(routes({ "POST /v1/agents/registrar/registrar-assistant/chat": () => Reply.error(429, "rate_limited", "Your team has reached its limit of 60 queries per minute.", undefined, { "Retry-After": "12" }) }));
    renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    await userEvent.type(box, "Too fast{Enter}");
    const alert = await screen.findByText("Too many questions at once");
    expect(alert.closest("[role]")?.textContent).toMatch(/Try again in 12 s/);
    expect(box).toHaveValue("Too fast");
    expect(screen.queryByText("You said:")).toBeNull();
  });

  it("shows a stored failed answer when the model is unavailable (503 with conversationId)", async () => {
    mockApi(
      routes({
        "POST /v1/agents/registrar/registrar-assistant/chat": () => Reply.error(503, "model_unavailable", "The model didn't respond.", { conversationId: "c9" }),
        "GET /v1/conversations/c9": () => ({ conversation: { id: "c9" }, messages: [] }),
      }),
    );
    const { router } = renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    await userEvent.type(box, "Hello{Enter}");
    // Shown in the answer (and announced by the status region).
    expect((await screen.findAllByText("The AI model is unavailable")).length).toBeGreaterThan(0);
    await waitFor(() => expect(router.state.location.search).toEqual({ c: "c9" }));
  });

  it("opens a stored conversation, and records feedback with a reason", async () => {
    const calls = mockApi(
      routes({
        "GET /v1/conversations/c1": () => ({
          conversation: { id: "c1", agentId: "ag1", agentName: card.name, agentSlug: card.slug, teamSlug: "registrar", agentDeleted: false, title: "Dropping", createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z" },
          messages: [
            { id: "q1", seq: 1, role: "user", text: "How do I drop a class?", createdAt: "2026-09-26T10:00:00Z" },
            { id: "m1", seq: 2, role: "assistant", text: "Use the student portal [1].", thinking: "t", citations: [citation], stopReason: "stop", toolCalls: [], createdAt: "2026-09-26T10:00:01Z" },
          ],
        }),
        "POST /v1/messages/m1/feedback": (b) => ({ messageId: "m1", ...(b as object) }),
      }),
    );
    renderApp(chatPath + "?c=c1");
    expect(await screen.findByText(/Use the student portal/)).toBeInTheDocument();
    expect(screen.getByText(/How do I drop a class\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bad answer" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Outdated" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/v1/messages/m1/feedback")?.body).toEqual({ rating: "down", reason: "outdated" }));
    expect(await screen.findByRole("button", { name: "Bad answer: Outdated" })).toHaveAttribute("aria-pressed", "true");
  });

  it("the delete confirmation is honest about retention", async () => {
    const conv = { id: "c1", agentId: "ag1", agentName: card.name, agentSlug: card.slug, teamSlug: "registrar", agentDeleted: false, title: "Dropping", createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z" };
    const calls = mockApi(
      routes({
        "GET /v1/conversations": () => ({ items: [conv], nextCursor: null }),
        "GET /v1/conversations/c1": () => ({ conversation: conv, messages: [] }),
        "DELETE /v1/conversations/c1": () => ({ ok: true }),
      }),
    );
    renderApp(chatPath + "?c=c1");
    // The header's compact menu acts on the open conversation.
    expect(await screen.findByRole("button", { name: "Conversation actions" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Dropping" }));
    expect((await screen.findByText("Export as Markdown")).closest("a")).toHaveAttribute("href", "/v1/conversations/c1/export?format=markdown");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/removed permanently under the platform's retention policy/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete conversation" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/v1/conversations/c1")).toBe(true));
  });
});

describe("chat page for an agent you can't use", () => {
  it("shows the shared not-available page with a way to find agents", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/agents/qa-team/qa-helper": () => Reply.error(404, "not_found", "Not found.") });
    const { container } = renderApp("/a/qa-team/qa-helper");
    expect(await screen.findByRole("heading", { level: 1, name: "Agent not available" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Discover agents" })).toHaveAttribute("href", "/agents");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("chat error text", () => {
  it("tells a busy gateway apart from an outage", () => {
    expect(chatErrorText("model_busy").title).toBe("The AI model is busy");
    expect(chatErrorText("model_unavailable").title).toBe("The AI model is unavailable");
  });
});

describe("streaming citation markers", () => {
  it("shows full-width and lenticular markers as [n] while streaming, spaced after a word", async () => {
    const { normalizeMarkers } = await import("../pages/chat/thread");
    expect(normalizeMarkers("online【2】.")).toBe("online [2].");
    expect(normalizeMarkers("See 【1†L10-L12】 and ［1，3］.")).toBe("See [1] and [1,3].");
    expect(normalizeMarkers("Already [1] fine; array[3] stays.")).toBe("Already [1] fine; array[3] stays.");
  });
});
