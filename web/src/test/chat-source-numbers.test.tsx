import { screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { copyText } from "../pages/chat/answer-text";
import { displayNumbers } from "../pages/chat/citations";
import { type AssistantItem, type ChatItem, applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { renderBare } from "./harness";

/*
 * Source numbers in an answer (the v0.2.1 walkthrough): the model may cite sources 1, 4 and 5 of those it was given;
 * the chat shows them as 1, 2 and 3 in the order the answer first cites them (chips, cards and names; v0.4.2 US-03),
 * keeping the stored numbers. A chip keeps the full stop after it on its line.
 */

const cite = (n: number): Schemas["Citation"] => ({ n, documentId: `d${n}`, sourceId: "s", title: `Page ${n}`, snippet: `Passage ${n}.`, headingPath: [] });

function answer(text: string, citations: Schemas["Citation"][]): ChatItem[] {
  let a: AssistantItem = applyChatEvent(pendingAssistant(), "message_end", { messageId: "m1", stopReason: "stop", text, citations, refused: false, noContext: false });
  a = applyChatEvent(a, "done", {});
  return [{ role: "user", key: "u1", text: "How do I order a transcript?" }, a];
}

describe("source numbers", () => {
  it("numbers the cited sources 1..n in the order the text first cites them, then the others by number", () => {
    const num = displayNumbers([cite(5), cite(1), cite(4)]);
    expect([1, 4, 5].map(num)).toEqual([1, 2, 3]);
    expect(num(7)).toBe(7); // not cited: unchanged
    const byText = displayNumbers([cite(1), cite(2), cite(4), cite(6)], "Eduroam [2]. Staff [1][2]. Guests 【4】, see a[6].");
    expect([2, 1, 4, 6].map(byText)).toEqual([1, 2, 3, 4]);
  });

  it("shows sources 1, 4 and 5 as 1, 2 and 3, in the chips and the cards", async () => {
    const { container } = renderBare(
      <ChatMessages items={answer("Transcripts cost $10 [4]. Orders take ten business days [5][1].", [cite(1), cite(4), cite(5)])} agent={{ name: "Helper" }} />,
    );
    const chips = await screen.findAllByRole("button", { name: /^Source \d/ });
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual(["Source 1: Page 4", "Source 2: Page 5", "Source 3: Page 1"]);
    expect(chips.map((c) => c.textContent)).toEqual(["1", "2", "3"]);
    screen.getByRole("button", { name: "Used 3 sources" }).click();
    const list = await screen.findByRole("list", { name: "Sources for this answer" });
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Source 1: Page 4", "Source 2: Page 5", "Source 3: Page 1"]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps the punctuation after a chip, and a group of chips, on the chip's line", async () => {
    renderBare(<ChatMessages items={answer("Transcripts cost $10 [4]. Orders take ten business days [5][1].", [cite(1), cite(4), cite(5)])} agent={{ name: "Helper" }} />);
    const [four, five, one] = await screen.findAllByRole("button", { name: /^Source \d/ });
    const tail = four!.parentElement!;
    expect(tail.className).toMatch(/chipTail/);
    expect(tail.textContent).toBe("1.");
    // [5][1] and the full stop after them.
    expect(five!.parentElement).toBe(one!.parentElement);
    expect(one!.parentElement!.textContent).toBe("23.");
    expect(one!.closest("p")).toHaveTextContent("Transcripts cost $10 1. Orders take ten business days 23.");
    // The space before a chip and its punctuation doesn't break either (US-10): "days" never ends a line alone.
    expect(tail.previousSibling?.textContent).toMatch(/\$10\u00a0$/);
  });

  it("numbers a streaming answer's chips as the finished answer does, and hides an unfinished marker (US-03, US-05)", async () => {
    const hits = [1, 2, 4].map((n) => ({ n, title: `Page ${n}`, snippet: `Passage ${n}.` }));
    let a: AssistantItem = applyChatEvent(pendingAssistant(), "retrieval", { query: "eduroam", hits });
    a = applyChatEvent(a, "message_start", { messageId: "m1" });
    a = applyChatEvent(a, "text_delta", { delta: "Use eduroam [2]. Staff use it too [1][2]. Guests use the portal [4" });
    const user: ChatItem = { role: "user", key: "u1", text: "How do I connect?" };
    const { rerender, container } = renderBare(<ChatMessages items={[user, a]} agent={{ name: "Helper" }} />);
    const streamed = await screen.findAllByRole("button", { name: /^Source \d/ });
    expect(streamed.map((c) => c.textContent)).toEqual(["1", "2", "1"]);
    expect(container.textContent).not.toMatch(/\[4|\[\d/);
    const text = "Use eduroam [2]. Staff use it too [1][2]. Guests use the portal [4].";
    a = applyChatEvent(a, "message_end", { messageId: "m1", stopReason: "stop", text, citations: [cite(1), cite(2), cite(4)], refused: false, noContext: false });
    a = applyChatEvent(a, "done", {});
    rerender(<ChatMessages items={[user, a]} agent={{ name: "Helper" }} />);
    const done = await screen.findAllByRole("button", { name: /^Source \d/ });
    expect(done.map((c) => c.textContent)).toEqual(["1", "2", "1", "3"]);
  });

  it("copies the answer with the numbers on screen and its sources (US-03)", () => {
    const [, item] = answer("Transcripts cost $10 [4]. Orders take ten business days [5][1].", [cite(1), cite(4), { ...cite(5), url: "https://registrar.example.edu/" }]);
    expect(copyText(item as AssistantItem, (s) => s.title)).toBe(
      "Transcripts cost $10 [1]. Orders take ten business days [2][3].\n\nSources:\n1. Page 4\n2. Page 5 <https://registrar.example.edu/>\n3. Page 1",
    );
  });
});
