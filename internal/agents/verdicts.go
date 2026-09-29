// Verdicts per marker and uncited sentences (docs/systemone.md §3, the
// owner's decision in docs/v0.2.0.md §7.4). A citation check judges each
// claim (the sentence, list item or table row a marker sits in) against
// the source it cites; each [n] marker gets the verdict of its own claim,
// so a source can be verified in one sentence and unsupported in another.
// A factual sentence without any citation counts as unsupported: the chat
// marks it "Uncited", and evaluation scores count it against the answer.

package agents

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/systemone"
)

// MarkerVerdict is the citation check of one [n] marker: the verdict on
// the claim it sits in.
type MarkerVerdict struct {
	Verification string   `json:"verification"`
	Confidence   *float64 `json:"confidence,omitempty"`
}

// UncitedSentence is a factual sentence of an answer without a citation:
// offsets in the text in Unicode code points.
type UncitedSentence struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// markerVerdicts sets each citation's Markers: one verdict per [n] of that
// source in text, in order. A marker outside a checked claim (a citation
// list, a claim too short to check, a pair beyond the per-answer bound) is
// unchecked.
func markerVerdicts(cites []Citation, text string, claims []claim, v verdictLookup) []Citation {
	type at struct{ start, n int }
	claimOf := map[at]string{}
	for _, c := range claims {
		for _, m := range c.Markers {
			claimOf[at{m.Start, m.N}] = c.Text
		}
	}
	byN := map[int][]MarkerVerdict{}
	for _, m := range extractMarkers(text) {
		mv := MarkerVerdict{Verification: systemone.Unchecked}
		if claim, ok := claimOf[at{m.Start, m.N}]; ok {
			if vd, ok := v.of(claim, m.N); ok && vd.Verification != systemone.Unchecked {
				conf := vd.Confidence
				mv = MarkerVerdict{Verification: vd.Verification, Confidence: &conf}
			}
		}
		byN[m.N] = append(byN[m.N], mv)
	}
	out := make([]Citation, len(cites))
	for i, c := range cites {
		c.Markers = byN[c.N]
		out[i] = c
	}
	return out
}

// uncitedSpans are the byte spans of text's factual sentences without a
// citation.
func uncitedSpans(text string) []span { return readAnswer(text).uncited }

// UncitedSentences returns the factual sentences of an answer that cite no
// source, as code point offsets. A factual sentence is a sentence (or list
// item, or table data row) of the answer's body that:
//
//   - has at least three words and a letter;
//   - isn't a heading, a short bold line standing in for one, a list's
//     lead-in ending with ":", or code;
//   - isn't a question (to the user), a greeting or closing ("Hope this
//     helps", "Let me know if…"), a sentence saying what the sources
//     don't cover (a refusal), or a hedged suggestion to ask someone ("If
//     it's urgent, you may need to contact the office directly");
//   - isn't a term in a bulleted list (listFragment): uncited, a short item
//     such as "Recipient (yourself)" belongs to the sentence introducing
//     the list.
func UncitedSentences(text string) []UncitedSentence {
	spans := uncitedSpans(text)
	if len(spans) == 0 {
		return nil
	}
	out := make([]UncitedSentence, len(spans))
	for i, s := range spans {
		out[i] = UncitedSentence{Start: utf8.RuneCountInString(text[:s.start]), End: utf8.RuneCountInString(text[:s.end])}
	}
	return out
}

var (
	// greetingRE starts a greeting, a pleasantry or an offer to help.
	greetingRE = regexp.MustCompile(`(?i)^(?:hi|hello|hey|greetings|good (?:morning|afternoon|evening)|thanks|thank you|you're welcome|` +
		`you are welcome|glad to|happy to help|i hope|hope (?:this|that) helps|let me know|feel free|good luck|is there anything|` +
		`if you have (?:any )?(?:other |more |further )?questions|please (?:let me know|reach out)|i'm here|i am here|i can help)\b`)
	// notCoveredRE says the sources don't answer something (a refusal, or
	// the "what isn't covered" part of a partial answer).
	notCoveredRE = regexp.MustCompile(`(?i)(?:\b(?:sources?|documents?|documentation|knowledge base|materials?|pages?|information (?:i have|provided))\s+` +
		`(?:don't|do not|doesn't|does not|didn't|did not)\s+(?:say|mention|cover|include|specify|state|list|provide|contain|address|give)\b|` +
		`\b(?:isn't|is not|aren't|are not|wasn't|was not|not)\s+(?:covered|mentioned|specified|stated|addressed|included|listed)\s+` +
		`(?:in|by)\s+(?:the |my |these |those )?(?:sources?|documents?|documentation|knowledge base|materials?|pages?)\b|` +
		`\b(?:couldn't|could not|can't|cannot) find\b|\bi (?:don't|do not) (?:have|know)\b|\bno information (?:about|on|in|regarding)\b)`)
	// referralRE is a hedged suggestion to ask someone, usually after a
	// sentence saying what the sources don't cover: "If you need it urgently,
	// you may need to contact the office directly", "Consider calling the
	// help desk". It says what the reader could do, not what a source says;
	// one with a number or an address in it is still a claim (factual).
	referralRE = regexp.MustCompile(`(?i)^(?:[^,]{1,120},\s*)?(?:you\s+(?:may|might|could)\s+(?:also\s+)?(?:(?:need|want|wish|have)\s+to\s+)?|` +
		`(?:consider|try)\s+)(?:contact(?:ing)?|reach(?:ing)?\s+out|call(?:ing)?|e-?mail(?:ing)?|ask(?:ing)?|check(?:ing)?\s+with|` +
		`inquir(?:e|ing)|get(?:ting)?\s+in\s+touch)\b`)
)

// listFragment reports a bulleted list item that is a term rather than a
// sentence: at most four words, no digit, and no sentence punctuation at the
// end ("Recipient (yourself)", "“Process As Is” option", "Purpose (e.g.,
// certification/licensure)"). A number ("$10 per copy") makes it a claim.
func listFragment(sentence string) bool {
	s := strings.TrimSpace(sentence)
	if strings.HasSuffix(s, ".") || strings.HasSuffix(s, "!") || strings.IndexFunc(s, unicode.IsDigit) >= 0 {
		return false
	}
	words := 0
	for _, f := range strings.Fields(s) {
		if hasWord(f) {
			words++
		}
	}
	return words <= 4
}

// referral reports a hedged suggestion to ask someone (referralRE) that
// names no number or address.
func referral(s string) bool {
	return referralRE.MatchString(s) && strings.IndexFunc(s, unicode.IsDigit) < 0 && !strings.Contains(s, "@")
}

// factual reports whether a sentence (Markdown stripped, without its list
// lead-in) states something a source should back. unit is the paragraph or
// list item it is in ("" for a table row).
func factual(sentence, unit string) bool {
	s := strings.TrimSpace(sentence)
	switch {
	case !checkable(s), strings.HasSuffix(s, "?"), strings.HasSuffix(s, ":"):
		return false
	case greetingRE.MatchString(s), notCoveredRE.MatchString(s), referral(s):
		return false
	}
	u := strings.TrimSpace(unit)
	// A short bold line stands in for a heading ("**How to order**").
	return len(u) > 100 || !strings.HasPrefix(u, "**") || !strings.HasSuffix(u, "**") || strings.Contains(u, "\n")
}

// dataCells are a table row's cells as plain text, empty ones left out.
func dataCells(cells []string) []string {
	var out []string
	for _, c := range cells {
		if c = cleanClaim(c); c != "" {
			out = append(out, c)
		}
	}
	return out
}

// rowEnd is where a table row's text ends: before its closing pipe and the
// spaces around it, so a mark placed there stays in the last cell.
func rowEnd(text string, ln line) int {
	row := strings.TrimRight(text[ln.start:ln.end], " \t")
	row = strings.TrimRight(strings.TrimSuffix(row, "|"), " \t")
	return ln.start + len(row)
}
