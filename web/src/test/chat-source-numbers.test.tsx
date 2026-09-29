import { screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Schemas } from "../api/client";
import { displayNumbers } from "../pages/chat/citations";
import { type AssistantItem, type ChatItem, applyChatEvent, pendingAssistant } from "../pages/chat/stream";
import { ChatMessages } from "../pages/chat/thread";
import { renderBare } from "./harness";

/*
 * Source numbers in an answer (the v0.2.1 walkthrough): the model may cite sources 1, 4 and 5 of those it was given;
 * the chat shows them as 1, 2 and 3 (chips, cards and names), keeping the stored numbers. A chip keeps the full stop
 * after it on its line.
 */

const cite = (n: number): Schemas["Citation"] => ({ n, documentId: `d${n}`, sourceId: "s", title: `Page ${n}`, snippet: `Passage ${n}.`, headingPath: [] });

function answer(text: string, citations: Schemas["Citation"][]): ChatItem[] {
  let a: AssistantItem = applyChatEvent(pendingAssistant(), "message_end", { messageId: "m1", stopReason: "stop", text, citations, refused: false, noContext: false });
  a = applyChatEvent(a, "done", {});
  return [{ role: "user", key: "u1", text: "How do I order a transcript?" }, a];
}

describe("source numbers", () => {
  it("numbers the cited sources 1..n in the order of their numbers", () => {
    const num = displayNumbers([cite(5), cite(1), cite(4)]);
    expect([1, 4, 5].map(num)).toEqual([1, 2, 3]);
    expect(num(7)).toBe(7); // not cited: unchanged
  });

  it("shows sources 1, 4 and 5 as 1, 2 and 3, in the chips and the cards", async () => {
    const { container } = renderBare(
      <ChatMessages items={answer("Transcripts cost $10 [4]. Orders take ten business days [5][1].", [cite(1), cite(4), cite(5)])} agent={{ name: "Helper" }} />,
    );
    const chips = await screen.findAllByRole("button", { name: /^Source \d/ });
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual(["Source 2: Page 4", "Source 3: Page 5", "Source 1: Page 1"]);
    expect(chips.map((c) => c.textContent)).toEqual(["2", "3", "1"]);
    screen.getByRole("button", { name: "Used 3 sources" }).click();
    const list = await screen.findByRole("list", { name: "Sources for this answer" });
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Source 1: Page 1", "Source 2: Page 4", "Source 3: Page 5"]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps the punctuation after a chip, and a group of chips, on the chip's line", async () => {
    renderBare(<ChatMessages items={answer("Transcripts cost $10 [4]. Orders take ten business days [5][1].", [cite(1), cite(4), cite(5)])} agent={{ name: "Helper" }} />);
    const [four, five, one] = await screen.findAllByRole("button", { name: /^Source \d/ });
    const tail = four!.parentElement!;
    expect(tail.className).toMatch(/chipTail/);
    expect(tail.textContent).toBe("2.");
    // [5][1] and the full stop after them.
    expect(five!.parentElement).toBe(one!.parentElement);
    expect(one!.parentElement!.textContent).toBe("31.");
    expect(one!.closest("p")).toHaveTextContent("Transcripts cost $10 2. Orders take ten business days 31.");
  });
});
