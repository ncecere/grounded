/*
 * "Open the page" in the source viewer (docs/v0.4.0.md §5): the live web page
 * with a text fragment (#:~:text=start,end) that highlights the cited passage
 * where browsers support it, built from the passage's first and last words.
 * Others simply open the page.
 */
import { markdownToText } from "@/lib/plain-text";

/** Words of each end used for a long passage; a short one is matched whole. */
const EDGE = 4;

/** A text directive's term: URL-encoded, with the characters the syntax uses (- , &) encoded too. */
const term = (words: string[]) => encodeURIComponent(words.join(" ")).replace(/-/g, "%2D");

/** The passage as words, without Markdown, list markers, table pipes or lone punctuation. */
export function fragmentWords(markdown: string): string[] {
  return markdownToText(markdown)
    .replace(/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/gm, "")
    .replace(/\|/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** The page's URL with a text fragment for the passage (the URL as it is when the passage has no words). */
export function textFragmentUrl(url: string, passage: string): string {
  const words = fragmentWords(passage);
  const base = url.split("#")[0]!;
  if (words.length === 0) return url;
  const text = words.length <= EDGE * 2 ? term(words) : `${term(words.slice(0, EDGE))},${term(words.slice(-EDGE))}`;
  return `${base}#:~:text=${text}`;
}
