/*
 * The chat page while an answer streams (#252): the conversation lists are not rendered again for each token (they are
 * counted through their Load more, which every non-empty list renders), a background refetch of the open conversation
 * neither aborts the answer nor replaces the thread, and two composers in one document have their own counters.
 */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "../pages/chat/panel";
import type { useChat } from "../pages/chat/useChat";
import { type Call, findParagraph, mockApi, renderApp, renderBare, shellRoutes } from "./harness";

let listRenders = 0;
vi.mock("../components/query-view", async (original) => {
  const real = await original<typeof import("../components/query-view")>();
  return {
    ...real,
    LoadMore(props: Parameters<typeof real.LoadMore>[0]) {
      listRenders += 1;
      return real.LoadMore(props);
    },
  };
});

beforeEach(() => {
  listRenders = 0;
});

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
const summary = (id: string, title: string) => ({ id, agentId: "ag1", agentName: card.name, agentSlug: card.slug, teamSlug: "registrar", agentDeleted: false, title, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z" });
const message = (id: string, seq: number, role: "user" | "assistant", text: string) => ({ id, seq, role, text, citations: [], stopReason: role === "assistant" ? "stop" : undefined, toolCalls: [], createdAt: "2026-09-26T10:00:00Z" });

/** A chat stream the test writes to, event by event; it errors when the request is aborted. */
function liveStream(signal: AbortSignal) {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
      signal.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError")));
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    push: (event: string, data: unknown) => ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
  };
}

type Live = ReturnType<typeof liveStream> & { signal: AbortSignal };

function routes(extra: Record<string, () => unknown> = {}) {
  const live: { current?: Live } = {};
  const handlers = {
    ...shellRoutes(),
    "GET /v1/agents/registrar/registrar-assistant": () => card,
    "GET /v1/conversations": () => ({ items: [summary("c0", "Earlier question")], nextCursor: null }),
    "POST /v1/agents/registrar/registrar-assistant/chat": (_b: unknown, call: Call) => {
      const signal = call.signal ?? new AbortController().signal;
      live.current = { ...liveStream(signal), signal };
      return live.current.response;
    },
    ...extra,
  };
  return { handlers, live };
}

const tokens = async (live: { current?: Live }, words: string[]) => {
  for (const word of words) {
    await act(async () => live.current!.push("text_delta", { delta: word }));
  }
};

describe("the chat page while an answer streams", () => {
  it("does not render the conversation lists again for each token", async () => {
    const { handlers, live } = routes();
    const calls = mockApi(handlers);
    const { qc } = renderApp(chatPath);
    await userEvent.type(await screen.findByRole("textbox", { name: "Message Registrar assistant" }), "When is the deadline?{Enter}");
    await waitFor(() => expect(live.current).toBeDefined());
    await act(async () => {
      live.current!.push("conversation", { conversationId: "c1", userMessageId: "q1", agentVersion: 1 });
      live.current!.push("message_start", { messageId: "m1" });
      live.current!.push("text_delta", { delta: "The deadline " });
    });
    expect(await findParagraph(/The deadline/)).toBeInTheDocument();
    // The new conversation's ID moves into the URL and the lists are asked for again: both render the lists, once.
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.url === "/v1/conversations").length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    const before = listRenders;
    expect(before).toBeGreaterThan(0);
    await tokens(live, ["is ", "Friday ", "at ", "noon."]);
    expect(await findParagraph(/Friday at noon\./)).toBeInTheDocument();
    expect(listRenders).toBe(before);
  });

  it("keeps streaming when the open conversation is fetched again in the background", async () => {
    let stored = [message("q1", 1, "user", "How do I drop a class?"), message("m1", 2, "assistant", "Use the student portal.")];
    const { handlers, live } = routes({
      "GET /v1/conversations/c1": () => ({ conversation: summary("c1", "Dropping"), messages: stored }),
    });
    mockApi(handlers);
    const { qc } = renderApp(`${chatPath}?c=c1`);
    expect(await findParagraph(/Use the student portal/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Message Registrar assistant" }), "And the deadline?{Enter}");
    await waitFor(() => expect(live.current).toBeDefined());
    await act(async () => {
      live.current!.push("conversation", { conversationId: "c1", userMessageId: "q2", agentVersion: 1 });
      live.current!.push("message_start", { messageId: "m2" });
      live.current!.push("text_delta", { delta: "Friday " });
    });
    expect(await findParagraph(/^Friday/)).toBeInTheDocument();
    // The server has stored the question by now; a reconnect (or another view of it) reads the conversation again.
    stored = [...stored, message("q2", 3, "user", "And the deadline?")];
    await act(() => qc.refetchQueries({ queryKey: ["conversation", "c1"] }));
    expect(live.current!.signal.aborted).toBe(false);
    await tokens(live, ["at ", "noon."]);
    expect(await findParagraph(/Friday at noon\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    expect(screen.getAllByText("And the deadline?")).toHaveLength(1);
  });
});

describe("two composers in one document", () => {
  it("give each character counter its own id", async () => {
    const chat = {
      items: [],
      streaming: false,
      error: null,
      setError: () => {},
      announcement: "",
      send: async () => true,
      stop: () => {},
      reset: () => {},
      patch: () => {},
      adopt: () => {},
    } satisfies ReturnType<typeof useChat>;
    renderBare(
      <>
        <ChatPanel chat={chat} agent={{ name: "One" }} maxLength={3} />
        <ChatPanel chat={chat} agent={{ name: "Two" }} maxLength={3} />
      </>,
    );
    const one = await screen.findByRole("textbox", { name: "Message One" });
    const two = screen.getByRole("textbox", { name: "Message Two" });
    await userEvent.type(one, "Hello");
    await userEvent.type(two, "Hello");
    const ids = [one, two].map((box) => box.getAttribute("aria-describedby")!.split(" ")[0]!);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(document.getElementById(id)).toHaveTextContent("5 / 3 (too long)");
  });
});
