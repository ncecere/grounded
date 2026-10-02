/*
 * An answer's progress before its first words, from the status events:
 * the waiting text under the agent's avatar and the screen-reader status
 * (one announcement per step). Servers without status events get the
 * older waiting text.
 */
import type { AssistantItem, ChatItem, ChatStep } from "./stream";

/** "Fees' knowledge", "Help Desk's knowledge". */
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** A step in words: "Searching Help Desk's knowledge…". */
export function stepLabel(step: ChatStep, agentName: string) {
  switch (step) {
    case "rewriting":
      return "Understanding the question…";
    case "searching":
      return `Searching ${possessive(agentName)} knowledge…`;
    case "checking":
      return "Checking the passages…";
    case "thinking":
      // Buffered and checked answers don't show the model's reasoning: only that it's happening.
      return "Thinking about your question…";
    case "answering":
      return "Writing the answer…";
  }
}

/**
 * A buffered answer (moderated before it is shown) arrives whole, and a checked one (stream_checked) a paragraph at a
 * time once each passes: until the first words, it is written and checked.
 */
const bufferedLabel = "Writing and checking the answer…";
const checksFirst = (item: AssistantItem) => Boolean(item.buffered || item.checked);

/** Waiting text before the answer's first words. */
export function waitingText(item: AssistantItem, thinking: boolean, agentName: string) {
  if (thinking) return "Thinking…";
  if (item.step === "thinking") return stepLabel("thinking", agentName);
  if (checksFirst(item) && (!item.step || item.step === "answering")) return bufferedLabel;
  if (item.step) return stepLabel(item.step, agentName);
  return item.steps.length > 0 ? "Reading the sources…" : "Working on it…";
}

/** What the polite status region says while the last answer has no words yet: its step, or "" (nothing to announce). */
export function progressAnnouncement(items: ChatItem[], agentName: string) {
  const last = items[items.length - 1];
  if (!last || last.role !== "assistant" || last.status !== "streaming" || last.text || last.moderation || !last.step) return "";
  return checksFirst(last) && last.step === "answering" ? bufferedLabel : stepLabel(last.step, agentName);
}
