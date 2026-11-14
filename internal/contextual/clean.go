package contextual

import (
	"errors"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/displaytext"
)

// Why a reply could not be used. Neither carries the reply.
var (
	// ErrRefused: the model declined (UNABLE, or an apology or "as an AI" opening).
	ErrRefused = errors.New("the model did not write a description")
	// ErrUnusable: nothing, or too little, was left of the reply after cleaning.
	ErrUnusable = errors.New("the model's reply was empty or unusable")
)

var (
	urlRE     = regexp.MustCompile(`(?i)\b(?:https?|ftp|file|data|javascript)://\S+|\bwww\.\S+`)
	markupRE  = regexp.MustCompile("[`*_#>|~\\[\\]{}<]")
	bulletRE  = regexp.MustCompile(`^\s*(?:[-+•·]|\d+[.)])\s+`)
	refusalRE = regexp.MustCompile(`(?i)^\s*(?:unable\b|i['’]?m\s+(?:sorry|unable|not able)|i\s+am\s+(?:sorry|unable|not able)|sorry[,.! ]|i\s+(?:can['’]?t|cannot|can\s+not|won['’]?t|will\s+not)\b|as\s+an?\s+(?:ai|language model|assistant)\b)`)
	spaceRE   = regexp.MustCompile(`\s+`)
)

// clean turns a model's reply into a context: one plain paragraph with no markup, links, quotation marks or invisible characters, at most
// ContextMaxChars characters and ContextMaxTokens tokens. A refusal or what is left of an empty reply is an error: it is not stored and not
// embedded. The reply is data from a model that read an untrusted document; this is the only place it passes on the way to the embedder.
func clean(reply string, c chunk.TokenCounter) (string, error) {
	s := strings.ToValidUTF8(reply, "")
	if refusalRE.MatchString(s) {
		return "", ErrRefused
	}
	s = urlRE.ReplaceAllString(s, " ")
	s = bulletRE.ReplaceAllString(s, "")
	s = markupRE.ReplaceAllString(s, " ")
	s = strings.Map(func(r rune) rune {
		switch r {
		case '"', '“', '”', '«', '»':
			return -1
		case '\u0085', '\u2028', '\u2029':
			return ' '
		}
		return r
	}, s)
	s = spaceRE.ReplaceAllString(displaytextSpaces(s), " ")
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > ContextMaxChars {
		s = cutAtWord(s, ContextMaxChars)
	}
	if c != nil && c.Count(s) > ContextMaxTokens {
		for i := 0; i < 6 && c.Count(s) > ContextMaxTokens; i++ {
			s = cutAtWord(s, max(utf8.RuneCountInString(s)*ContextMaxTokens/c.Count(s)*95/100, 1))
		}
	}
	if utf8.RuneCountInString(s) < ContextMinChars {
		return "", ErrUnusable
	}
	return s, nil
}

// displaytextSpaces turns control characters that separate words (tab, newline) into spaces, then removes the other hidden characters
// (zero-width, bidirectional and formatting characters).
func displaytextSpaces(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return ' '
		}
		return r
	}, s)
	return displaytext.Derived(s)
}

// cutAtWord keeps at most n runes, ending at a word boundary when there is one in the last fifth.
func cutAtWord(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	r = r[:n]
	if i := lastSpace(r); i > n*4/5 {
		r = r[:i]
	}
	return strings.TrimRightFunc(string(r), func(c rune) bool { return unicode.IsSpace(c) || c == ',' || c == ';' || c == ':' })
}

func lastSpace(r []rune) int {
	for i := len(r) - 1; i >= 0; i-- {
		if r[i] == ' ' {
			return i
		}
	}
	return -1
}
