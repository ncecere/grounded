// Finding citation markers in an answer. Every reader of markers (the
// answer's citations, claim extraction, enforce removals, the refusal
// test) goes through findMarkers, so they agree on what a marker is:
//
//   - [n], [n, m] (and [n][m], two markers), plus the fullwidth ［n］ and
//     lenticular 【n】/【n†…】 styles some models are trained on;
//   - never inside code: inline code spans (any number of backticks),
//     fenced blocks (``` or ~~~) and indented code blocks;
//   - an ASCII [n] is not a marker when it is attached to an identifier:
//     directly after an ASCII letter, digit or underscore (a[3], arr[0]),
//     directly before one ([3]int), directly after a "]" that doesn't end
//     a marker (m[i][2]), or before "(" (a Markdown link [1](url)).
//     Whitespace, punctuation, emphasis or the start of a line before it
//     are fine ("fee [1]", "fee.[1]", "**fee**[1]"). Fullwidth and
//     lenticular markers are never array indices and have no such rule.
//
// The web renderer (web/src/components/ui/response/response.tsx) applies
// the same rules to the Markdown text nodes it renders.

package agents

import (
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// citeMarker is one citation marker of a text.
type citeMarker struct {
	Start, End int    // byte span, with the whitespace before the marker
	At         int    // where the bracket starts
	Inner      string // the numbers ("1", "1, 2")
}

// lead is the whitespace before the marker.
func (m citeMarker) lead(text string) string { return text[m.Start:m.At] }

// ascii reports an ASCII [n] marker (not fullwidth or lenticular).
func (m citeMarker) ascii(text string) bool { return text[m.At] == '[' }

// findMarkers returns the citation markers of text in order.
func findMarkers(text string) []citeMarker {
	locs := markerRE.FindAllStringSubmatchIndex(text, -1)
	if len(locs) == 0 {
		return nil
	}
	blocks, inline := markdownCode(text)
	code := slices.Concat(blocks, inline)
	var out []citeMarker
	lastEnd := -1 // end of the last accepted marker
	for _, loc := range locs {
		m := citeMarker{Start: loc[0], End: loc[1], At: loc[3], Inner: text[loc[4]:loc[5]]}
		if inRanges(code, m.At) {
			continue
		}
		if m.ascii(text) && attached(text, m, lastEnd) {
			continue
		}
		// The whitespace before a marker never reaches into a code block.
		for _, r := range code {
			if r.start < m.At && r.end > m.Start {
				m.Start = max(m.Start, r.end)
			}
		}
		out = append(out, m)
		lastEnd = m.End
	}
	return out
}

// attached reports an ASCII marker that belongs to an identifier or a link
// rather than being a citation (see the rules above).
func attached(text string, m citeMarker, lastEnd int) bool {
	if m.Start == m.At && m.At > 0 { // nothing between it and what comes before
		switch b := text[m.At-1]; {
		case isIdentByte(b):
			return true
		case b == ']' && lastEnd != m.At:
			return true
		}
	}
	if m.End < len(text) {
		if b := text[m.End]; isIdentByte(b) || b == '(' {
			return true
		}
	}
	return false
}

func isIdentByte(b byte) bool { return isWordByte(b) || b == '_' }

// removeAllMarkers drops every marker (and the whitespace before it).
func removeAllMarkers(text string) string {
	var b strings.Builder
	last := 0
	for _, m := range findMarkers(text) {
		b.WriteString(text[last:m.Start])
		last = m.End
	}
	b.WriteString(text[last:])
	return b.String()
}

func inRanges(rs []span, i int) bool {
	for _, r := range rs {
		if i >= r.start && i < r.end {
			return true
		}
	}
	return false
}

var (
	codeFenceRE = regexp.MustCompile("^[ \t]*(`{3,}|~{3,})(.*)$")
	listStartRE = regexp.MustCompile(`^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)`)
)

// markdownCode returns the byte ranges of text that are code: fenced and
// indented code blocks (whole lines) and inline code spans. Like the claim
// reader it reads the Markdown models write, leniently: a fence may be
// indented (fences inside list items), and indented lines in a list are
// list content, not code.
func markdownCode(text string) (blocks, inline []span) {
	lines := splitLines(text)
	var fence string // the opening fence while inside a fenced block
	fenceStart := 0
	inList, prevBlank, prevCode := false, true, false
	para := -1 // start of the current run of prose lines, for inline code
	endPara := func(end int) {
		if para >= 0 {
			inline = append(inline, inlineCode(text, para, end)...)
			para = -1
		}
	}
	for _, ln := range lines {
		s := text[ln.start:ln.end]
		blank := strings.TrimSpace(s) == ""
		if fence != "" {
			if closesFence(s, fence) {
				blocks = append(blocks, span{fenceStart, ln.end})
				fence = ""
			}
			continue
		}
		if f := opensFence(s); f != "" {
			endPara(ln.start)
			fence, fenceStart, prevBlank, prevCode = f, ln.start, false, false
			continue
		}
		if blank {
			endPara(ln.start)
			prevBlank = true
			continue
		}
		indent := indentWidth(s)
		if indent >= 4 && !inList && (prevBlank || prevCode) {
			endPara(ln.start)
			blocks = append(blocks, span(ln))
			prevBlank, prevCode = false, true
			continue
		}
		switch {
		case listStartRE.MatchString(s):
			inList = true
		case indent == 0 && prevBlank:
			inList = false // a paragraph at the margin ends the list
		}
		if para < 0 {
			para = ln.start
		}
		prevBlank, prevCode = false, false
	}
	if fence != "" {
		blocks = append(blocks, span{fenceStart, len(text)}) // an unclosed fence runs to the end
	}
	endPara(len(text))
	return blocks, inline
}

// opensFence returns the fence (``` or ~~~, or longer) a line opens, or "".
// A backtick fence's info string has no backticks (```x``` is inline code).
func opensFence(line string) string {
	g := codeFenceRE.FindStringSubmatch(line)
	if g == nil || (g[1][0] == '`' && strings.Contains(g[2], "`")) {
		return ""
	}
	return g[1]
}

// closesFence reports a line closing the fence: the same character, at
// least as long, nothing after it.
func closesFence(line, fence string) bool {
	g := codeFenceRE.FindStringSubmatch(line)
	return g != nil && g[1][0] == fence[0] && len(g[1]) >= len(fence) && strings.TrimSpace(g[2]) == ""
}

// indentWidth is a line's leading whitespace in columns (a tab is 4).
func indentWidth(s string) int {
	w := 0
	for _, c := range s {
		switch c {
		case ' ':
			w++
		case '\t':
			w += 4 - w%4
		default:
			return w
		}
	}
	return w
}

// inlineCode returns the code spans of text[start:end]: a run of n
// backticks up to the next run of exactly n. A run without a closer is
// literal backticks; a backslash escapes the character after it.
func inlineCode(text string, start, end int) []span {
	var out []span
	for i := start; i < end; {
		switch text[i] {
		case '\\':
			i += 2
			continue
		case '`':
		default:
			_, size := utf8.DecodeRuneInString(text[i:end])
			i += size
			continue
		}
		n := backticks(text, i, end)
		closeAt := -1
		for j := i + n; j < end; {
			if text[j] != '`' {
				j++
				continue
			}
			k := backticks(text, j, end)
			if k == n {
				closeAt = j
				break
			}
			j += k
		}
		if closeAt < 0 {
			i += n
			continue
		}
		out = append(out, span{i, closeAt + n})
		i = closeAt + n
	}
	return out
}

func backticks(text string, i, end int) int {
	n := 0
	for i+n < end && text[i+n] == '`' {
		n++
	}
	return n
}
