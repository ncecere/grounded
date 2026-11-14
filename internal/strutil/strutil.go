// Package strutil holds the small string helpers that several packages
// need: bounding text by characters or bytes, collapsing it to one line and
// reading an optional string. Every limit cuts on a character boundary, so a
// bounded value is still valid UTF-8 (#253).
package strutil

import (
	"strings"
	"unicode/utf8"
)

// Ellipsis marks text that Clip shortened.
const Ellipsis = "…"

// Clip bounds s to n characters (runes). Longer text keeps its first n-1
// characters and ends with an ellipsis, so the result is never longer than
// n; use it for text a person reads (messages, titles, log lines).
func Clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	if n <= 0 {
		return ""
	}
	return string([]rune(s)[:n-1]) + Ellipsis
}

// Truncate bounds s to its first n characters (runes), without a marker.
func Truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	if n <= 0 {
		return ""
	}
	return string([]rune(s)[:n])
}

// TruncateBytes bounds s to at most n bytes without splitting a character:
// for limits counted in bytes (a wire format's field size).
func TruncateBytes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	if n <= 0 {
		return ""
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// OneLine collapses every run of white space, newlines included, into one
// space and trims the ends.
func OneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// Deref is the string p points to, or "" for nil.
func Deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
