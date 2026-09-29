// Per-claim verification (docs/systemone.md §3, docs/v0.2.1.md I9). A claim
// is one factual sentence of the answer (a list item or a table data row
// counts as one; verdicts.go has the rule). It has one verdict: supported
// when any source it cites supports it, not supported when it cites sources
// and none supports it, or uncited. The chat's summary ("9 of 10 claims
// supported") and an evaluation's share of supported claims count the same
// claims, so a result page and the same answer in chat agree.

package agents

import (
	"sort"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/systemone"
)

// Claim verdicts.
const (
	ClaimSupported    = "supported"     // a cited source supports it
	ClaimNotSupported = "not_supported" // cited, but no cited source supports it
	ClaimUncited      = "uncited"       // no source is cited for it
	// ClaimUnchecked: cited, none of its checked sources supports it, and
	// at least one check failed or timed out (fail-open). Left out of the
	// summary's and the evaluation's counts.
	ClaimUnchecked = "unchecked"
)

// Claim is one factual sentence of an answer and its verdict. Start and End
// are offsets in the answer text in Unicode code points. Text is the
// sentence as plain text (markers and Markdown removed); it is not stored
// (ADR-0010: the check record holds no text) and is read from the answer
// when a claim is loaded (FillClaimText).
type Claim struct {
	Index   int    `json:"index"`
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Text    string `json:"text,omitempty"`
	Verdict string `json:"verdict"`
	// Sources are the numbers of the cited sources that support the claim
	// (supported claims only).
	Sources []int `json:"sources"`
	// Confidence is the most confident supporting verdict of a supported
	// claim, or the least confident negative verdict of a claim not supported.
	Confidence *float64 `json:"confidence,omitempty"`
	// Checks are the per-source outcomes, one per cited source.
	Checks []ClaimCheck `json:"checks,omitempty"`
}

// ClaimCheck is the outcome of one source cited by a claim. Occurrence is
// which [n] marker of that source in the answer text it is (0 for the
// first [n]), so a marker chip can find its claim; nil when enforce removed
// the marker.
type ClaimCheck struct {
	N            int      `json:"n"`
	Occurrence   *int     `json:"occurrence,omitempty"`
	Verification string   `json:"verification"`
	Confidence   *float64 `json:"confidence,omitempty"`
}

// ClaimCounts are the claims of an answer by verdict.
type ClaimCounts struct {
	Supported, NotSupported, Uncited, Unchecked int
}

// Scored is the number of claims the summary and the evaluation score count:
// every claim but the unchecked ones.
func (c ClaimCounts) Scored() int { return c.Supported + c.NotSupported + c.Uncited }

// CountClaims counts claims by verdict.
func CountClaims(claims []Claim) ClaimCounts {
	var c ClaimCounts
	for _, cl := range claims {
		switch cl.Verdict {
		case ClaimSupported:
			c.Supported++
		case ClaimNotSupported:
			c.NotSupported++
		case ClaimUncited:
			c.Uncited++
		default:
			c.Unchecked++
		}
	}
	return c
}

// buildClaims lists the claims of the (final) answer text with their
// verdicts. checked are the claims as the model wrote the answer: a claim
// whose markers enforce removed keeps their outcomes (not supported) rather
// than reading as uncited.
func buildClaims(text string, checked []claim, v verdictLookup) []Claim {
	r := readAnswer(text)
	before := map[string]claim{}
	for _, c := range checked {
		if _, ok := before[c.Text]; !ok && len(c.Markers) > 0 {
			before[c.Text] = c
		}
	}
	occ := markerOccurrences(text)
	type unit struct {
		start, end int
		text       string
		markers    []claimMarker
	}
	units := make([]unit, 0, len(r.claims)+len(r.uncited))
	for _, c := range r.claims {
		units = append(units, unit{c.Start, c.End, c.Text, c.Markers})
	}
	for i, s := range r.uncited {
		units = append(units, unit{s.start, s.end, r.uncitedText[i], nil})
	}
	sort.SliceStable(units, func(i, j int) bool { return units[i].start < units[j].start })
	out := make([]Claim, 0, len(units))
	pos := runeOffsets(text)
	for i, u := range units {
		ms := u.markers
		if c, ok := before[u.text]; ok {
			ms = c.Markers // with the markers enforce removed
		}
		cl := Claim{Index: i, Start: pos(u.start), End: pos(u.end)}
		cl.Checks = claimChecks(u.text, ms, u.markers, occ, v)
		cl.Verdict, cl.Sources, cl.Confidence = claimVerdict(cl.Checks)
		out = append(out, cl)
	}
	// The text is read from the answer, as for a stored claim.
	return FillClaimText(text, out)
}

// markerAt identifies a marker of the text: where it starts and its number.
type markerAt struct{ start, n int }

// markerOccurrences numbers each [n] of the text by occurrence (0 for the
// first [1], 1 for the second…), as the chat numbers its chips.
func markerOccurrences(text string) map[markerAt]int {
	seen := map[int]int{}
	out := map[markerAt]int{}
	for _, m := range extractMarkers(text) {
		out[markerAt{m.Start, m.N}] = seen[m.N]
		seen[m.N]++
	}
	return out
}

// claimChecks are the outcomes of the sources a claim cites (ms, as
// written), one per source number; a source's occurrence is that of its
// first marker still in the text (final).
func claimChecks(text string, ms, final []claimMarker, occ map[markerAt]int, v verdictLookup) []ClaimCheck {
	var out []ClaimCheck
	seen := map[int]bool{}
	for _, m := range ms {
		if seen[m.N] {
			continue
		}
		seen[m.N] = true
		ch := ClaimCheck{N: m.N, Verification: systemone.Unchecked}
		if vd, ok := v.of(text, m.N); ok && vd.Verification != systemone.Unchecked {
			conf := vd.Confidence
			ch.Verification, ch.Confidence = vd.Verification, &conf
		}
		for _, f := range final {
			if k, ok := occ[markerAt{f.Start, f.N}]; ok && f.N == m.N {
				ch.Occurrence = &k
				break
			}
		}
		out = append(out, ch)
	}
	return out
}

// claimVerdict folds a claim's per-source outcomes into its verdict: any
// supporting source makes it supported; otherwise a failed check leaves it
// unchecked; otherwise it is not supported.
func claimVerdict(checks []ClaimCheck) (string, []int, *float64) {
	if len(checks) == 0 {
		return ClaimUncited, []int{}, nil
	}
	sources, unchecked := []int{}, false
	var best, worst *float64
	for _, c := range checks {
		switch {
		case c.Verification == systemone.Verified:
			sources = append(sources, c.N)
			if best == nil || *c.Confidence > *best {
				best = c.Confidence
			}
		case c.Verification == systemone.Unchecked:
			unchecked = true
		case worst == nil || *c.Confidence < *worst:
			worst = c.Confidence
		}
	}
	switch {
	case len(sources) > 0:
		sort.Ints(sources)
		return ClaimSupported, sources, best
	case unchecked:
		return ClaimUnchecked, sources, nil
	}
	return ClaimNotSupported, sources, worst
}

// runeOffsets converts byte offsets of text to code point offsets.
func runeOffsets(text string) func(b int) int {
	return func(b int) int { return utf8.RuneCountInString(text[:b]) }
}

// FillClaimText sets each claim's text from the answer it belongs to (stored
// claims have offsets only): the sentence as the answer reads it, markers
// and Markdown removed.
func FillClaimText(text string, claims []Claim) []Claim {
	if len(claims) == 0 {
		return claims
	}
	runes := []rune(text)
	out := make([]Claim, len(claims))
	for i, c := range claims {
		if c.Start >= 0 && c.End <= len(runes) && c.Start <= c.End {
			c.Text = cleanClaim(removeAllMarkers(string(runes[c.Start:c.End])))
		}
		out[i] = c
	}
	return out
}

// storedClaims are claims as the check record keeps them: without text.
func storedClaims(claims []Claim) []Claim {
	out := make([]Claim, len(claims))
	for i, c := range claims {
		c.Text = ""
		out[i] = c
	}
	return out
}
