import { describe, expect, it } from "vitest";
import { arrivedWhole, releasedChunk } from "../pages/chat/reveal-answer";
import type { ChatItem } from "../pages/chat/stream";

const answer = (text: string, buffered = true): ChatItem => ({ role: "assistant", key: "a1", text, buffered, status: "streaming", steps: [] }) as unknown as ChatItem;

describe("a buffered answer arriving whole", () => {
  it("is reported once, when its text arrives", () => {
    expect(arrivedWhole({ key: "a1", hadText: false }, answer("The whole answer."))).toBe("a1");
    // Already had text (a re-render), another answer, or nothing seen before: not an arrival.
    expect(arrivedWhole({ key: "a1", hadText: true }, answer("The whole answer."))).toBe("");
    expect(arrivedWhole({ key: "a0", hadText: false }, answer("The whole answer."))).toBe("");
    expect(arrivedWhole(undefined, answer("The whole answer."))).toBe("");
  });

  it("leaves streamed answers, empty answers and questions alone", () => {
    expect(arrivedWhole({ key: "a1", hadText: false }, answer("The first words", false))).toBe("");
    // Checked paragraphs (stream_checked) grow like a streamed answer: followed, not shown from the start.
    const checked = { ...answer("The first paragraph.\n\n", false), checked: true } as ChatItem;
    expect(arrivedWhole({ key: "a1", hadText: false }, checked)).toBe("");
    expect(arrivedWhole({ key: "a1", hadText: false }, answer(""))).toBe("");
    expect(arrivedWhole({ key: "a1", hadText: false }, { role: "user", key: "u1", text: "Hi" })).toBe("");
    expect(arrivedWhole({ key: "a1", hadText: false }, undefined)).toBe("");
  });
});

describe("a checked answer's released chunks (mem-2)", () => {
  const checked = (text: string, status = "streaming") => ({ ...answer(text, false), checked: true, status }) as unknown as ChatItem;
  it("tells the first chunk from later ones", () => {
    expect(releasedChunk({ key: "a1", hadText: false, textLength: 0 }, checked("For undergraduates:\n\n"))).toBe("first");
    expect(releasedChunk({ key: "a1", hadText: true, textLength: 22 }, checked("For undergraduates:\n\n- Loans: 30 days."))).toBe("next");
  });
  it("ignores re-renders, other answers, finished and unchecked answers", () => {
    expect(releasedChunk({ key: "a1", hadText: true, textLength: 5 }, checked("Hello"))).toBe("");
    expect(releasedChunk({ key: "a0", hadText: false, textLength: 0 }, checked("Hello"))).toBe("");
    expect(releasedChunk({ key: "a1", hadText: true, textLength: 2 }, checked("Hello", "done"))).toBe("");
    expect(releasedChunk({ key: "a1", hadText: false, textLength: 0 }, answer("Hello", false))).toBe("");
    expect(releasedChunk(undefined, checked("Hello"))).toBe("");
  });
});
