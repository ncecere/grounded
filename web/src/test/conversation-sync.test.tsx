/* #128: two tabs on one conversation see each other's messages, and ?c=null says the conversation isn't available. */
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { conversationParam, mergeConversation } from "../pages/chat/conversation-sync";
import type { AssistantItem, ChatItem, UserItem } from "../pages/chat/stream";
import { findParagraph, mockApi, renderApp, shellRoutes, sse } from "./harness";

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
const conversation = { id: "c1", agentId: "ag1", agentName: card.name, agentSlug: card.slug, teamSlug: "registrar", agentDeleted: false, title: "Dropping", createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z" };
const message = (id: string, seq: number, role: "user" | "assistant", text: string) => ({ id, seq, role, text, citations: [], stopReason: role === "assistant" ? "stop" : undefined, toolCalls: [], createdAt: "2026-09-26T10:00:00Z" });

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  window.scrollTo = () => {};
});

const user = (text: string, id?: string): UserItem => ({ role: "user", key: `u-${text}`, id, text });
const answer = (id: string | undefined, text: string): AssistantItem => ({ role: "assistant", key: `a-${text}`, id, text, thinking: "", steps: [], sources: [], citations: [], status: "done" });

describe("mergeConversation (#128)", () => {
  it("changes nothing when the server has no answer this tab lacks", () => {
    const local: ChatItem[] = [user("q1"), answer("m1", "a1")];
    expect(mergeConversation(local, [user("q1", "s1"), answer("m1", "a1 stored")])).toBeNull();
  });

  it("adds another tab's messages in the server's order, keeping this tab's own items as they are", () => {
    const mine = [user("q1"), answer("m1", "a1 (with live sources)"), user("q3"), answer("m3", "a3 live")];
    const server = [user("q1", "s1"), answer("m1", "a1"), user("q2 other tab", "s2"), answer("m2", "a2 other tab"), user("q3", "s3"), answer("m3", "a3")];
    const merged = mergeConversation(mine, server)!;
    expect(merged.map((i) => i.text)).toEqual(["q1", "a1 (with live sources)", "q2 other tab", "a2 other tab", "q3", "a3 live"]);
    expect(merged[1]).toBe(mine[1]);
    expect(merged[5]).toBe(mine[3]);
  });

  it("keeps a question of this tab's that the server never stored, at the end", () => {
    const failed = [user("q1"), answer("m1", "a1"), user("offline q"), answer(undefined, "lost")];
    const merged = mergeConversation(failed, [user("q1", "s1"), answer("m1", "a1"), user("q2", "s2"), answer("m2", "a2")])!;
    expect(merged.map((i) => i.text)).toEqual(["q1", "a1", "q2", "a2", "offline q", "lost"]);
  });
});

describe("the chat page (#128)", () => {
  it("reads ?c=null as a conversation that isn't available, not a blank chat", async () => {
    expect(conversationParam({ c: null })).toBe("null");
    expect(conversationParam({})).toBeUndefined();
    mockApi({
      ...shellRoutes(),
      "GET /v1/agents/registrar/registrar-assistant": () => card,
      "GET /v1/conversations/null": () => new Response(JSON.stringify({ error: { code: "invalid_id", message: "Invalid conversationId" } }), { status: 400, headers: { "Content-Type": "application/json" } }),
    });
    renderApp(`${chatPath}?c=null`);
    expect(await screen.findByRole("heading", { name: "This conversation isn't available." })).toBeInTheDocument();
  });

  it("shows what another tab added when the page comes back into view, and after its own answer", async () => {
    let stored = [message("q1", 1, "user", "How do I drop a class?"), message("m1", 2, "assistant", "Use the student portal.")];
    mockApi({
      ...shellRoutes(),
      "GET /v1/agents/registrar/registrar-assistant": () => card,
      "GET /v1/conversations/c1": () => ({ conversation, messages: stored }),
      "POST /v1/agents/registrar/registrar-assistant/chat": () => {
        stored = [...stored, message("q4", 5, "user", "And the deadline?"), message("m4", 6, "assistant", "Friday at noon.")];
        return sse([
          ["conversation", { conversationId: "c1", userMessageId: "q4", agentVersion: 1 }],
          ["message_start", { messageId: "m4" }],
          ["message_end", { messageId: "m4", stopReason: "stop", text: "Friday at noon.", citations: [], refused: false, noContext: false }],
          ["done", {}],
        ]);
      },
    });
    renderApp(`${chatPath}?c=c1`);
    expect(await findParagraph(/Use the student portal/)).toBeInTheDocument();

    // Another tab asks and gets an answer; this tab is hidden meanwhile and comes back.
    stored = [...stored, message("q2", 3, "user", "Is there a fee?"), message("m2", 4, "assistant", "Twenty dollars after week two.")];
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await findParagraph(/Twenty dollars after week two/)).toBeInTheDocument();
    expect(screen.getByText("Is there a fee?")).toBeInTheDocument();

    // This tab asks; the other tab's next exchange lands first on the server and shows up after this tab's answer.
    stored = [...stored, message("q3", 3, "user", "Can I drop online?"), message("m3", 4, "assistant", "Yes, until Friday.")];
    await userEvent.type(screen.getByRole("textbox", { name: "Message Registrar assistant" }), "And the deadline?{Enter}");
    expect(await findParagraph(/Friday at noon/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Can I drop online?")).toBeInTheDocument());
    // In the server's order: the other tab's exchange, then this tab's question and answer.
    const page = screen.getByRole("main").textContent ?? "";
    const at = (s: string) => page.indexOf(s);
    const order = [at("Twenty dollars"), at("Can I drop online"), at("Yes, until Friday"), at("And the deadline?"), at("Friday at noon")];
    expect(order.every((v) => v >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });
});
