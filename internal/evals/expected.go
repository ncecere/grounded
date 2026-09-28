// What a good result is (docs/evaluations.md §1): the expected documents of
// a question, how they are written in forms and CSV files, and how a
// retrieved document matches them.

package evals

import (
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
)

// Limits of a question.
const (
	MaxQuestionChars = 4000
	MaxNoteChars     = 2000
	maxExpected      = 20
	maxURLLen        = 2048
	maxFilenameLen   = 255
	maxPhrases       = 20
	maxPhraseChars   = 200
)

// Expected are a question's expected documents: any of them counts.
type Expected struct {
	// DocumentIDs are documents picked from the knowledge base.
	DocumentIDs []uuid.UUID `json:"documentIds,omitempty"`
	// URLs are web pages; one ending in * is a prefix
	// (https://example.edu/registrar/transcripts*).
	URLs []string `json:"urls,omitempty"`
	// Filenames are uploaded files' names (case-insensitive).
	Filenames []string `json:"filenames,omitempty"`
}

// Count is the number of expected documents.
func (e Expected) Count() int { return len(e.DocumentIDs) + len(e.URLs) + len(e.Filenames) }

// invalidExpected is a 400 about the expected documents.
func invalidExpected(format string, args ...any) error {
	return apperr.Invalid("invalid_expected", fmt.Sprintf(format, args...))
}

// ParseExpected reads the notation of forms and CSV files: values separated
// by |, where a UUID is a document, an http(s) URL is a page (ending in *
// for a prefix), and anything else is a filename.
func ParseExpected(s string) (Expected, error) {
	var e Expected
	for _, v := range strings.Split(s, "|") {
		v = strings.TrimSpace(v)
		switch {
		case v == "":
		case isUUID(v):
			e.DocumentIDs = append(e.DocumentIDs, uuid.MustParse(v))
		case hasScheme(v):
			e.URLs = append(e.URLs, v)
		default:
			e.Filenames = append(e.Filenames, v)
		}
	}
	return e.Normalize()
}

func isUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil && len(s) == 36
}

func hasScheme(s string) bool {
	l := strings.ToLower(s)
	return strings.HasPrefix(l, "http://") || strings.HasPrefix(l, "https://")
}

// Normalize trims and deduplicates the expected documents and checks them:
// at least one, at most 20, URLs are http(s) with a host (a * only at the
// end), filenames have no slash.
func (e Expected) Normalize() (Expected, error) {
	var out Expected
	seenDoc := map[uuid.UUID]bool{}
	for _, id := range e.DocumentIDs {
		if id != uuid.Nil && !seenDoc[id] {
			seenDoc[id] = true
			out.DocumentIDs = append(out.DocumentIDs, id)
		}
	}
	seen := map[string]bool{}
	for _, u := range e.URLs {
		u = strings.TrimSpace(u)
		if u == "" || seen["u"+u] {
			continue
		}
		if err := checkURL(u); err != nil {
			return out, err
		}
		seen["u"+u] = true
		out.URLs = append(out.URLs, u)
	}
	for _, f := range e.Filenames {
		f = strings.TrimSpace(f)
		if f == "" || seen["f"+strings.ToLower(f)] {
			continue
		}
		if len(f) > maxFilenameLen || strings.ContainsAny(f, "/\\") {
			return out, invalidExpected("%q isn't a filename, a document or an http(s) URL", clip(f, 60))
		}
		seen["f"+strings.ToLower(f)] = true
		out.Filenames = append(out.Filenames, f)
	}
	switch n := out.Count(); {
	case n == 0:
		return out, invalidExpected("Add at least one expected document: a document, a URL or URL prefix, or a filename")
	case n > maxExpected:
		return out, invalidExpected("A question can have at most %d expected documents", maxExpected)
	}
	return out, nil
}

func checkURL(u string) error {
	if len(u) > maxURLLen {
		return invalidExpected("URLs can be at most %d characters", maxURLLen)
	}
	base := strings.TrimSuffix(u, "*")
	p, err := url.Parse(base)
	if err != nil || (p.Scheme != "http" && p.Scheme != "https") || p.Host == "" || strings.Contains(base, "*") {
		return invalidExpected("%q isn't an http(s) URL (end it with * for a prefix)", clip(u, 80))
	}
	return nil
}

// String writes the | notation (the CSV export).
func (e Expected) String() string {
	var parts []string
	for _, id := range e.DocumentIDs {
		parts = append(parts, id.String())
	}
	parts = append(parts, e.URLs...)
	parts = append(parts, e.Filenames...)
	return strings.Join(parts, " | ")
}

// Doc is a retrieved (or cited) document, for matching.
type Doc struct {
	DocumentID uuid.UUID
	Title      string
	URL        string
	Filename   string
}

// normURL is a URL for comparison: without surrounding space and trailing
// slashes (as cmd/sparkbench's URL-judged sets compare them).
func normURL(u string) string { return strings.TrimRight(strings.TrimSpace(u), "/") }

// Matches reports whether d is one of the expected documents: the same
// document, a URL equal to an expected URL (trailing slashes aside) or
// starting with an expected prefix, or the same filename (case aside).
func (e Expected) Matches(d Doc) bool {
	for _, id := range e.DocumentIDs {
		if d.DocumentID == id {
			return true
		}
	}
	if d.URL != "" {
		for _, u := range e.URLs {
			if prefix, ok := strings.CutSuffix(u, "*"); ok {
				if strings.HasPrefix(d.URL, prefix) {
					return true
				}
			} else if normURL(d.URL) == normURL(u) {
				return true
			}
		}
	}
	if d.Filename != "" {
		for _, f := range e.Filenames {
			if strings.EqualFold(d.Filename, f) {
				return true
			}
		}
	}
	return false
}

// Rank is the 1-based position of the first document in docs that matches,
// or 0 when none does.
func (e Expected) Rank(docs []Doc) int {
	for i, d := range docs {
		if e.Matches(d) {
			return i + 1
		}
	}
	return 0
}

// existence is the question's expected documents in the form of
// ExpectedDocumentExists (URLs split into exact ones and prefixes,
// filenames lower-cased).
func (e Expected) existence() (docs []uuid.UUID, urls, prefixes, filenames []string) {
	docs = append([]uuid.UUID{}, e.DocumentIDs...)
	urls, prefixes, filenames = []string{}, []string{}, []string{}
	for _, u := range e.URLs {
		if p, ok := strings.CutSuffix(u, "*"); ok {
			prefixes = append(prefixes, p)
		} else {
			urls = append(urls, normURL(u))
		}
	}
	for _, f := range e.Filenames {
		filenames = append(filenames, strings.ToLower(f))
	}
	return docs, urls, prefixes, filenames
}

// NormalizePhrases trims and deduplicates must-mention phrases (case
// aside): at most 20, each at most 200 characters.
func NormalizePhrases(in []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, p := range in {
		p = strings.Join(strings.Fields(p), " ")
		if p == "" || seen[strings.ToLower(p)] {
			continue
		}
		if utf8.RuneCountInString(p) > maxPhraseChars {
			return nil, apperr.Invalid("invalid_must_mention", fmt.Sprintf("Must-mention phrases can be at most %d characters", maxPhraseChars))
		}
		seen[strings.ToLower(p)] = true
		out = append(out, p)
	}
	if len(out) > maxPhrases {
		return nil, apperr.Invalid("invalid_must_mention", fmt.Sprintf("A question can have at most %d must-mention phrases", maxPhrases))
	}
	return out, nil
}

// SplitList splits the | notation of must-mention phrases.
func SplitList(s string) []string {
	var out []string
	for _, v := range strings.Split(s, "|") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}
