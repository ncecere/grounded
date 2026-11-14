// Package pii finds likely personal data in a document's parsed text at ingest (B7, docs/v0.9.0.md "PII scanning
// at ingest"): patterns first, fast and explainable, with checks against false positives. A finding says only what
// kind of data, how many matches and on which pages: the matched text is never returned, stored or logged.
package pii

import (
	"regexp"
	"slices"
	"strings"

	"github.com/ncecere/grounded/internal/parse"
)

// Built-in kinds.
const (
	KindUSSSN       = "us_ssn"       // US Social Security numbers, with the SSA's validity rules
	KindPaymentCard = "payment_card" // card numbers of known networks that pass the Luhn check
)

// Limits: scanning is bounded whatever the document, and a finding stays small.
const (
	MaxPatterns      = 20
	MaxPatternLength = 500
	maxCount         = 10000 // counts stop here
	maxPages         = 100   // pages listed per finding
	maxLineBytes     = 64 << 10
)

// Pattern is a platform admin's own kind of personal data (an institution's ID format), as a bounded RE2 regular
// expression: matching is linear in the text, so a pattern cannot make ingestion slow.
type Pattern struct {
	Name string
	Re   *regexp.Regexp
}

// Finding is one kind of data found in a document: how many matches, and the pages they are on (1-based, ascending;
// empty for a document without pages). It never holds the matches themselves.
type Finding struct {
	Kind  string `json:"kind"`
	Count int    `json:"count"`
	Pages []int  `json:"pages"`
}

var (
	ssnRe  = regexp.MustCompile(`\b(\d{3})[- ](\d{2})[- ](\d{4})\b`)
	cardRe = regexp.MustCompile(`\b(?:\d[ -]?){12,18}\d\b`)
)

// Scan finds the built-in kinds and the custom patterns in parsed Markdown, line by line, attributing each match to
// the page its line is on. The order of the findings is stable: built-in kinds first, then the patterns in order.
func Scan(markdown string, patterns []Pattern) []Finding {
	acc := map[string]*Finding{}
	order := []string{KindUSSSN, KindPaymentCard}
	for _, p := range patterns {
		order = append(order, p.Name)
	}
	page := 0
	for line := range strings.SplitSeq(markdown, "\n") {
		if n, ok := parse.ParsePageMarker(line); ok {
			page = n
			continue
		}
		if len(line) > maxLineBytes {
			line = line[:maxLineBytes]
		}
		add(acc, KindUSSSN, page, countSSN(line))
		add(acc, KindPaymentCard, page, countCards(line))
		for _, p := range patterns {
			add(acc, p.Name, page, len(p.Re.FindAllStringIndex(line, -1)))
		}
	}
	out := []Finding{}
	for _, k := range order {
		if f := acc[k]; f != nil && f.Count > 0 {
			out = append(out, *f)
		}
	}
	return out
}

func add(acc map[string]*Finding, kind string, page, n int) {
	if n == 0 {
		return
	}
	f := acc[kind]
	if f == nil {
		f = &Finding{Kind: kind, Pages: []int{}}
		acc[kind] = f
	}
	f.Count = min(f.Count+n, maxCount)
	if page > 0 && len(f.Pages) < maxPages && !slices.Contains(f.Pages, page) {
		f.Pages = append(f.Pages, page)
		slices.Sort(f.Pages)
	}
}

// countSSN counts numbers written as AAA-GG-SSSS (or with spaces) that the SSA could have issued: no area 000, 666
// or 900-999, no group 00, no serial 0000, and not the numbers known from advertising and documentation.
func countSSN(line string) int {
	n := 0
	for _, m := range ssnRe.FindAllStringSubmatch(line, -1) {
		area, group, serial := m[1], m[2], m[3]
		if area == "000" || area == "666" || area[0] == '9' || group == "00" || serial == "0000" {
			continue
		}
		if s := area + group + serial; s == "078051120" || s == "219099999" || s == "123456789" {
			continue
		}
		n++
	}
	return n
}

// countCards counts 13-19 digit numbers (single spaces or dashes between digits allowed) of a known card network's
// range that pass the Luhn check, leaving out runs of one repeated digit.
func countCards(line string) int {
	n := 0
	for _, m := range cardRe.FindAllString(line, -1) {
		digits := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, m)
		if len(digits) < 13 || len(digits) > 19 || strings.Count(digits, digits[:1]) == len(digits) || !knownNetwork(digits) || !luhn(digits) {
			continue
		}
		n++
	}
	return n
}

// cardRange is a card network's issuer prefixes (lo-hi over the first width digits) and its card lengths.
type cardRange struct {
	lo, hi, width  int
	minLen, maxLen int
	only           []int // lengths allowed between minLen and maxLen (nil: all)
}

// cardRanges are the major networks' ranges: Visa, Mastercard (51-55 and 2221-2720), American Express, Discover, JCB and
// Diners Club.
var cardRanges = []cardRange{
	{lo: 4, hi: 4, width: 1, minLen: 13, maxLen: 19, only: []int{13, 16, 19}},
	{lo: 51, hi: 55, width: 2, minLen: 16, maxLen: 16},
	{lo: 2221, hi: 2720, width: 4, minLen: 16, maxLen: 16},
	{lo: 34, hi: 34, width: 2, minLen: 15, maxLen: 15},
	{lo: 37, hi: 37, width: 2, minLen: 15, maxLen: 15},
	{lo: 6011, hi: 6011, width: 4, minLen: 16, maxLen: 19},
	{lo: 65, hi: 65, width: 2, minLen: 16, maxLen: 19},
	{lo: 644, hi: 649, width: 3, minLen: 16, maxLen: 19},
	{lo: 3528, hi: 3589, width: 4, minLen: 16, maxLen: 19},
	{lo: 300, hi: 305, width: 3, minLen: 14, maxLen: 19},
	{lo: 36, hi: 36, width: 2, minLen: 14, maxLen: 19},
	{lo: 38, hi: 39, width: 2, minLen: 14, maxLen: 19},
}

// knownNetwork checks the issuer prefix and length of the major card networks.
func knownNetwork(d string) bool {
	for _, r := range cardRanges {
		if len(d) < r.minLen || len(d) > r.maxLen || (r.only != nil && !slices.Contains(r.only, len(d))) {
			continue
		}
		v := 0
		for _, c := range d[:r.width] {
			v = v*10 + int(c-'0')
		}
		if v >= r.lo && v <= r.hi {
			return true
		}
	}
	return false
}

func luhn(d string) bool {
	sum, double := 0, false
	for i := len(d) - 1; i >= 0; i-- {
		v := int(d[i] - '0')
		if double {
			if v *= 2; v > 9 {
				v -= 9
			}
		}
		sum += v
		double = !double
	}
	return sum%10 == 0
}

// compilePattern checks a platform admin's pattern: a name for the kind (1-60 characters, not a built-in kind) and an
// RE2 expression of at most MaxPatternLength characters that does not match the empty string (it would count every
// position).
func compilePattern(name, expr string) (Pattern, bool) {
	name = strings.TrimSpace(name)
	if len(name) == 0 || len(name) > 60 || name == KindUSSSN || name == KindPaymentCard || len(expr) == 0 || len(expr) > MaxPatternLength {
		return Pattern{}, false
	}
	re, err := regexp.Compile(expr)
	if err != nil || re.MatchString("") {
		return Pattern{}, false
	}
	return Pattern{Name: name, Re: re}, true
}
