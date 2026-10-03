/* Follow-up suggestions (docs/follow-ups.md): the suggestions event, chips under the last answer that ask the question, the answer complete before them, the Build → Advanced switch. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { sectionSummary } from "../pages/agents/build/summaries";
import { configInput, defaultConfig } from "../pages/agents/common";
import { Conversation, ConversationContent } from "../components/ui/conversation/conversation";
import { ShowSuggestions, suggestionsArrived } from "../pages/chat/show-suggestions";
import { type ChatItem, applyChatEvent, itemsFromConversation, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { type Handler, mockApi, openSSE, renderApp, renderBare, shellRoutes, sse } from "./harness";

const card = {
  id: "ag1", teamSlug: "registrar", teamName: "Office of the Registrar", slug: "registrar-assistant", name: "Registrar assistant",
  description: "Registration and records.", accentColor: "#0021a5", welcomeMessage: "Hi!", starterQuestions: ["How do I drop a class?"],
  citationMode: "snippet_link", status: "active",
};
const citation = { n: 1, documentId: "d1", sourceId: "s1", title: "Drop/Add", snippet: "Students may drop or add courses.", headingPath: ["Registration", "Drop/Add"] };
const usage = { input: 9, output: 12, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 21 };
const follow = ["Is there a fee to drop a class?", "When does drop/add end?"];

const answer = (id: string, text: string, extra: Record<string, unknown> = {}): [string, unknown][] => [
  ["conversation", { conversationId: "c1", userMessageId: `u-${id}`, agentVersion: 1 }],
  ["message_start", { messageId: id }],
  ["text_delta", { delta: text }],
  ["message_end", { messageId: id, stopReason: "stop", text, citations: [citation], usage, refused: false, noContext: false, ...extra }],
];

const chatPath = "/a/registrar/registrar-assistant";
const chatURL = "POST /v1/agents/registrar/registrar-assistant/chat";
const routes = (extra: Record<string, Handler> = {}) => ({
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

describe("the suggestions event", () => {
  it("adds up to 3 questions, ignores bad data and moderated answers, and tracks pending citation checks", () => {
    let item = applyChatEvent(pendingAssistant(), "message_end", { messageId: "m1", stopReason: "stop", text: "Yes [1].", citations: [citation], citationsPending: true });
    expect(item.citationsPending).toBe(true);
    item = applyChatEvent(item, "citations_checked", { messageId: "m1", text: "Yes [1].", citations: [citation] });
    expect(item.citationsPending).toBe(false);
    expect(applyChatEvent(item, "suggestions", { messageId: "m1", suggestions: ["A?", "", 3, "B?", "C?", "D?"] }).suggestions).toEqual(["A?", "B?", "C?"]);
    expect(applyChatEvent(item, "suggestions", { messageId: "m1", suggestions: "A?" }).suggestions).toBeUndefined();
    const moderated = applyChatEvent(item, "moderation", { stage: "output", action: "retracted", notice: "Removed." });
    expect(applyChatEvent(moderated, "suggestions", { suggestions: ["A?"] }).suggestions).toBeUndefined();
  });
});

describe("chips under the answer", () => {
  it("show under the last answer once it's complete; choosing one asks it, and the earlier answer's chips go", async () => {
    let n = 0;
    const calls = mockApi(
      routes({
        [chatURL]: () =>
          ++n === 1
            ? sse([...answer("m1", "You can drop a class in the portal [1]."), ["suggestions", { messageId: "m1", suggestions: follow }], ["done", {}]])
            : sse([...answer("m2", "Dropping is free [1]."), ["done", {}]]),
      }),
    );
    const { container } = renderApp(chatPath);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message Registrar assistant" }), "How do I drop a class?{Enter}");

    const group = await screen.findByRole("group", { name: "Suggested follow-up questions" });
    expect(within(group).getByText("You could also ask:")).toBeInTheDocument();
    // Lined up with the answer's text, not centred under it (walkthrough, 2026-10-02).
    expect(group).toHaveAttribute("data-align", "start");
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(follow);
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(group).getByRole("button", { name: follow[0] }));
    expect(await screen.findByText("Dropping is free")).toBeInTheDocument();
    const posts = calls.filter((c) => c.method === "POST" && c.url.endsWith("/chat"));
    expect(posts.map((c) => (c.body as { message: string }).message)).toEqual(["How do I drop a class?", follow[0]]);
    expect((posts[1]!.body as { conversationId?: string }).conversationId).toBe("c1");
    // The question shows in the conversation; the first answer's chips are gone and the new answer has none.
    expect(screen.getAllByText(follow[0]!).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole("group", { name: "Suggested follow-up questions" })).toBeNull());
  });

  it("the answer is complete at message_end: the composer is free while the suggestions are written", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    mockApi(
      routes({
        [chatURL]: (_b, call) => {
          signals.push(call.signal);
          return openSSE(answer(`m${signals.length}`, "You can drop a class in the portal [1]."), call.signal);
        },
      }),
    );
    renderApp(chatPath);
    const box = await screen.findByRole("textbox", { name: "Message Registrar assistant" });
    await userEvent.type(box, "How do I drop a class?{Enter}");
    expect(await screen.findByText(/You can drop a class in the portal/)).toBeInTheDocument();
    // No Stop: the answer is done although the stream is still open.
    await waitFor(() => expect(screen.getAllByRole("status").some((el) => el.textContent?.trim() === "Answer ready")).toBe(true));
    expect(screen.queryByRole("button", { name: /Stop/ })).toBeNull();
    expect(screen.queryByText(/Checking the citations/)).toBeNull();
    expect(screen.queryByText(/partial answer/)).toBeNull();
    expect(signals[0]?.aborted).toBe(false);
    // The next question closes the waiting stream; the first answer stays complete.
    await userEvent.type(box, "And after the deadline?{Enter}");
    await waitFor(() => expect(signals[0]?.aborted).toBe(true));
    expect(signals).toHaveLength(2);
    expect(screen.queryByText(/Stopped/)).toBeNull();
  });

  it("waits for citations_checked when message_end says the citations are being checked", async () => {
    mockApi(routes({ [chatURL]: (_b, call) => openSSE(answer("m1", "You can drop a class in the portal [1].", { citationsPending: true }), call.signal) }));
    renderApp(chatPath);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message Registrar assistant" }), "How do I drop a class?{Enter}");
    expect(await screen.findByText("Checking the citations…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop/ })).toBeInTheDocument();
  });
});

describe("chips arriving after the answer (walkthrough, 2026-10-02)", () => {
  const done = (suggestions?: string[], status = "done"): ChatItem =>
    ({ role: "assistant", key: "a1", text: "Yes [1].", status, steps: [], citations: [citation], suggestions }) as unknown as ChatItem;
  const seen = (suggested: boolean, complete = true) => ({ key: "a1", complete, suggested });

  it("are an arrival only after the answer was shown complete without them", () => {
    expect(suggestionsArrived(seen(false), done(follow))).toBe(true);
    // With the answer (a saved answer replayed), already shown, another answer, or nothing seen: not an arrival.
    expect(suggestionsArrived(seen(false, false), done(follow))).toBe(false);
    expect(suggestionsArrived(seen(true), done(follow))).toBe(false);
    expect(suggestionsArrived({ key: "a0", complete: true, suggested: false }, done(follow))).toBe(false);
    expect(suggestionsArrived(undefined, done(follow))).toBe(false);
    expect(suggestionsArrived(seen(false), done())).toBe(false);
  });

  function View({ item }: { item: ChatItem }) {
    const list = item.role === "assistant" ? (item.suggestions ?? []) : [];
    return (
      <Conversation>
        <ConversationContent>
          <p>Yes.</p>
          {list.length > 0 && <div data-chat-suggestions="">{list.join(" ")}</div>}
        </ConversationContent>
        <ShowSuggestions items={[item]} />
      </Conversation>
    );
  }
  /** The conversation 1,000 px tall in a 400 px view, scrolled to `top`. */
  function setup(top: number) {
    const view = render(<View item={done()} />);
    const log = screen.getByRole("log");
    Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(log, "clientHeight", { configurable: true, get: () => 400 });
    const scrollTo = vi.fn();
    log.scrollTo = scrollTo as unknown as typeof log.scrollTo;
    act(() => {
      log.scrollTop = 600;
      fireEvent.scroll(log);
    });
    act(() => {
      log.scrollTop = top;
      fireEvent.scroll(log);
    });
    return { ...view, log, scrollTo };
  }

  it("glide into view when the reader was at the bottom, though the view had stopped following", () => {
    // 40 px from the bottom, after the view moved up to show a whole answer from its question.
    const { rerender, scrollTo } = setup(560);
    rerender(<View item={done(follow)} />);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
  });

  it("don't move a reader who scrolled up", () => {
    const { rerender, scrollTo, log } = setup(200);
    rerender(<View item={done(follow)} />);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(log.scrollTop).toBe(200);
  });
});

describe("a refusal read back from a stored conversation (walkthrough, 2026-10-02)", () => {
  const stored = (refused?: boolean): Schemas["ConversationMessage"][] => [
    { id: "u1", seq: 1, role: "user", text: "What's on the cafeteria menu?", createdAt: "2026-10-02T20:00:00Z" },
    { id: "m1", seq: 2, role: "assistant", text: "I couldn't find that in my sources.", refused, createdAt: "2026-10-02T20:00:05Z" },
  ];

  it("offers the starters again after a reload, without saying why it refused (that isn't stored)", async () => {
    const asked: string[] = [];
    const { container } = renderBare(
      <ChatMessages items={itemsFromConversation(stored(true))} agent={{ name: "Helper", starterQuestions: card.starterQuestions }} onStarter={(q) => asked.push(q)} />,
    );
    const group = await screen.findByRole("group", { name: "You can ask" });
    await userEvent.click(within(group).getByRole("button", { name: "How do I drop a class?" }));
    expect(asked).toEqual(["How do I drop a class?"]);
    expect(screen.queryByText(/searched its sources and found nothing/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offers none under an answer that wasn't a refusal (or one stored before the flag)", async () => {
    renderBare(<ChatMessages items={itemsFromConversation(stored())} agent={{ name: "Helper", starterQuestions: card.starterQuestions }} onStarter={() => {}} />);
    expect(await screen.findByText("I couldn't find that in my sources.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "You can ask" })).toBeNull();
  });
});

describe("the agent's setting", () => {
  const config = { ...(defaultConfig as Schemas["AgentConfig"]), moderation: { categories: {}, outputMode: "" }, audience: "team" } as Schemas["AgentConfig"];

  it("is on by default and for configurations saved before v0.4.1, and the summary says when it's off", () => {
    expect(defaultConfig.followUpSuggestions).toBe(true);
    const { followUpSuggestions: _omit, ...old } = config;
    expect(configInput(old as Schemas["AgentConfig"]).followUpSuggestions).toBe(true);
    expect(configInput({ ...config, followUpSuggestions: false }).followUpSuggestions).toBe(false);
    const summary = (c: Schemas["AgentConfig"]) => sectionSummary("advanced", { c, kbName: () => "" } as never);
    expect(summary({ ...config, followUpSuggestions: false })).toMatch(/no follow-up suggestions/);
    expect(summary(config)).toMatch(/suggests follow-up questions/);
    // The query rewrite reads as a different thing (walkthrough, 2026-10-02).
    expect(summary({ ...config, queryRewrite: true })).toMatch(/rewrites follow-up questions into searches · suggests follow-up questions/);
  });

  it("Build → Advanced has the switch, saved with the draft", async () => {
    const draft = { ...config, chatModelId: "mod1", kbs: [{ kbId: "kb1", topK: null }], followUpSuggestions: true };
    const ag = (d: Schemas["AgentConfig"]): Schemas["Agent"] => ({
      id: "ag1", teamId: "t1", teamSlug: "registrar", slug: "helper", name: "Helper", description: "", accentColor: "", welcomeMessage: "", starterQuestions: [],
      status: "active", disabledReason: "", disabledAt: null, audience: "team", draft: d, draftRevision: 1, published: null, hasUnpublishedChanges: true,
      warnings: [], revision: 2, createdAt: "2026-09-26T09:00:00Z", updatedAt: "2026-09-26T10:00:00Z",
    });
    const calls = mockApi({
      ...shellRoutes(),
      "GET /v1/teams/registrar/agents/ag1": () => ag(draft),
      "GET /v1/teams/registrar/agents/ag1/versions": () => [],
      "GET /v1/chat-models": () => [],
      "GET /v1/teams/registrar/kbs": () => [],
      "PATCH /v1/teams/registrar/agents/ag1": (b) => ag({ ...draft, ...(b as { config: object }).config }),
    });
    const { container } = renderApp("/teams/registrar/agents/ag1");
    await userEvent.click(await screen.findByRole("button", { name: /^Advanced/ }, { timeout: 5000 }));
    const sw = screen.getByRole("switch", { name: /Suggest follow-up questions/ });
    expect(sw).toBeChecked();
    expect(sw).toHaveAccessibleDescription(/up to 3 questions its sources can answer/);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: 3000 });
    expect((calls.find((c) => c.method === "PATCH")!.body as { config: { followUpSuggestions: boolean } }).config.followUpSuggestions).toBe(false);
  }, 15_000);
});
