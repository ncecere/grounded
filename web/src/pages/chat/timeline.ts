/*
 * An answer's reasoning and steps in the order they happened. In tool mode and
 * with MCP tools the model reasons, calls a tool, then reasons again: each
 * step records how much thinking came before it (thinkingAt, UTF-16 code units
 * as JavaScript counts them: from the stream, or a stored call's
 * thinkingBefore), and the thinking is cut there. Always-mode retrieval runs
 * before the model, at 0.
 */
import type { SearchStep } from "./stream";

export type TimelinePart =
  | { kind: "reasoning"; key: string; text: string }
  | { kind: "steps"; key: string; steps: SearchStep[] };

/**
 * Splits thinking at the steps' offsets (clamped to the thinking, sorted, equal
 * offsets kept in order) into reasoning and groups of steps. Whitespace-only
 * reasoning is dropped (steps around it join one group); keys are the parts'
 * start offsets, so a part keeps its key while the thinking grows. Without
 * steps the thinking is one part, as it is.
 */
export function timeline(thinking: string, steps: SearchStep[]): TimelinePart[] {
  if (steps.length === 0) return thinking ? [{ kind: "reasoning", key: "r0", text: thinking }] : [];
  const at = (s: SearchStep) => Math.min(Math.max(0, Math.floor(s.thinkingAt ?? 0) || 0), thinking.length);
  const ordered = steps.map((step, i) => ({ step, i, at: at(step) })).sort((a, b) => a.at - b.at || a.i - b.i);
  const parts: TimelinePart[] = [];
  const reason = (from: number, to?: number) => {
    const text = thinking.slice(from, to).trim();
    if (text) parts.push({ kind: "reasoning", key: `r${from}`, text });
  };
  let pos = 0;
  for (const { step, at: off } of ordered) {
    if (off > pos) reason(pos, off);
    pos = off;
    const last = parts[parts.length - 1];
    if (last?.kind === "steps") last.steps.push(step);
    else parts.push({ kind: "steps", key: `s${off}`, steps: [step] });
  }
  reason(pos);
  return parts;
}
