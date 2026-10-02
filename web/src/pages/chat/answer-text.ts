/*
 * The answer's text as the chat shows it. While an answer streams, the text
 * is the model's raw output; the server's finished text (message_end) is
 * normalised the same way (internal/agents/punctuation.go, citations.go).
 */
import type { AssistantItem, Citation } from "./stream";

/**
 * Typographic look-alikes some models write (gpt-oss among them): non-breaking
 * hyphens in e-mail addresses and phone numbers, narrow and other no-break
 * spaces. They break link detection ("military‑benefits@example.edu" was
 * linked as "benefits@example.edu") and copy and paste. En and em dashes and
 * the ideographic space are real punctuation and stay.
 */
const HYPHENS = /[\u2010-\u2012]/g;
const SPACES = /[\u00a0\u2000-\u200a\u202f\u205f]/g;
const INVISIBLE = /[\u00ad\u200b\u2060\ufeff]/g;

/** Plain hyphens and spaces for the look-alikes; invisible characters removed. */
export function normalizePunctuation(text: string) {
  return text.replace(HYPHENS, "-").replace(SPACES, " ").replace(INVISIBLE, "");
}

const WIDE_MARKER = /(?:［|【)(\d{1,3}(?:\s*[,，]\s*\d{1,3})*)(?:†[^】］]*)?(?:］|】)/g;

/**
 * Citation markers some models write in full-width or lenticular brackets
 * (［1］, 【1】, 【1†L10-L12】) as [1], as the server does for the finished answer
 * (internal/agents/citations.go), so they're chips from the start rather than raw text.
 */
export function normalizeMarkers(text: string) {
  return text.replace(WIDE_MARKER, (_m, nums: string, at: number, all: string) => {
    // Right after a word ("online【2】") it gets a space, or it would read as part of an identifier.
    const space = at > 0 && /[\p{L}\p{N}_]/u.test(all[at - 1]!) ? " " : "";
    return `${space}[${nums.replace(/，/g, ",")}]`;
  });
}

/** The text to render: punctuation normalised, and (while it streams) markers too. */
export function displayText(text: string, streaming: boolean) {
  const plain = normalizePunctuation(text);
  return streaming ? normalizeMarkers(plain) : plain;
}

/** An ASCII [n] or [n, m] marker with the spaces before it (after normalizeMarkers). */
const MARKER = /(\s*)\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?![\w(])/g;

/**
 * A partial answer (stopped, or cut off by a lost connection) never gets the
 * server's message_end, so its markers and citations are settled here as the
 * server settles the stored text (internal/agents/citations.go): markers
 * normalised and one per number, numbers of sources the model was given become
 * citations, other numbers are dropped with the space before them.
 */
export function settlePartial(item: AssistantItem): AssistantItem {
  if (item.citations.length > 0 || item.moderation) return { ...item, text: normalizePunctuation(item.text) };
  const byN = new Map(item.sources.map((s) => [s.n, s]));
  const cited = new Set<number>();
  let lastEnd = -1; // the end of the last marker, so [1][2] is two markers but m[i][2] none
  const text = normalizeMarkers(normalizePunctuation(item.text)).replace(MARKER, (m, lead: string, nums: string, at: number, all: string) => {
    const before = at > 0 && lead === "" ? all[at - 1]! : "";
    if (/\w/.test(before) || (before === "]" && lastEnd !== at)) return m; // a[3], m[i][2]: not a marker
    lastEnd = at + m.length;
    const kept = nums.split(/\s*,\s*/).map(Number).filter((n) => byN.has(n));
    kept.forEach((n) => cited.add(n));
    return kept.length ? `${lead}${kept.map((n) => `[${n}]`).join("")}` : "";
  });
  return { ...item, text: text.trimEnd(), citations: asCitations(cited, byN) };
}

type Hit = AssistantItem["sources"][number];

/** The sources of these numbers as citations, in order (the stream's hits carry no document IDs). */
function asCitations(numbers: Set<number>, byN: Map<number, Hit>): Citation[] {
  return [...numbers]
    .sort((a, b) => a - b)
    .map((n) => {
      const s = byN.get(n)!;
      return { n, documentId: "", sourceId: "", title: s.title, snippet: s.snippet, headingPath: [], ...(s.url ? { url: s.url } : {}) };
    });
}

/**
 * The sources the markers so far cite, before message_end brings the checked citations: checked paragraphs
 * (stream_checked) arrive whole, so their markers show as chips at once rather than as raw "[1]" that reflows later.
 */
export function citedSoFar(item: AssistantItem): Citation[] {
  const byN = new Map(item.sources.map((s) => [s.n, s]));
  const cited = new Set<number>();
  for (const m of normalizeMarkers(item.text).matchAll(MARKER)) {
    for (const n of m[2]!.split(/\s*,\s*/).map(Number)) if (byN.has(n)) cited.add(n);
  }
  return asCitations(cited, byN);
}
