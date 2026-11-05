/*
 * Personal data scanning at ingest (docs/pii-scanning.md): the admin form, the words for the kinds found, and a
 * document's state. A finding is a kind, a count and pages: the matched text never reaches the browser.
 */
import type { components } from "@/api/schema.gen";

export type PiiSettings = components["schemas"]["PiiSettings"];
export type PiiSettingsInput = components["schemas"]["PiiSettingsInput"];
export type DocumentPii = components["schemas"]["DocumentPii"];
export type PiiFinding = components["schemas"]["PiiFinding"];

export type PiiForm = { enabled: boolean; blockLevels: string[]; patterns: { name: string; pattern: string }[] };

export const MAX_PATTERNS = 20;

export const piiForm = (s: PiiSettings): PiiForm => ({
  enabled: s.enabled,
  blockLevels: [...s.blockLevels].sort(),
  patterns: s.patterns.map((p) => ({ name: p.name, pattern: p.pattern })),
});

export const piiInput = (f: PiiForm): PiiSettingsInput => ({
  enabled: f.enabled,
  blockLevels: f.blockLevels,
  patterns: f.patterns.map((p) => ({ name: p.name.trim(), pattern: p.pattern })),
});

const builtIn = new Set(["us_ssn", "payment_card"]);

export type PatternProblem = { field: "name" | "pattern"; message: string };

/** What's wrong with each pattern row, by index, and which field says so (the server checks the expression itself, RE2). */
export function patternProblems(f: PiiForm): Record<number, PatternProblem> {
  const out: Record<number, PatternProblem> = {};
  const seen = new Set<string>();
  f.patterns.forEach((p, i) => {
    const name = p.name.trim();
    if (!name) out[i] = { field: "name", message: "Give the pattern a name." };
    else if (name.length > 60) out[i] = { field: "name", message: "Use at most 60 characters for the name." };
    else if (builtIn.has(name) || seen.has(name.toLowerCase())) out[i] = { field: "name", message: "Use a name no other pattern has." };
    else if (!p.pattern) out[i] = { field: "pattern", message: "Enter a regular expression." };
    else if (p.pattern.length > 500) out[i] = { field: "pattern", message: "Use at most 500 characters for the expression." };
    seen.add(name.toLowerCase());
  });
  return out;
}

/** How many fields differ from what is saved, for the save bar. */
export function piiChanges(saved: PiiSettings, f: PiiForm): number {
  const s = piiForm(saved);
  let n = 0;
  if (s.enabled !== f.enabled) n++;
  if (JSON.stringify(s.blockLevels) !== JSON.stringify([...f.blockLevels].sort())) n++;
  if (JSON.stringify(s.patterns) !== JSON.stringify(f.patterns)) n++;
  return n;
}

const kindWords: Record<string, [string, string]> = {
  us_ssn: ["possible US Social Security number", "possible US Social Security numbers"],
  payment_card: ["possible payment card number", "possible payment card numbers"],
};

/** A kind found, in words: a built-in kind's name, or an admin pattern's own name. */
export const kindLabel = (kind: string) => (kind === "us_ssn" ? "US Social Security numbers" : kind === "payment_card" ? "Payment card numbers" : kind);

const pageList = (pages: number[]) =>
  pages.length === 0 ? "" : pages.length === 1 ? ` on page ${pages[0]}` : ` on pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;

/** One finding in a sentence: "2 possible US Social Security numbers on pages 2 and 4". */
export function findingText(f: PiiFinding): string {
  const words = kindWords[f.kind];
  const noun = words ? words[f.count === 1 ? 0 : 1] : `${f.count === 1 ? "match" : "matches"} of “${f.kind}”`;
  return `${f.count.toLocaleString()} ${noun}${pageList(f.pages)}`;
}

export const piiStateLabel: Record<DocumentPii["state"], string> = {
  flagged: "Possible personal data",
  held: "Held for review",
  dismissed: "Personal data flag dismissed",
  approved: "Approved after review",
};

/** Whether a document is waiting for an editor's review (Needs attention, the review filter). */
export const awaitingReview = (pii: DocumentPii | null | undefined): pii is DocumentPii => pii?.state === "flagged" || pii?.state === "held";
