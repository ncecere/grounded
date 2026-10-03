import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { type AssistantItem, type ChatItem, type SearchStep, itemsFromConversation, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { timeline } from "../pages/chat/timeline";
import { renderBare } from "./harness";

/* Reasoning and tool steps in the order they happened (docs/v0.4.1.md §6). */

const tool = (id: string, thinkingAt?: number): SearchStep => ({ kind: "tool", id, query: id, hitCount: 1, thinkingAt });
const retrieval: SearchStep = { kind: "retrieval", query: "fees", hitCount: 2, thinkingAt: 0 };
/** The parts in short: reasoning text, or the steps' ids/queries. */
const shape = (thinking: string, steps: SearchStep[]) =>
  timeline(thinking, steps).map((p) => (p.kind === "reasoning" ? p.text : p.steps.map((s) => s.id ?? s.query)));

describe("timeline", () => {
  it("keeps thinking without steps as one part, as it is", () => {
    expect(timeline("  Plan.\n", [])).toEqual([{ kind: "reasoning", key: "r0", text: "  Plan.\n" }]);
    expect(timeline("", [])).toEqual([]);
  });

  it("puts always-mode retrieval first", () => {
    expect(shape("Answer from the passages.", [retrieval])).toEqual([["fees"], "Answer from the passages."]);
  });

  it("splits thinking, a tool call, then thinking", () => {
    const thinking = "Look it up.\n\nFound it.";
    expect(shape(thinking, [tool("t1", 11)])).toEqual(["Look it up.", ["t1"], "Found it."]);
    expect(timeline(thinking, [tool("t1", 11)]).map((p) => p.key)).toEqual(["r0", "s11", "r11"]);
  });

  it("groups two tool calls of one turn", () => {
    expect(shape("Check both.\n\nDone.", [tool("t1", 11), tool("t2", 11)])).toEqual(["Check both.", ["t1", "t2"], "Done."]);
  });

  it("sorts by offset, keeping equal offsets in order", () => {
    expect(shape("One.\n\nTwo.", [tool("late", 4), tool("a", 0), tool("b", 0)])).toEqual([["a", "b"], "One.", ["late"], "Two."]);
  });

  it("clamps offsets past the end, below 0 or missing", () => {
    expect(shape("Short.", [tool("t1", 999)])).toEqual(["Short.", ["t1"]]);
    expect(shape("Short.", [tool("t1", -3), tool("t2")])).toEqual([["t1", "t2"], "Short."]);
  });

  it("drops empty and whitespace-only reasoning, joining the steps around it", () => {
    expect(shape("\n\nAfter.", [tool("t1", 0), tool("t2", 2)])).toEqual([["t1", "t2"], "After."]);
    expect(shape("Before.\n\n", [tool("t1", 7)])).toEqual(["Before.", ["t1"]]);
  });

  it("slices non-ASCII thinking by UTF-16 code units", () => {
    const first = "Café ☕ 𝄞 fee?";
    expect(shape(`${first}\n\nÜber.`, [tool("t1", first.length)])).toEqual([first, ["t1"], "Über."]);
  });
});

describe("a tool-mode answer", () => {
  const stored: Schemas["ConversationMessage"] = {
    id: "m1", seq: 2, role: "assistant", text: "The fee is $10.", thinking: "I should check the fee.\n\nThe tool says $10.",
    toolCalls: [{ id: "t1", name: "search_knowledge", arguments: { query: "transcript fee" }, isError: false, hitCount: 1, query: "transcript fee", thinkingBefore: 23 }],
    stopReason: "stop", createdAt: "2026-10-02T10:00:00Z",
  };
  const thread = (a?: ChatItem): ChatItem[] => [{ role: "user", key: "u1", text: "How much is a transcript?" }, a!];

  it("shows its reasoning, the tool step, then its reasoning again", async () => {
    const { container } = renderBare(<ChatMessages items={thread(itemsFromConversation([stored])[0])} agent={{ name: "Helper" }} showThinking />);
    const [before, after] = (await screen.findAllByRole("button", { name: /Thought for/ })) as [HTMLElement, HTMLElement];
    const step = screen.getByRole("button", { name: /Searched: “transcript fee”/ });
    expect(before.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(step.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(before);
    await userEvent.click(after);
    expect(await screen.findByText("I should check the fee.")).toBeInTheDocument();
    expect(screen.getByText("The tool says $10.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows readers the step alone", async () => {
    renderBare(<ChatMessages items={thread(itemsFromConversation([stored])[0])} agent={{ name: "Helper" }} />);
    expect(await screen.findByRole("button", { name: /Searched: “transcript fee”/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thought for|Thinking/ })).toBeNull();
  });

  it("streams only the last part of its reasoning", async () => {
    const live: AssistantItem = { ...pendingAssistant(), key: "a1", thinking: "Check.\n\nNow", steps: [tool("t1", 6)] };
    renderBare(<ChatMessages items={thread(live)} agent={{ name: "Helper" }} showThinking />);
    const triggers = await screen.findAllByRole("button", { name: /Thought for|Thinking/ });
    expect(triggers.map((t) => t.textContent)).toEqual(["Thought for a few seconds", "Thinking…"]);
  });
});
