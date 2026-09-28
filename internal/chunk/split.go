package chunk

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// span is a byte range [start, end) of a block's text.
type span struct{ start, end int }

// piece is a span with its token count.
type piece struct {
	span
	tokens int
}

func isSpaceByte(c byte) bool { return c == ' ' || c == '\t' || c == '\n' }

func trimRightEnd(text string, start, end int) int {
	for end > start && isSpaceByte(text[end-1]) {
		end--
	}
	return end
}

// appendSpan appends [start, end) with trailing whitespace removed, skipping
// empty results.
func appendSpan(out []span, text string, start, end int) []span {
	end = trimRightEnd(text, start, end)
	for start < end && text[start] == '\n' {
		start++
	}
	if start < end && strings.TrimSpace(text[start:end]) != "" {
		out = append(out, span{start, end})
	}
	return out
}

// lineSpans returns the non-blank lines of text[s], keeping indentation.
func lineSpans(text string, s span) []span {
	var out []span
	for i := s.start; i < s.end; {
		j := strings.IndexByte(text[i:s.end], '\n')
		if j < 0 {
			return appendSpan(out, text, i, s.end)
		}
		out = appendSpan(out, text, i, i+j)
		i += j + 1
	}
	return out
}

// sentenceSpans splits text[s] at sentence ends (., !, ? followed by optional
// closing punctuation, whitespace, and a character that is not a lowercase
// letter) and at line breaks.
func sentenceSpans(text string, s span) []span {
	var out []span
	seg := s.start
	for i := s.start; i < s.end; {
		c := text[i]
		if c == '\n' {
			out = appendSpan(out, text, seg, i)
			i++
			seg = i
			continue
		}
		if c != '.' && c != '!' && c != '?' {
			i++
			continue
		}
		j := i + 1
		for j < s.end {
			if k := closerLen(text[j:s.end]); k > 0 {
				j += k
				continue
			}
			break
		}
		if j < s.end && (text[j] == ' ' || text[j] == '\t') {
			k := j
			for k < s.end && (text[k] == ' ' || text[k] == '\t') {
				k++
			}
			if k < s.end {
				r, _ := utf8.DecodeRuneInString(text[k:s.end])
				if !unicode.IsLower(r) {
					out = appendSpan(out, text, seg, j)
					seg, i = k, k
					continue
				}
			}
		}
		i = j
	}
	return appendSpan(out, text, seg, s.end)
}

func closerLen(s string) int {
	switch s[0] {
	case ')', ']', '"', '\'', '*', '_':
		return 1
	}
	for _, q := range [...]string{"”", "’", "»"} {
		if strings.HasPrefix(s, q) {
			return len(q)
		}
	}
	return 0
}

// itemSpans groups the lines of a list into items at the list's base
// indentation; nested items stay with their parent.
func itemSpans(text string, s span, base int) []span {
	lines := lineSpans(text, s)
	var out []span
	for i, l := range lines {
		line := text[l.start:l.end]
		if item, _ := listItem(line); i > 0 && !(item && indentOf(line) <= base) {
			out[len(out)-1].end = l.end // continuation or nested item
			continue
		}
		out = append(out, l)
	}
	return out
}

// rowSpans returns table rows; the header and separator rows stay attached
// to the first data row.
func rowSpans(b *block, s span) []span {
	lines := lineSpans(b.text, s)
	k := 0
	for k < len(lines)-1 && lines[k].end <= b.headerEnd {
		k++
	}
	if k > 0 {
		lines[k].start = lines[0].start
		lines = lines[k:]
	}
	return lines
}

// codeSpans returns code lines; the fence lines stay attached to the first
// and last lines of code.
func codeSpans(b *block, s span) []span {
	lines := lineSpans(b.text, s)
	if len(lines) > 1 && lines[0].end <= b.openEnd {
		lines[1].start = lines[0].start
		lines = lines[1:]
	}
	if n := len(lines); n > 1 && b.closeStart < len(b.text) && lines[n-1].start >= b.closeStart {
		lines[n-2].end = lines[n-1].end
		lines = lines[:n-1]
	}
	return lines
}

// levels returns the structural splitters for a block, coarsest first.
func (b *block) levels() []func(span) []span {
	sentences := func(s span) []span { return sentenceSpans(b.text, s) }
	switch b.kind {
	case kindPara:
		return []func(span) []span{sentences}
	case kindList:
		return []func(span) []span{
			func(s span) []span { return itemSpans(b.text, s, b.indent) },
			func(s span) []span { return lineSpans(b.text, s) },
			sentences,
		}
	case kindTable:
		return []func(span) []span{func(s span) []span { return rowSpans(b, s) }}
	case kindCode:
		return []func(span) []span{func(s span) []span { return codeSpans(b, s) }}
	}
	return nil
}

// overlapSegments returns the spans overlap may start at: sentences for prose
// and lists, rows or code lines for tables and code, nothing for headings.
func overlapSegments(b *block, s span) []span {
	switch b.kind {
	case kindPara, kindList:
		return sentenceSpans(b.text, s)
	case kindTable:
		var out []span
		for _, l := range lineSpans(b.text, s) {
			if l.start >= b.headerEnd {
				out = append(out, l)
			}
		}
		return out
	case kindCode:
		var out []span
		for _, l := range lineSpans(b.text, s) {
			if l.start > b.openEnd && l.start < b.closeStart {
				out = append(out, l)
			}
		}
		return out
	}
	return nil
}

// refine splits text[s] into pieces of at most limit tokens, descending
// through the block's structural levels and finally splitting by tokens.
func (sp *splitter) refine(b *block, s span, level, limit int, out []piece) []piece {
	levels := b.levels()
	if level >= len(levels) {
		return sp.hardSplit(b.text, s, limit, out)
	}
	subs := levels[level](s)
	if len(subs) == 1 && subs[0] == s {
		return sp.refine(b, s, level+1, limit, out)
	}
	for _, sub := range subs {
		if n := sp.count(b.text[sub.start:sub.end]); n <= limit {
			out = append(out, piece{sub, n})
			continue
		}
		out = sp.refine(b, sub, level+1, limit, out)
	}
	return out
}

// runeFloor moves i back to the start of the rune containing it. Invalid
// bytes count as one-byte runes, as in utf8.DecodeRuneInString.
func runeFloor(s string, i int) int {
	if i <= 0 || i >= len(s) || utf8.RuneStart(s[i]) {
		return i
	}
	for j := i - 1; j >= 0 && j >= i-(utf8.UTFMax-1); j-- {
		if utf8.RuneStart(s[j]) {
			if _, size := utf8.DecodeRuneInString(s[j:]); j+size > i {
				return j
			}
			return i
		}
	}
	return i
}

// hardSplit cuts text[s] into pieces of at most limit tokens, preferring
// whitespace. It finds each cut with an exponential then binary search over
// prefix lengths, so the cost is O(n log n) counting work rather than
// O(n²). A single rune that exceeds limit on its own is emitted as-is.
func (sp *splitter) hardSplit(text string, s span, limit int, out []piece) []piece {
	guess := limit * 4
	if guess < 16 {
		guess = 16
	}
	for i := s.start; ; {
		for i < s.end && isSpaceByte(text[i]) {
			i++
		}
		if i >= s.end {
			return out
		}
		rest := text[i:s.end]
		cut, end, n := sp.cutPiece(rest, sp.fitPrefix(rest, guess, limit), limit)
		out = append(out, piece{span{i, i + end}, n})
		i += cut
	}
}

// fitPrefix returns the length of the longest rune-aligned prefix of rest
// within limit tokens (at least one rune): it gallops from guess, then
// bisects.
func (sp *splitter) fitPrefix(rest string, guess, limit int) int {
	lo, hi := 0, -1
	for l := guess; ; l *= 2 {
		if l > len(rest) {
			l = len(rest)
		}
		if l = runeFloor(rest, l); l <= lo {
			break
		}
		if sp.count(rest[:l]) > limit {
			hi = l
			break
		}
		lo = l
		if l == len(rest) {
			break
		}
	}
	for hi >= 0 {
		mid := runeFloor(rest, lo+(hi-lo)/2)
		if mid <= lo {
			_, size := utf8.DecodeRuneInString(rest[lo:])
			if mid = lo + size; mid >= hi {
				break
			}
		}
		if sp.count(rest[:mid]) <= limit {
			lo = mid
		} else {
			hi = mid
		}
	}
	if lo == 0 {
		_, lo = utf8.DecodeRuneInString(rest)
	}
	return lo
}

// cutPiece chooses where to cut a prefix of lo bytes: at the last whitespace
// in its second half when that fits, else at lo. end is the piece's end
// without trailing space, n its tokens.
func (sp *splitter) cutPiece(rest string, lo, limit int) (cut, end, n int) {
	cut = lo
	if lo < len(rest) && !isSpaceByte(rest[lo]) {
		// Back off to the last whitespace in the second half, if any.
		if w := strings.LastIndexAny(rest[lo/2:lo], " \t\n"); w >= 0 {
			cut = lo/2 + w
		}
	}
	end = trimRightEnd(rest, 0, cut)
	if end == 0 {
		cut, end = lo, trimRightEnd(rest, 0, lo)
	}
	n = sp.count(rest[:end])
	if n > limit && cut != lo {
		cut, end = lo, trimRightEnd(rest, 0, lo)
		n = sp.count(rest[:end])
	}
	return cut, end, n
}
