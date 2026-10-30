/*
 * Parent sections of an embedding profile (parent/child retrieval, docs/parent-child-retrieval.md), the parts that need no UI: what a size means
 * and what is wrong with one typed in a form. The field itself is in parents.tsx.
 */

/** The largest parent size the API accepts (tokens). */
export const PARENT_MAX = 8192;

/** What a parent size of `tokens` means, for the profile page and the preview's "Now:" line. */
export function parentSummary(tokens: number): string {
  return tokens > 0 ? `parent sections up to ${tokens} tokens` : "no parent sections";
}

/**
 * What is wrong with a parent size typed in a form, or undefined. Empty is "off" (a profile) or "keep" (a preview); 0 is off; anything else is at
 * least two passages and at most PARENT_MAX tokens, as the API checks it.
 */
export function parentProblem(text: string, chunkSize: number): string | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) return "Enter a whole number of tokens, or 0 for none.";
  if (n === 0) return undefined;
  if (n > PARENT_MAX) return `At most ${PARENT_MAX} tokens.`;
  if (n < 2 * chunkSize) return `At least twice the passage size: ${2 * chunkSize} tokens.`;
  return undefined;
}
