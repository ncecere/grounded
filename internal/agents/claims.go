// Claim extraction for citation checks (docs/systemone.md §3): the claim
// of a [n] marker is the sentence that carries it, or the list item or
// table row it sits in. It is a heuristic reader of the Markdown models
// write, not a parser: it only has to find, for each marker, the words the
// marker vouches for.

package agents

import (
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// claimMarker is one [n] marker in the answer text.
type claimMarker struct {
	N          int
	Start, End int // byte span of the marker, with its leading whitespace
	At         int // where its bracket starts
}

// claim is one sentence (list item, table row) and the markers citing it.
type claim struct {
	Text    string
	Markers []claimMarker
}

var (
	listItemRE = regexp.MustCompile(`^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+`)
	headingRE  = regexp.MustCompile(`^[ \t]*#{1,6}[ \t]`)
	tableSepRE = regexp.MustCompile(`^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$`)
)

// unit kinds.
const (
	unitParagraph = iota
	unitList
	unitHeading
)

// unit is a paragraph, list item or heading: a byte span of the text.
type unit struct {
	kind       int
	start, end int
	leadIn     string // list items: the sentence introducing the list
}

// claimReader extracts claims from one answer.
type claimReader struct {
	text    string
	markers []claimMarker
	claims  []claim
	// last is the most recent sentence and its claim (-1 when it has
	// none), for markers standing on their own after it; lastOK: it can
	// be checked.
	last      string
	lastClaim int
	lastOK    bool
	// uncited are the factual sentences without a marker (verdicts.go);
	// lastUncited is the last sentence's entry (-1: none), dropped when
	// markers standing on their own follow it.
	uncited     []span
	lastUncited int
}

// extractClaims returns the claims of the markers in text, in order.
// Brackets in code are not markers (markers.go). Markers with nothing
// before them, and those of citation lists ("Citations: [1], [2]", a list
// under "Sources:") or of claims too short to check ("Deadlines [1]"),
// have no claim: they are not checked, and their citations stay.
func extractClaims(text string) []claim {
	if len(extractMarkers(text)) == 0 {
		return nil
	}
	return readAnswer(text).claims
}

// readAnswer reads the claims and the uncited factual sentences of text.
func readAnswer(text string) *claimReader {
	r := &claimReader{text: text, lastClaim: -1, lastUncited: -1, markers: extractMarkers(text)}
	r.read()
	return r
}

// line is one line of the text: its span without the newline.
type line struct{ start, end int }

func splitLines(text string) []line {
	var out []line
	start := 0
	for i := 0; i < len(text); i++ {
		if text[i] == '\n' {
			out = append(out, line{start, i})
			start = i + 1
		}
	}
	return append(out, line{start, len(text)})
}

// read walks the lines, grouping them into units and table rows.
func (r *claimReader) read() {
	var cur *unit
	var header []string // the current table's header cells
	leadIn := ""
	blocks, _ := markdownCode(r.text)
	flush := func() {
		if cur != nil {
			r.readUnit(*cur)
			switch cur.kind {
			case unitParagraph:
				leadIn = listLeadIn(r.last, r.text[cur.start:cur.end])
			case unitHeading:
				// A "## Sources" heading introduces a citation list.
				if h := strings.TrimRight(cleanClaim(r.stripMarkers(cur.start, cur.end)), ":") + ":"; citationLabelOnly(h) {
					leadIn = h
				}
			}
			cur = nil
		}
	}
	for _, ln := range splitLines(r.text) {
		s := r.text[ln.start:ln.end]
		trimmed := strings.TrimSpace(s)
		switch {
		case inRanges(blocks, ln.start):
			flush() // code blocks have no claims
		case trimmed == "":
			flush()
			header = nil
		case strings.HasPrefix(trimmed, "|"):
			flush()
			header = r.readRow(ln, header)
		case headingRE.MatchString(s):
			flush()
			cur, leadIn = &unit{kind: unitHeading, start: ln.start + len(headingRE.FindString(s)), end: ln.end}, ""
			flush()
		case listItemRE.MatchString(s):
			flush()
			// The item's text starts after its bullet or number ("1." is not a sentence).
			cur = &unit{kind: unitList, start: ln.start + len(listItemRE.FindString(s)), end: ln.end, leadIn: leadIn}
		case cur != nil:
			cur.end = ln.end // continuation (lazy continuation for list items)
		default:
			cur, leadIn = &unit{kind: unitParagraph, start: ln.start, end: ln.end}, ""
		}
	}
	flush()
}

// listLeadIn is the sentence introducing a list ("You can order it:"), or
// a short bold line standing in for a heading ("**Visiting students**"),
// or "".
func listLeadIn(sentence, paragraph string) string {
	p := strings.TrimSpace(paragraph)
	switch {
	case strings.HasSuffix(sentence, ":"):
		return sentence
	case len(p) <= 100 && strings.HasPrefix(p, "**") && strings.HasSuffix(p, "**") && !strings.Contains(p, "\n"):
		return strings.TrimRight(sentence, ".:") + ":"
	}
	return ""
}

// readUnit splits a unit into sentences and records their claims.
func (r *claimReader) readUnit(u unit) {
	// Markers standing on their own belong to a sentence before them in
	// the same paragraph or item; a paragraph of markers alone is a
	// citation list.
	r.last, r.lastClaim, r.lastOK, r.lastUncited = "", -1, false, -1
	list := citationLabelOnly(u.leadIn) // the items of a "Sources:" list
	for _, s := range r.sentences(u.start, u.end) {
		text := cleanClaim(r.stripMarkers(s.start, s.end))
		ms := r.markersIn(s.start, s.end)
		if !hasWord(text) {
			r.attach(ms)
			continue
		}
		sentence := text
		if u.leadIn != "" {
			text = u.leadIn + " " + text
		}
		r.last, r.lastClaim, r.lastOK, r.lastUncited = text, -1, !list && checkable(text), -1
		switch {
		case len(ms) > 0 && r.lastOK:
			r.claims = append(r.claims, claim{Text: text, Markers: ms})
			r.lastClaim = len(r.claims) - 1
		case len(ms) == 0 && !list && u.kind != unitHeading && factual(sentence, r.text[u.start:u.end]):
			r.addUncited(s.start, s.end)
		}
	}
}

// addUncited records a factual sentence without a marker (its span without
// the surrounding whitespace).
func (r *claimReader) addUncited(start, end int) {
	for start < end && unicode.IsSpace(rune(r.text[start])) {
		start++
	}
	for end > start && unicode.IsSpace(rune(r.text[end-1])) {
		end--
	}
	r.uncited = append(r.uncited, span{start, end})
	r.lastUncited = len(r.uncited) - 1
}

// citationLabelRE is a leading citation-list label: "Citations:",
// "Sources:", "References:", "See:" and the like.
var citationLabelRE = regexp.MustCompile(`(?i)^[\s\p{P}]*(?:citations?|sources?(?:\s+used)?|references?|refs?|see(?:\s+also)?|` +
	`cited(?:\s+sources)?|works\s+cited|bibliography)\s*:`)

// citationLabelOnly reports a label with nothing after it ("Sources:").
func citationLabelOnly(s string) bool {
	rest, ok := stripCitationLabel(s)
	return ok && !hasWord(rest)
}

func stripCitationLabel(s string) (string, bool) {
	loc := citationLabelRE.FindStringIndex(s)
	if loc == nil {
		return s, false
	}
	return s[loc[1]:], true
}

// checkable reports a claim worth checking: without a leading citation
// label, at least three words and a letter. "Citations: , ," (a citation
// list) and "Deadlines" (a heading) say nothing a source could support, so
// a verdict on them would only blame the sources they cite.
func checkable(claim string) bool {
	rest, _ := stripCitationLabel(claim)
	words, letter := 0, false
	for _, f := range strings.Fields(rest) {
		if hasWord(f) {
			words++
		}
		letter = letter || strings.IndexFunc(f, unicode.IsLetter) >= 0
	}
	return words >= 3 && letter
}

// attach gives markers without a sentence of their own to the last one.
func (r *claimReader) attach(ms []claimMarker) {
	if len(ms) == 0 || r.last == "" || !r.lastOK {
		return
	}
	if r.lastUncited >= 0 { // the markers cite it after all
		r.uncited = slices.Delete(r.uncited, r.lastUncited, r.lastUncited+1)
		r.lastUncited = -1
	}
	if r.lastClaim < 0 {
		r.claims = append(r.claims, claim{Text: r.last})
		r.lastClaim = len(r.claims) - 1
	}
	r.claims[r.lastClaim].Markers = append(r.claims[r.lastClaim].Markers, ms...)
}

// readRow records a table row's claim ("Header: cell; …") and returns the
// table's header (this row when it starts the table).
func (r *claimReader) readRow(ln line, header []string) []string {
	s := r.text[ln.start:ln.end]
	if tableSepRE.MatchString(s) {
		return header
	}
	cells := tableCells(r.stripMarkers(ln.start, ln.end))
	ms := r.markersIn(ln.start, ln.end)
	var parts []string
	for i, c := range cells {
		c = cleanClaim(c)
		if c == "" {
			continue
		}
		if header != nil && i < len(header) && header[i] != "" {
			c = header[i] + ": " + c
		}
		parts = append(parts, c)
	}
	text := strings.Join(parts, "; ")
	if hasWord(text) {
		r.last, r.lastClaim, r.lastOK, r.lastUncited = text, -1, checkable(text), -1
		switch {
		case len(ms) > 0 && r.lastOK:
			r.claims = append(r.claims, claim{Text: text, Markers: ms})
			r.lastClaim = len(r.claims) - 1
		case len(ms) == 0 && header != nil && factual(strings.Join(dataCells(cells), " "), ""):
			// A data row (not the header) without a citation: its span ends
			// inside the last cell, before the closing pipe.
			r.addUncited(ln.start, rowEnd(r.text, ln))
		}
	}
	if header == nil {
		for i := range cells {
			cells[i] = cleanClaim(cells[i])
		}
		return cells
	}
	return header
}

func tableCells(row string) []string {
	row = strings.TrimSpace(row)
	row = strings.TrimSuffix(strings.TrimPrefix(row, "|"), "|")
	return strings.Split(row, "|")
}

func (r *claimReader) markersIn(start, end int) []claimMarker {
	var out []claimMarker
	for _, m := range r.markers {
		if m.At >= start && m.At < end {
			out = append(out, m)
		}
	}
	return out
}

// stripMarkers is text[start:end] without the markers of the answer in it
// (and the whitespace before them). Brackets that aren't markers stay:
// "`[3]int`" is part of the claim.
func (r *claimReader) stripMarkers(start, end int) string {
	var b strings.Builder
	last := start
	for _, m := range r.markers {
		if m.At < start || m.At >= end || m.End <= last {
			continue // outside, or another number of a group already removed
		}
		b.WriteString(r.text[last:max(m.Start, last)])
		last = min(m.End, end)
	}
	b.WriteString(r.text[last:end])
	return b.String()
}

// cleanClaim is a sentence (without its markers) as plain text.
func cleanClaim(s string) string {
	return strings.Join(strings.Fields(plainText(s)), " ")
}

func hasWord(s string) bool {
	return strings.IndexFunc(s, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) >= 0
}

// span is a sentence's byte span.
type span struct{ start, end int }

// sentences splits text[start:end] into sentences. A sentence ends at . !
// or ? followed by whitespace (not a decimal point, an abbreviation, or
// before a lowercase word); closing quotes, brackets, emphasis and markers
// right after the punctuation stay with it ("Fees are $10.[1] Next").
func (r *claimReader) sentences(start, end int) []span {
	var out []span
	ss := start
	for i := start; i < end; {
		c, size := utf8.DecodeRuneInString(r.text[i:])
		i += size
		if !strings.ContainsRune(".!?。！？", c) || !r.endsSentence(i-size, i, end) {
			continue
		}
		j := r.skipClosers(i, end)
		if next, _ := utf8.DecodeRuneInString(r.text[j:end]); j < end && !unicode.IsSpace(next) {
			continue // models write U+202F and other Unicode spaces too
		}
		out = append(out, span{ss, j})
		ss, i = j, j
	}
	if strings.TrimSpace(r.text[ss:end]) != "" {
		out = append(out, span{ss, end})
	}
	return out
}

// skipClosers moves past closing characters and markers after a sentence's
// punctuation.
func (r *claimReader) skipClosers(j, end int) int {
	for j < end {
		if strings.ContainsRune(`)]"'”’*_`, rune(r.text[j])) {
			j++
			continue
		}
		if m := r.markerAt(j); m > j && m <= end {
			j = m
			continue
		}
		return j
	}
	return j
}

// markerAt returns the end of the marker starting at i, or -1.
func (r *claimReader) markerAt(i int) int {
	for _, m := range r.markers {
		if m.Start == i {
			return m.End
		}
	}
	return -1
}

// abbreviations that end with a period but not a sentence (lowercase,
// without the final period).
var abbreviations = map[string]bool{
	"e.g": true, "i.e": true, "etc": true, "vs": true, "dr": true, "mr": true, "mrs": true, "ms": true, "prof": true,
	"st": true, "no": true, "inc": true, "jr": true, "sr": true, "approx": true, "fig": true, "dept": true,
	"u.s": true, "a.m": true, "p.m": true, "ph.d": true, "ave": true, "bldg": true, "rm": true, "ext": true,
}

// endsSentence decides whether the punctuation at text[p:q] can end a
// sentence (whitespace after it is checked by the caller).
func (r *claimReader) endsSentence(p, q, end int) bool {
	if r.text[p] != '.' {
		return true
	}
	if q < end && r.text[q] >= '0' && r.text[q] <= '9' {
		return false // a decimal: $10.50
	}
	w := p
	for w > 0 && (isWordByte(r.text[w-1]) || r.text[w-1] == '.') {
		w--
	}
	word := strings.ToLower(r.text[w:p])
	if abbreviations[word] || (len(word) == 1 && unicode.IsUpper(rune(r.text[w]))) {
		return false
	}
	// "…, e.g. the fee" and other lowercase continuations.
	for k := q; k < end; {
		next, size := utf8.DecodeRuneInString(r.text[k:end])
		if next == '\n' || !unicode.IsSpace(next) {
			return !unicode.IsLower(next)
		}
		k += size
	}
	return true
}

func isWordByte(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9'
}
