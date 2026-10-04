// Checking a query rewrite (v0.4.2 US2-01): asked to rewrite a follow-up,
// a model sometimes answers it instead ("No, a student cannot extend a
// guest pass; only a sponsor can [1]."), and that answer was searched and
// shown in the search step. A rewrite is used only when it reads as a
// search query; otherwise the follow-up is searched with the earlier
// question (contextualQuery), as when the rewrite fails. The rules look at
// punctuation and length only, so they hold in any language:
//
//   - no citation markers ([1], ［1］): queries don't cite, answers do;
//   - no more sentences than the question has;
//   - a question isn't rewritten as a statement (ending with a full stop
//     or an exclamation mark; a query of keywords without one is fine);
//   - not much longer than the question with the earlier questions it may
//     draw on (contextualQuery's), plus room for a subject's name.

package agents

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// rewriteSlack is how many characters a rewrite may add beyond the question
// and the earlier questions it draws on (a subject named from an answer).
const rewriteSlack = 40

// rewriteMarker is a citation marker, ASCII or full-width.
var rewriteMarker = regexp.MustCompile(`[\[［]\s*\d+(?:\s*[,，]\s*\d+)*\s*[\]］]`)

// Sentence ends. Full-width ones (Chinese, Japanese) end a sentence without
// a space after them.
const (
	sentenceEnds   = ".!?;。！？؟।"
	fullWidthEnds  = "。！？"
	statementEnds  = ".!。！"
	questionEnds   = "?？؟"
	closingMarks   = "\"'”’)]）」』*_"
	minRewriteRune = 2
)

// notAQuery says why a rewrite isn't a search query ("" when it is one).
// fallback is what would be searched instead (the question with its
// earlier questions).
func notAQuery(q, question, fallback string) string {
	switch {
	case utf8.RuneCountInString(q) < minRewriteRune:
		return "too short"
	case rewriteMarker.MatchString(q):
		return "cites sources"
	case countSentences(q) > max(countSentences(question), 1):
		return "several sentences"
	case isQuestion(question) && endsWithAny(q, statementEnds):
		return "a statement for a question"
	case utf8.RuneCountInString(q) > utf8.RuneCountInString(fallback)+rewriteSlack:
		return "too long"
	}
	return ""
}

// endsWithAny reports text whose last rune (closing quotes and brackets
// aside) is one of marks.
func endsWithAny(text, marks string) bool {
	t := strings.TrimRight(strings.TrimSpace(text), closingMarks)
	last, _ := utf8.DecodeLastRuneInString(t)
	return t != "" && strings.ContainsRune(marks, last)
}

// countSentences counts the sentences of text: a sentence end followed by
// more text starts another one. A full stop after a single letter ("U.S.",
// "e.g.") or between digits ("1.5") doesn't end one.
func countSentences(text string) int {
	rs := []rune(strings.TrimSpace(text))
	if len(rs) == 0 {
		return 0
	}
	n := 1
	for i := 0; i < len(rs)-1; i++ {
		r := rs[i]
		if !strings.ContainsRune(sentenceEnds, r) || (r == '.' && abbreviation(rs, i)) {
			continue
		}
		j := i + 1
		for j < len(rs) && strings.ContainsRune(closingMarks, rs[j]) {
			j++
		}
		spaced := j < len(rs) && unicode.IsSpace(rs[j])
		for j < len(rs) && unicode.IsSpace(rs[j]) {
			j++
		}
		if j < len(rs) && (spaced || strings.ContainsRune(fullWidthEnds, r)) && (unicode.IsLetter(rs[j]) || unicode.IsDigit(rs[j])) {
			n++
			i = j - 1
		}
	}
	return n
}

// abbreviation reports a full stop at i that ends an abbreviation of one
// letter ("U.S.", "e.g.") or sits inside a number ("1.5").
func abbreviation(rs []rune, i int) bool {
	if i > 0 && unicode.IsDigit(rs[i-1]) && i+1 < len(rs) && unicode.IsDigit(rs[i+1]) {
		return true
	}
	return i > 0 && unicode.IsLetter(rs[i-1]) && (i == 1 || !unicode.IsLetter(rs[i-2]))
}
