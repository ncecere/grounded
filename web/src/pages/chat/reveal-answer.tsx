/*
 * An answer that arrives whole (buffered: checked by moderation before it's shown, or a saved answer replayed) would
 * otherwise land with its last lines in view, because the conversation follows the bottom. When it arrives, the view
 * moves up so its question is at the top and the answer starts right below it. Moving up also stops following the
 * bottom, so later changes (the citation check) don't pull the view down again. Streamed answers keep following as
 * they're written.
 *
 * Checked paragraphs (stream_checked) arrive a chunk at a time: while the view follows the bottom, a released chunk
 * taller than the view is shown from its start (the first one from its question, like a whole answer), and following
 * stops there, so the reader isn't pulled past it by the next chunk.
 */
import { useLayoutEffect, useRef } from "react";
import { useConversation } from "@/components/ui/conversation/conversation";
import type { ChatItem } from "./stream";

/** Space left above the question or the chunk, in px. */
const GAP = 16;
/** Room for what renders just after the text (the sources row, the citation check, the feedback buttons), in px. */
const TRAILING = 160;

type Seen = { key: string; hadText: boolean; textLength: number; bottom: number };

/** The key of an answer whose whole text just arrived (it was buffered and had no text before), else "". */
export function arrivedWhole(prev: { key: string; hadText: boolean } | undefined, last: ChatItem | undefined): string {
  if (!last || last.role !== "assistant" || !last.buffered || !last.text) return "";
  return prev && prev.key === last.key && !prev.hadText ? last.key : "";
}

/** A checked answer's newly released chunk: "first" (its first text), "next" (a later chunk), else "". */
export function releasedChunk(prev: { key: string; hadText: boolean; textLength: number } | undefined, last: ChatItem | undefined): "" | "first" | "next" {
  if (!prev || !last || last.role !== "assistant" || !last.checked || !last.text || last.status !== "streaming") return "";
  if (prev.key !== last.key || last.text.length <= prev.textLength) return "";
  return prev.hadText ? "next" : "first";
}

/** An element's top and bottom in the viewport's scroll coordinates. */
function span(viewport: HTMLElement, el: Element) {
  const r = el.getBoundingClientRect();
  const top = viewport.scrollTop + r.top - viewport.getBoundingClientRect().top;
  return { top, bottom: top + r.height };
}

export function RevealBufferedAnswer({ items }: { items: ChatItem[] }) {
  const { viewport, scrollToElement, isStuck } = useConversation();
  const last = items[items.length - 1];
  const prev = useRef<Seen | undefined>(undefined);
  // A layout effect: right after the answer is in the DOM and before the conversation's own observers pin the view to
  // the bottom. No frame delay, so the citation and done events that follow within milliseconds can't cancel it.
  useLayoutEffect(() => {
    const seen = prev.current;
    const answers = viewport?.querySelectorAll<HTMLElement>("[data-chat-answer]");
    const answer = answers?.[answers.length - 1];
    const bottom = viewport && answer ? span(viewport, answer).bottom : 0;
    prev.current =
      last && last.role === "assistant" ? { key: last.key, hadText: Boolean(last.text), textLength: last.text.length, bottom } : undefined;
    if (!viewport) return;
    const questions = viewport.querySelectorAll<HTMLElement>("[data-chat-question]");
    const question = questions[questions.length - 1];
    const chunk = isStuck() ? releasedChunk(seen, last) : "";
    if ((arrivedWhole(seen, last) || chunk === "first") && question) {
      // The answer (and the rows that render right after it) fits below its question: leave the view at the bottom.
      const fromQuestion = viewport.scrollHeight - span(viewport, question).top;
      if (fromQuestion + TRAILING > viewport.clientHeight) scrollToElement(question, { offset: GAP });
    } else if (chunk === "next" && answer && seen) {
      // The chunk starts where the answer ended before it; bring that to the top when the chunk can't be read whole.
      if (bottom - seen.bottom + TRAILING > viewport.clientHeight) scrollToElement(answer, { offset: span(viewport, answer).top - seen.bottom + GAP });
    }
  }, [last, viewport, scrollToElement, isStuck]);
  return null;
}
