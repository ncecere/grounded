// Export numbers (v0.4.2 US-03): the chat shows an answer's sources numbered
// 1..n in the order the answer first cites them ("[2] … [1] … [4]" reads
// 1, 2, 3; web/src/pages/chat/answer-text.ts displayNumbers), while the
// stored text keeps the numbers the model wrote (the source viewer, the
// claims and the saved answer use them). The exports use the screen's
// numbers, so a reader's copy matches what they saw.

package agents

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

// exportMarkerRE is a stored [n] or [n, m] marker.
var exportMarkerRE = regexp.MustCompile(`\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]`)

// markerNumbers are a marker's numbers.
func markerNumbers(inner string) []int {
	var out []int
	for _, p := range strings.Split(inner, ",") {
		if n, err := strconv.Atoi(strings.TrimSpace(p)); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// isMarkerAt reports a marker at byte i that isn't part of a word or an
// index ("a[3]").
func isMarkerAt(text string, i int) bool {
	if i == 0 {
		return true
	}
	r, _ := utf8.DecodeLastRuneInString(text[:i])
	return !(r == '_' || ('0' <= r && r <= '9') || ('a' <= r && r <= 'z') || ('A' <= r && r <= 'Z'))
}

// DisplayNumbers maps each cited source's number to the one the chat shows:
// first citation first, then sources the text doesn't cite in number order.
func DisplayNumbers(text string, cites []Citation) map[int]int {
	known := map[int]bool{}
	for _, c := range cites {
		known[c.N] = true
	}
	out := map[int]int{}
	add := func(n int) {
		if _, done := out[n]; known[n] && !done {
			out[n] = len(out) + 1
		}
	}
	for _, loc := range exportMarkerRE.FindAllStringSubmatchIndex(text, -1) {
		if isMarkerAt(text, loc[0]) {
			for _, n := range markerNumbers(text[loc[2]:loc[3]]) {
				add(n)
			}
		}
	}
	rest := make([]int, 0, len(known))
	for n := range known {
		rest = append(rest, n)
	}
	slices.Sort(rest)
	for _, n := range rest {
		add(n)
	}
	return out
}

// renumberText rewrites the markers with num and returns where an old
// offset (in code points) is in the new text.
func renumberText(text string, num map[int]int) (string, func(int) int) {
	type shift struct{ at, delta int }
	var shifts []shift
	var b strings.Builder
	last := 0
	for _, loc := range exportMarkerRE.FindAllStringSubmatchIndex(text, -1) {
		if !isMarkerAt(text, loc[0]) {
			continue
		}
		nums := markerNumbers(text[loc[2]:loc[3]])
		parts := make([]string, len(nums))
		for i, n := range nums {
			if m, ok := num[n]; ok {
				n = m
			}
			parts[i] = strconv.Itoa(n)
		}
		repl := "[" + strings.Join(parts, ", ") + "]"
		b.WriteString(text[last:loc[0]])
		b.WriteString(repl)
		shifts = append(shifts, shift{utf8.RuneCountInString(text[:loc[0]]), len(repl) - (loc[1] - loc[0])})
		last = loc[1]
	}
	b.WriteString(text[last:])
	return b.String(), func(p int) int {
		out := p
		for _, s := range shifts {
			if s.at < p {
				out += s.delta
			}
		}
		return out
	}
}

// ExportNumbers returns the conversation with each answer numbered as the
// chat shows it: its markers, its sources (in that order) and its claims.
func ExportNumbers(v ConversationView) ConversationView {
	out := v
	out.Messages = make([]MessageView, len(v.Messages))
	for i, m := range v.Messages {
		out.Messages[i] = exportMessage(m)
	}
	return out
}

func exportMessage(m MessageView) MessageView {
	if len(m.Citations) == 0 {
		return m
	}
	num := DisplayNumbers(m.Text, m.Citations)
	text, at := renumberText(m.Text, num)
	m.Text = text
	cites := make([]Citation, len(m.Citations))
	for i, c := range m.Citations {
		c.N = num[c.N]
		cites[i] = c
	}
	slices.SortFunc(cites, func(a, b Citation) int { return a.N - b.N })
	m.Citations = cites
	if m.Uncited != nil {
		spans := make([]UncitedSentence, len(m.Uncited))
		for i, u := range m.Uncited {
			spans[i] = UncitedSentence{Start: at(u.Start), End: at(u.End)}
		}
		m.Uncited = spans
	}
	if m.Claims != nil {
		claims := make([]Claim, len(m.Claims))
		for i, c := range m.Claims {
			c.Start, c.End = at(c.Start), at(c.End)
			c.Sources = renumbered(c.Sources, num)
			checks := make([]ClaimCheck, len(c.Checks))
			for j, k := range c.Checks {
				if n, ok := num[k.N]; ok {
					k.N = n
				}
				checks[j] = k
			}
			c.Checks = checks
			claims[i] = c
		}
		m.Claims = claims
	}
	return m
}

func renumbered(list []int, num map[int]int) []int {
	if list == nil {
		return nil
	}
	out := make([]int, len(list))
	for i, n := range list {
		if m, ok := num[n]; ok {
			n = m
		}
		out[i] = n
	}
	return out
}
