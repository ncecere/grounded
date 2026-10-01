import { describe, expect, it } from "vitest";
import { arrivedWhole } from "../pages/chat/reveal-answer";
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
