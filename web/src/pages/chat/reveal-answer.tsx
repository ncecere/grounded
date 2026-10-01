/*
 * An answer that arrives whole (buffered: checked by moderation before it's shown) would otherwise land with its last
 * lines in view, because the conversation follows the bottom. When it arrives, the view moves up so its question is at
 * the top and the answer starts right below it. Moving up also stops following the bottom, so later changes (the
 * citation check) don't pull the view down again. Streamed answers keep following as they're written.
 */
import { useLayoutEffect, useRef } from "react";
import { useConversation } from "@/components/ui/conversation/conversation";
import type { ChatItem } from "./stream";

/** Space left above the question, in px. */
const GAP = 16;
/** Room for what renders just after the text (the sources row, the citation check, the feedback buttons), in px. */
const TRAILING = 160;

/** The key of an answer whose whole text just arrived (it was buffered and had no text before), else "". */
export function arrivedWhole(prev: { key: string; hadText: boolean } | undefined, last: ChatItem | undefined): string {
  if (!last || last.role !== "assistant" || !last.buffered || !last.text) return "";
  return prev && prev.key === last.key && !prev.hadText ? last.key : "";
}

export function RevealBufferedAnswer({ items }: { items: ChatItem[] }) {
  const { viewport, scrollToElement } = useConversation();
  const last = items[items.length - 1];
  const prev = useRef<{ key: string; hadText: boolean } | undefined>(undefined);
  // A layout effect: right after the answer is in the DOM and before the conversation's own observers pin the view to
  // the bottom. No frame delay, so the citation and done events that follow within milliseconds can't cancel it.
  useLayoutEffect(() => {
    const key = arrivedWhole(prev.current, last);
    prev.current = last && last.role === "assistant" ? { key: last.key, hadText: Boolean(last.text) } : undefined;
    if (!key || !viewport) return;
    const questions = viewport.querySelectorAll<HTMLElement>("[data-chat-question]");
    const question = questions[questions.length - 1];
    if (!question) return;
    // The answer (and the rows that render right after it) fits below its question: leave the view at the bottom.
    const fromQuestion = viewport.scrollHeight - (viewport.scrollTop + question.getBoundingClientRect().top - viewport.getBoundingClientRect().top);
    const answerFits = fromQuestion + TRAILING <= viewport.clientHeight;
    if (!answerFits) scrollToElement(question, { offset: GAP });
  }, [last, viewport, scrollToElement]);
  return null;
}
