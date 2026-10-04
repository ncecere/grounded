/* The chat page: streaming, final-text replacement, citations, Stop, errors before the stream, feedback, stored conversations, axe. */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { applyChatEvent, chatErrorText, pendingAssistant } from "../pages/chat/stream";
import { Reply, findParagraph, mockApi, openSSE, renderApp, shellRoutes, sse } from "./harness";

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

/** GET /v1/messages/m1/sources/1: the cited passage after a neighbour. */
const citedPassage = {
  n: 1,
  status: "available",
  documentId: "d1",
  sourceId: "s1",
  title: "Drop/Add",
  headingPath: ["Registration", "Drop/Add"],
  url: citation.url,
  passages: [
    { ordinal: 0, content: "The academic calendar lists the dates.", headingPath: ["Registration"], pageStart: 0, pageEnd: 0, cited: false },
    { ordinal: 1, content: "Students may drop or add courses during drop/add.", headingPath: ["Registration", "Drop/Add"], pageStart: 0, pageEnd: 0, cited: true },
  ],
  claims: [],
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
    expect(a.steps).toEqual([{ kind: "retrieval", query: "drop a class", hitCount: 1, thinkingAt: 0 }]);
    expect(a.status).toBe("done");
    expect(a.id).toBe("m1");
  });

  it("tracks tool calls and their results in tool mode", () => {
    let a = pendingAssistant();
    a = applyChatEvent(a, "tool_call", { id: "t1", name: "search_knowledge", arguments: { query: "transcript fee" } });
    a = applyChatEvent(a, "retrieval", { query: "transcript fee", hits: [{ n: 1, title: "Fees", snippet: "" }] });
    a = applyChatEvent(a, "tool_result", { id: "t1", isError: false, hitCount: 1 });
    expect(a.steps).toEqual([{ kind: "tool", id: "t1", name: undefined, query: "transcript fee", hitCount: 1, isError: false, thinkingAt: 0 }]);
    a = applyChatEvent(a, "error", { code: "incomplete_answer", message: "x" });
    expect(a.status).toBe("error");
  });

  it("records how much thinking came before each tool call", () => {
    let a = pendingAssistant();
    a = applyChatEvent(a, "thinking_delta", { delta: "Look up the café’s fee." });
    a = applyChatEvent(a, "tool_call", { id: "t1", name: "search_knowledge", arguments: { query: "fee" } });
    a = applyChatEvent(a, "tool_call", { id: "t2", name: "check_outage", arguments: {} });
    a = applyChatEvent(a, "tool_result", { id: "t1", isError: false, hitCount: 1 });
    a = applyChatEvent(a, "thinking_delta", { delta: "\n\n" });
    a = applyChatEvent(a, "thinking_delta", { delta: "Found it." });
    a = applyChatEvent(a, "tool_call", { id: "t3", name: "search_knowledge", arguments: { query: "hours" } });
    expect(a.steps.map((s) => [s.id, s.thinkingAt])).toEqual([["t1", 23], ["t2", 23], ["t3", 34]]);
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

  it("streams an answer, replaces the raw text with the final text, and opens a cited source beside it", async () => {
    const calls = mockApi(
      routes({
        "POST /v1/agents/registrar/registrar-assistant/chat": () => sse(answerEvents()),
        "GET /v1/messages/m1/sources/1": () => citedPassage,
      }),
    );
    const { container, router } = renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    await userEvent.type(box, "How do I drop a class?{Enter}");

    expect(await findParagraph(/You can drop a class in the student portal/)).toBeInTheDocument();
    expect(screen.queryByText(/RAW streamed draft/)).toBeNull();
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/chat"))!;
    expect(post.body).toEqual({ message: "How do I drop a class?", stream: true });
    expect(post.headers.get("X-CSRF-Token")).toBe("csrf-123");
    expect(post.headers.get("Accept")).toBe("text/event-stream");
    expect(box).toHaveValue("");
    await waitFor(() => expect(router.state.location.search).toEqual({ c: "c1" }));
    // ConversationAnnouncer (a polite status) says how the answer ended.
    await waitFor(() => expect(screen.getAllByRole("status").some((el) => el.textContent?.trim() === "Answer ready")).toBe(true));

    // The marker is a keyboard-reachable button whose card opens the source viewer beside the conversation (docs/v0.4.0.md §5).
    const marker = await screen.findByRole("button", { name: "Source 1: Drop/Add" });
    await userEvent.click(marker);
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Show source 1" }));
    const viewer = await screen.findByRole("region", { name: "Drop/Add" });
    await waitFor(() => expect(within(viewer).getByRole("heading", { level: 2, name: "Drop/Add" })).toHaveFocus());
    expect(await within(viewer).findByTestId("cited-passage")).toHaveTextContent("Students may drop or add courses during drop/add.");
    expect(within(viewer).getByText("Source 1 of 1")).toBeInTheDocument();
    expect(within(viewer).getByRole("link", { name: /Open the page/ })).toHaveAttribute(
      "href",
      "https://registrar.example.edu/registration/drop-add/#:~:text=Students%20may%20drop%20or%20add%20courses%20during%20drop%2Fadd.",
    );
    // A member doesn't get the whole document.
    expect(within(viewer).queryByRole("button", { name: /Open full document/ })).toBeNull();
    // The sources under the answer opened too; each card opens the viewer, its page is a separate link.
    const cardEl = screen.getByRole("listitem", { name: "Source 1: Drop/Add" });
    expect(within(cardEl).getByRole("button", { name: "Show source 1: Drop/Add" })).toBeInTheDocument();
    expect(within(cardEl).getByRole("link", { name: "Open the page (opens in a new tab)" })).toHaveAttribute("href", citation.url);
    expect(within(cardEl).getByText("Registration › Drop/Add")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Searched the knowledge base for “drop a class”/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    // Escape closes it; focus goes to the source card's Show source button (the chip's card that opened it is gone),
    // so Enter opens it again (mem-10).
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Drop/Add" })).toBeNull());
    await waitFor(() => expect(within(cardEl).getByRole("button", { name: "Show source 1: Drop/Add" })).toHaveFocus());
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
    expect(await screen.findByText("Stopped. The answer may be incomplete.")).toBeInTheDocument();
    expect(screen.getByText("Partial answer")).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("Stop hides a marker cut off mid-way, offers Ask again, and a reload still says Stopped (US-05)", async () => {
    let n = 0;
    const calls = mockApi(
      routes({
        "POST /v1/agents/registrar/registrar-assistant/chat": (_b, call) =>
          n++ === 0
            ? openSSE(
                [
                  ["conversation", { conversationId: "c2", userMessageId: "u", agentVersion: 1 }],
                  ["retrieval", { query: "vpn", hits: [{ n: 1, title: "VPN", snippet: "…" }] }],
                  ["message_start", { messageId: "m2" }],
                  ["text_delta", { delta: "Request it through a software request [1" }],
                ],
                call.signal,
              )
            : sse(answerEvents("Use the portal [1].", "c2")),
      }),
    );
    renderApp(chatPath);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message Registrar assistant" }), "Can I use the VPN?{Enter}");
    await screen.findByText(/Request it through a software request/);
    await userEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    const note = (await screen.findByText("Stopped. The answer may be incomplete.")).closest("li")!;
    expect(screen.getByText(/software request/).textContent).not.toMatch(/\[1/);
    await userEvent.click(within(note).getByRole("button", { name: "Ask again" }));
    expect(await findParagraph(/Use the portal/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST").map((c) => (c.body as { message: string }).message)).toEqual(["Can I use the VPN?", "Can I use the VPN?"]);
  });

  it("a stored stopped answer says Stopped after a reload, with Ask again (US-05)", async () => {
    mockApi(
      routes({
        "GET /v1/conversations/c1": () => ({
          conversation: { id: "c1", agentId: "ag1", agentName: card.name, agentSlug: card.slug, teamSlug: "registrar", agentDeleted: false, title: "VPN", createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z" },
          messages: [
            { id: "q1", seq: 1, role: "user", text: "Can I use the VPN?", createdAt: "2026-09-26T10:00:00Z" },
            { id: "m1", seq: 2, role: "assistant", text: "Request it [1].", citations: [citation], stopReason: "aborted", toolCalls: [], createdAt: "2026-09-26T10:00:01Z" },
          ],
        }),
      }),
    );
    renderApp(chatPath + "?c=c1");
    const note = (await screen.findByText("Stopped. The answer may be incomplete.")).closest("li")!;
    expect(within(note).getByRole("button", { name: "Ask again" })).toBeInTheDocument();
  });

  it("a stopped answer shows its markers as chips and its sources right away (M4)", async () => {
    const hits = [{ n: 1, title: "Drop/Add", snippet: "Drop in the portal.", url: citation.url }, { n: 2, title: "Fees", snippet: "Refund rules." }];
    mockApi(
      routes({
        "POST /v1/agents/registrar/registrar-assistant/chat": (_b, call) =>
          openSSE(
            [
              ["conversation", { conversationId: "c2", userMessageId: "u", agentVersion: 1 }],
              ["retrieval", { query: "drop", hits }],
              ["message_start", { messageId: "m2" }],
              ["text_delta", { delta: "Drop it in the portal\u202f【1】 before the deadline【9】. Refunds vary【2†L3-L4】" }],
            ],
            call.signal,
          ),
      }),
    );
    const { container } = renderApp(chatPath);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message Registrar assistant" }), "How do I drop?{Enter}");
    await findParagraph(/Drop it in the portal/);
    await userEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(await screen.findByText("Stopped. The answer may be incomplete.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[【】]|\[9\]/);
    expect(screen.getByRole("button", { name: "Source 1: Drop/Add" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Source 2: Fees" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Used 2 sources" }));
    const list = screen.getByRole("list", { name: "Sources for this answer" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("sending scrolls to your new message, even after you scrolled up to read", async () => {
    mockApi(routes({ "POST /v1/agents/registrar/registrar-assistant/chat": () => sse(answerEvents()) }));
    renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    await userEvent.type(box, "First{Enter}");
    await screen.findByText(/You can drop a class/);
    // A tall log, scrolled up by the reader (jsdom has no layout: fake the metrics).
    const log = screen.getByRole("log");
    let top = 0;
    Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => 5000 });
    Object.defineProperty(log, "clientHeight", { configurable: true, get: () => 500 });
    Object.defineProperty(log, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = v) });
    top = 4500;
    fireEvent.scroll(log);
    fireEvent.wheel(log, { deltaY: -100 });
    top = 1000;
    fireEvent.scroll(log);
    await userEvent.type(box, "Second{Enter}");
    await waitFor(() => expect(top).toBe(5000));
  });

  it("a question that couldn't be sent (offline) stays in the composer, with Retry", async () => {
    let n = 0;
    const calls = mockApi(
      routes({
        "POST /v1/agents/registrar/registrar-assistant/chat": () => {
          if (n++ === 0) throw new TypeError("Failed to fetch");
          return sse(answerEvents("Use the portal [1]."));
        },
      }),
    );
    const { container } = renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    await userEvent.type(box, "How do I drop a class?{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't send your question");
    expect(alert).not.toHaveTextContent(/before the answer finished/);
    expect(box).toHaveValue("How do I drop a class?");
    expect(screen.queryByRole("article", { name: "You said" })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await findParagraph(/Use the portal/)).toBeInTheDocument();
    expect(box).toHaveValue("");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  it("an answer lost mid-way says so and offers Retry", async () => {
    let n = 0;
    mockApi(
      routes({
        "POST /v1/agents/registrar/registrar-assistant/chat": () =>
          n++ === 0
            ? sse([["conversation", { conversationId: "c1", userMessageId: "u", agentVersion: 1 }], ["message_start", { messageId: "m1" }], ["text_delta", { delta: "You can " }]])
            : sse(answerEvents("Use the portal [1].")),
      }),
    );
    renderApp(chatPath);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message Registrar assistant" }), "How do I drop a class?{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Connection lost mid-answer");
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await findParagraph(/Use the portal/)).toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: "You said" })).toHaveLength(2);
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
        "POST /v1/messages/m1/feedback": (b) => ({ messageId: "m1", shared: (b as { share?: boolean }).share === true, ...(b as object) }),
      }),
    );
    renderApp(chatPath + "?c=c1");
    expect(await findParagraph(/Use the student portal/)).toBeInTheDocument();
    expect(screen.getByText(/How do I drop a class\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bad answer" }));
    // "Share this question with the team" is off by default (docs/gaps.md) and stays open when ticked.
    const share = await screen.findByRole("menuitemcheckbox", { name: "Share this question with the team" });
    expect(share).toHaveAttribute("aria-checked", "false");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Outdated" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/v1/messages/m1/feedback")?.body).toEqual({ rating: "down", reason: "outdated", share: false }));
    await userEvent.click(screen.getByRole("button", { name: /Bad answer/ }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Share this question with the team" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Share this question with the team" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitem", { name: "Missing sources" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/v1/messages/m1/feedback").at(-1)?.body).toEqual({ rating: "down", reason: "missing_sources", share: true }));
    await userEvent.click(screen.getByRole("button", { name: /Bad answer/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Outdated" }));
    expect(await screen.findByRole("button", { name: "Bad answer: Outdated" })).toHaveAttribute("aria-pressed", "true");
    // Both thumbs are toggle buttons (G16): exactly one is pressed.
    const good = screen.getByRole("button", { name: "Good answer" });
    expect(good).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(good);
    await waitFor(() => expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Bad answer" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute("data-pressed");
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
    expect((await screen.findByText("Export as Markdown")).closest("a")).toHaveAttribute("href", expect.stringMatching(/^\/v1\/conversations\/c1\/export\?format=markdown&tz=/));
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

describe("a deleted agent's conversation (G2)", () => {
  const deleted = { id: "c7", agentId: "ag9", agentName: "Old helper", agentSlug: "old-helper", teamSlug: "qa-team", agentDeleted: true, title: "Parking permits", createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:05:00Z" };
  const transcript = () => ({
    conversation: deleted,
    messages: [
      { id: "q1", seq: 1, role: "user", text: "Where do I buy a permit?", createdAt: "2026-09-20T10:00:00Z" },
      { id: "m1", seq: 2, role: "assistant", text: "At the parking office.", citations: [], stopReason: "stop", toolCalls: [], feedback: "up", createdAt: "2026-09-20T10:00:01Z" },
    ],
  });

  it("shows the transcript read-only, with a note and no composer or feedback", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/conversations/c7": transcript });
    const { container } = renderApp("/conversations/c7");
    expect(await screen.findByRole("heading", { level: 1, name: "Parking permits" })).toBeInTheDocument();
    expect(screen.getByText("This agent was deleted")).toBeInTheDocument();
    expect(await screen.findByText("At the parking office.")).toBeInTheDocument();
    expect(screen.getByText("Where do I buy a permit?")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Conversation actions" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens from the chat address of the deleted agent", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/agents/qa-team/old-helper": () => Reply.error(404, "not_found", "Not found."), "GET /v1/conversations/c7": transcript });
    renderApp("/a/qa-team/old-helper?c=c7");
    expect(await screen.findByRole("heading", { level: 1, name: "Parking permits" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Agent not available" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Message/ })).toBeNull();
  });

  it("opens from the conversations list", async () => {
    mockApi({ ...shellRoutes(), "GET /v1/conversations": () => ({ items: [deleted], nextCursor: null }) });
    renderApp("/conversations");
    const link = await screen.findByRole("link", { name: /Parking permits/ });
    expect(link).toHaveAttribute("href", "/conversations/c7");
  });

  it("sends a conversation whose agent exists to its chat page", async () => {
    mockApi(routes({ "GET /v1/conversations/c1": () => ({ conversation: { ...deleted, id: "c1", agentId: "ag1", agentSlug: card.slug, teamSlug: "registrar", agentDeleted: false }, messages: [] }) }));
    const { router } = renderApp("/conversations/c1");
    await waitFor(() => expect(router.state.location.pathname).toBe(chatPath));
    expect(router.state.location.search).toEqual({ c: "c1" });
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
