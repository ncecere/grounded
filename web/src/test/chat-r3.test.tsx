/*
 * v0.4.2 re-test fixes in the chat (R3): a tool's step and source by its title (US2-10), Copy answer's sections
 * (US2-07), a new chat that starts in the message box and Skip to message box (US2-04), follow-up chips kept over a
 * reload (US2-09), a citation card without the title as its first heading (VI2-12), and Try it's rerank bars (BU2-09).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { copyText } from "../pages/chat/answer-text";
import { type AssistantItem, applyChatEvent, itemsFromConversation, pendingAssistant } from "../pages/chat/stream";
import { rememberSuggestions, withRememberedSuggestions } from "../pages/chat/suggestion-memory";
import { ChatMessages, copySourceTitle } from "../pages/chat/thread";
import { relevanceBars } from "../pages/team/retrieve";
import { mockApi, renderApp, renderBare, shellRoutes } from "./harness";

beforeAll(() => {
  window.scrollTo = () => {};
});
afterEach(() => sessionStorage.clear());

const cite = (n: number, heading: string[], extra: Partial<Schemas["Citation"]> = {}): Schemas["Citation"] => ({
  n, documentId: `d${n}`, sourceId: "s", title: "Connect to campus Wi-Fi", snippet: `Passage ${n}.`, headingPath: heading, ...extra,
});

describe("an answer's steps and sources", () => {
  it("names an MCP tool by its title, live and after a reload, and its source too (US2-10)", async () => {
    const toolHit = { n: 1, title: "Service status · check_outage", snippet: "Email: normal.", kind: "tool", server: "Service status", tool: "check_outage" };
    let a: AssistantItem = applyChatEvent(pendingAssistant(), "tool_call", { id: "c1", name: "check_outage", title: "Check outage", arguments: { service: "email" } });
    a = applyChatEvent(a, "retrieval", { query: "", hits: [toolHit] });
    a = applyChatEvent(a, "tool_result", { id: "c1", isError: false, hitCount: 1, result: "Email: normal." });
    const citation = { ...cite(1, []), kind: "tool" as const, server: "Service status", tool: "check_outage", title: "Service status · check_outage" };
    a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text: "Email works [1].", citations: [citation], refused: false, noContext: false });
    const { container } = renderBare(<ChatMessages items={[{ role: "user", key: "u1", text: "Is email down?" }, applyChatEvent(a, "done", {})]} agent={{ name: "Helper" }} />);
    expect(await screen.findByRole("button", { name: /^Used Check outage/ })).toBeInTheDocument();
    expect(screen.queryByText(/check_outage/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Used 1 source" }));
    expect(within(screen.getByRole("list", { name: "Sources for this answer" })).getByRole("listitem", { name: "Source 1: From Service status · Check outage" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    const stored: Schemas["ConversationMessage"][] = [
      { id: "m0", seq: 1, role: "user", text: "Is email down?", citations: [], createdAt: "2026-10-04T10:00:00Z" },
      {
        id: "m1", seq: 2, role: "assistant", text: "Email works.", citations: [], createdAt: "2026-10-04T10:00:05Z",
        toolCalls: [{ id: "c1", name: "check_outage", title: "Check outage", arguments: {}, isError: false, hitCount: 1, thinkingBefore: 0 }],
      },
    ];
    const step = (itemsFromConversation(stored)[1] as AssistantItem).steps[0]!;
    expect(step).toMatchObject({ name: "check_outage", title: "Check outage" });
  });

  it("copies each source with its section, as the screen and the export name them (US2-07)", () => {
    const item = applyChatEvent(pendingAssistant(), "message_end", {
      messageId: "m1", stopReason: "stop", text: "Use eduroam [1]. Guests use the portal [2]. Forget the network [3].",
      citations: [cite(1, ["Connect to campus Wi-Fi", "Networks"]), cite(2, ["Guests"], { pageStart: 2 }), cite(3, [])],
      refused: false, noContext: false,
    });
    expect(copyText(item, copySourceTitle)).toMatch(
      /Sources:\n1\. Connect to campus Wi-Fi — Networks\n2\. Connect to campus Wi-Fi — Guests, p\. 2\n3\. Connect to campus Wi-Fi$/,
    );
  });

  it("doesn't repeat the title as a citation card's first heading (VI2-12)", async () => {
    let a = applyChatEvent(pendingAssistant(), "message_end", {
      messageId: "m1", stopReason: "stop", text: "Use eduroam [1].", citations: [cite(1, ["Connect to campus Wi-Fi", "Networks"])], refused: false, noContext: false,
    });
    a = applyChatEvent(a, "done", {});
    renderBare(<ChatMessages items={[{ role: "user", key: "u1", text: "Wi-Fi?" }, a]} agent={{ name: "Helper" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Used 1 source" }));
    const card = within(screen.getByRole("list", { name: "Sources for this answer" })).getByRole("listitem");
    expect(card).toHaveTextContent("Networks");
    expect(card).not.toHaveTextContent("Connect to campus Wi-Fi › Networks");
  });
});

describe("follow-up chips over a reload (US2-09)", () => {
  const stored: Schemas["ConversationMessage"][] = [
    { id: "m0", seq: 1, role: "user", text: "How long can I keep a book?", citations: [], createdAt: "2026-10-04T10:00:00Z" },
    { id: "m1", seq: 2, role: "assistant", text: "Four weeks [1].", citations: [cite(1, [])], createdAt: "2026-10-04T10:00:05Z" },
  ];

  it("offers the last answer's chips again in this tab, only for that answer", () => {
    let live: AssistantItem = applyChatEvent(pendingAssistant(), "message_end", { messageId: "m1", stopReason: "stop", text: "Four weeks [1].", citations: [cite(1, [])], refused: false, noContext: false });
    live = applyChatEvent(live, "suggestions", { messageId: "m1", suggestions: ["Can I renew a book?"] });
    rememberSuggestions([{ role: "user", key: "u", text: "How long?" }, applyChatEvent(live, "done", {})]);
    const restored = withRememberedSuggestions(itemsFromConversation(stored));
    expect((restored[1] as AssistantItem).suggestions).toEqual(["Can I renew a book?"]);
    // Another answer (a newer one, or another conversation's) doesn't get them.
    const other = itemsFromConversation([stored[0]!, { ...stored[1]!, id: "m9" }]);
    expect((withRememberedSuggestions(other)[1] as AssistantItem).suggestions).toBeUndefined();
  });
});

describe("a new signed-in chat (US2-04)", () => {
  const card = {
    id: "ag1", teamSlug: "registrar", teamName: "Registrar", slug: "helper", name: "Helper", description: "", accentColor: "",
    welcomeMessage: "Ask me about registration.", starterQuestions: ["How do I drop a class?"], citationMode: "snippet_link", status: "active",
  };
  const routes = { ...shellRoutes(), "GET /v1/agents/registrar/helper": () => card, "GET /v1/agents": () => [card], "GET /v1/conversations": () => ({ items: [], nextCursor: null }) };

  it("starts in the message box, described by the welcome, and Skip to message box goes there", async () => {
    mockApi(routes);
    const { container } = renderApp("/a/registrar/helper");
    const box = await screen.findByRole("textbox", { name: "Message Helper" }, { timeout: 5000 });
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveAccessibleDescription(/Ask me about registration\./);
    const skip = screen.getByRole("link", { name: "Skip to message box" });
    skip.focus();
    await userEvent.keyboard("{Enter}");
    expect(box).toHaveFocus();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("doesn't take focus when a stored conversation opens", async () => {
    mockApi({
      ...routes,
      "GET /v1/conversations/c1": () => ({ conversation: { id: "c1", agentId: "ag1", title: "Drop", createdAt: "", updatedAt: "" }, messages: [] }),
    });
    renderApp("/a/registrar/helper?c=c1");
    const box = await screen.findByRole("textbox", { name: "Message Helper" }, { timeout: 5000 });
    expect(box).not.toHaveFocus();
  });
});

describe("knowledge base Try it bars (BU2-09)", () => {
  const hit = (score: number, rerankScore?: number) => ({ score, rerankScore }) as Parameters<ReturnType<typeof relevanceBars>>[0];

  it("follow the rerank score the list is ordered by, not the fused score", () => {
    const hits = [hit(0.0167, 0.516), hit(0.0159, -0.101), hit(0.0147, -0.171)];
    const bar = relevanceBars(hits);
    expect(bar(hits[0]!)).toBe(1);
    expect(bar(hits[1]!)).toBeCloseTo(0.1, 1);
    expect(bar(hits[2]!)).toBe(0.04);
    // A model that scores 0–1: the score itself.
    const scored = [hit(0.02, 0.9), hit(0.019, 0.2)];
    expect(relevanceBars(scored)(scored[1]!)).toBeCloseTo(0.2);
    // Not reranked: the fused score against the best one's.
    const fused = [hit(0.02), hit(0.01)];
    expect(relevanceBars(fused)(fused[1]!)).toBeCloseTo(0.5);
  });
});

