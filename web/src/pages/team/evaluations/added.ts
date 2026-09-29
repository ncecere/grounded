/*
 * Answers added to evaluations, so "Add to evaluations" reads "Added to
 * evaluations" afterwards. Stored answers are remembered by message id in
 * this browser (the question keeps no link to the conversation, ADR-0010);
 * the Test panel's answers, which have no id, for the page session.
 */
import { useSyncExternalStore } from "react";

const storageKey = "grounded.evaluations.added";
const keep = 500;

function load(): string[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let added = new Set<string>(load());
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The key of an answer: its message id, or its place in an unsaved chat (as answerToAdd keys it). */
export const answerKey = (item: { id?: string; key: string }) => (item.id ? item.id : `session:${item.key}`);

/** Records an answer as added. */
export function markAdded(key: string) {
  added = new Set(added).add(key);
  const stored = [...added].filter((k) => !k.startsWith("session:")).slice(-keep);
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(stored));
  } catch {
    // Storage full or blocked: remembered for this page only.
  }
  for (const l of listeners) l();
}

/** Whether an answer was added (re-renders when one is). */
export function useAddedAnswers() {
  const set = useSyncExternalStore(subscribe, () => added);
  return (key: string) => set.has(key);
}

/** Forgets everything (tests). */
export function resetAdded() {
  added = new Set(load());
}
