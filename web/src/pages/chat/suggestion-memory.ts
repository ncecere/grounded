/*
 * Follow-up suggestions aren't stored with the conversation (docs/follow-ups.md). So that a reload doesn't take them
 * away (US2-09), the chat remembers the last answer's in this tab (sessionStorage) and offers them again when the
 * restored conversation still ends with that answer: the same on the chat page, the public page and the widget.
 */
import type { ChatItem } from "./stream";

const KEY = "grounded:last-suggestions";
type Memory = { messageId: string; suggestions: string[] };

function read(): Memory | undefined {
  try {
    const m = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Memory | null;
    return m && typeof m.messageId === "string" && Array.isArray(m.suggestions) ? m : undefined;
  } catch {
    return undefined; // storage blocked (a widget on a site that blocks it) or not JSON
  }
}

/** Keeps the last answer's suggestions, once it has them. */
export function rememberSuggestions(items: ChatItem[]) {
  const last = items[items.length - 1];
  if (last?.role !== "assistant" || !last.id || !last.suggestions?.length || last.restored) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ messageId: last.id, suggestions: last.suggestions } satisfies Memory));
  } catch {
    // Not remembered: a reload shows the answer without them.
  }
}

/** The items with the remembered suggestions on the last answer, when it's the answer they were offered under. */
export function withRememberedSuggestions(items: ChatItem[]): ChatItem[] {
  const last = items[items.length - 1];
  if (last?.role !== "assistant" || !last.restored || !last.id || last.suggestions?.length) return items;
  const m = read();
  if (!m || m.messageId !== last.id) return items;
  return [...items.slice(0, -1), { ...last, suggestions: m.suggestions.filter((q) => typeof q === "string").slice(0, 3) }];
}
