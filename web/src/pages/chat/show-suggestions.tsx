/*
 * The follow-up suggestions arrive a few seconds after the answer is complete (docs/follow-ups.md). A reader who was at
 * the end of the conversation then would get them below the fold (the view stopped following when a whole answer was
 * shown from its question: reveal-answer.tsx) or with a jump (the view follows the bottom at once). So when they arrive
 * and the reader was at the bottom, the view glides down to show them (and follows the bottom again). A reader who
 * scrolled up isn't moved. Chips that arrive with the answer (a saved answer) are left to the reveal.
 */
import { useLayoutEffect, useRef } from "react";
import { distanceFromBottom, useConversation } from "@/components/ui/conversation/conversation";
import type { ChatItem } from "./stream";

/** How far above the bottom (px, before the chips) still counts as at the bottom: a row of answer actions. */
const NEAR = 80;

type Seen = { key: string; complete: boolean; suggested: boolean };

const seenOf = (last: ChatItem | undefined): Seen | undefined =>
  last && last.role === "assistant"
    ? { key: last.key, complete: last.status === "done" && last.text !== "", suggested: (last.suggestions?.length ?? 0) > 0 }
    : undefined;

/** Whether the last answer's suggestions just arrived, after the answer was already shown complete without them. */
export function suggestionsArrived(prev: Seen | undefined, last: ChatItem | undefined): boolean {
  const now = seenOf(last);
  return Boolean(prev && now && now.suggested && prev.key === now.key && prev.complete && !prev.suggested);
}

export function ShowSuggestions({ items }: { items: ChatItem[] }) {
  const { viewport, atBottom, scrollToBottom } = useConversation();
  const last = items[items.length - 1];
  const prev = useRef<Seen | undefined>(undefined);
  // The reader's place as of the last scroll or change, before the chips: read in the effect below.
  const wasAtBottom = useRef(atBottom);
  wasAtBottom.current = atBottom;
  // A layout effect: before the conversation's own observers see the chips (and pin the view at once while it follows).
  useLayoutEffect(() => {
    const seen = prev.current;
    prev.current = seenOf(last);
    if (!viewport || !suggestionsArrived(seen, last)) return;
    const groups = viewport.querySelectorAll<HTMLElement>("[data-chat-suggestions]");
    const group = groups[groups.length - 1];
    if (!group) return;
    // Measured now, the chips are already in: their height comes off the distance to the bottom.
    const before = distanceFromBottom(viewport) - group.offsetHeight;
    if (wasAtBottom.current || before <= NEAR) scrollToBottom("smooth");
  }, [last, viewport, scrollToBottom]);
  return null;
}
