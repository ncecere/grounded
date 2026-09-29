/*
 * The answer's text as the chat shows it. While an answer streams, the text
 * is the model's raw output; the server's finished text (message_end) is
 * normalised the same way (internal/agents/punctuation.go, citations.go).
 */

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
