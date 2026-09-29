// Model punctuation: some models (gpt-oss among
// them) write typographic look-alikes of plain characters: U+2011
// non-breaking hyphens in e-mail addresses and phone numbers, U+202F narrow
// no-break spaces between words and numbers. They break link detection
// ("military‑benefits@example.edu" linked as "benefits@example.edu"), copy
// and paste of numbers, and read as missing spaces in some fonts. The final
// answer text is normalised before it is stored or returned; the web client
// does the same while an answer streams (web/src/pages/chat/answer-text.ts).

package agents

import "strings"

// punctuation maps the look-alikes to plain characters. En and em dashes
// (U+2013, U+2014) are real punctuation and stay; so does the ideographic
// space (U+3000) of CJK text.
var punctuation = strings.NewReplacer(
	// Hyphens: hyphen, non-breaking hyphen, figure dash.
	"\u2010", "-", "\u2011", "-", "\u2012", "-",
	// Spaces: no-break, en/em quad and spaces, figure, punctuation, thin,
	// hair, narrow no-break and medium mathematical space.
	"\u00a0", " ", "\u2000", " ", "\u2001", " ", "\u2002", " ", "\u2003", " ", "\u2004", " ", "\u2005", " ",
	"\u2006", " ", "\u2007", " ", "\u2008", " ", "\u2009", " ", "\u200a", " ", "\u202f", " ", "\u205f", " ",
	// Invisible: soft hyphen, zero-width space, word joiner, byte order mark.
	"\u00ad", "", "\u200b", "", "\u2060", "", "\ufeff", "",
)

// NormalizePunctuation replaces the typographic look-alikes models write
// (non-breaking hyphens, narrow and other no-break spaces, zero-width
// characters) with plain hyphens and spaces, or removes them.
func NormalizePunctuation(s string) string { return punctuation.Replace(s) }
