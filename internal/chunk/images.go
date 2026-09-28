package chunk

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	// markdownImage is an image, ![alt](<src>) or ![alt](src "title"); the
	// alt text may contain escaped brackets.
	markdownImage = regexp.MustCompile(`!\[(?:\\.|[^\]\\])*\]\((?:<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\)`)
	// markdownTarget is a link's target, "](url)".
	markdownTarget = regexp.MustCompile(`\]\((?:<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\)`)
)

// ImageOnly reports whether a chunk's only text is images: after removing
// images (their alt text) and link targets, what remains is headings, rules
// and punctuation. Such a chunk, e.g. "![Front of the building](…)", says
// nothing a question could be answered from, yet can be retrieved and cited.
func ImageOnly(content string) bool {
	rest := markdownImage.ReplaceAllString(content, "")
	if len(rest) == len(content) {
		return false // no image
	}
	rest = markdownTarget.ReplaceAllString(rest, "]")
	for _, line := range strings.Split(rest, "\n") {
		if _, _, heading := atxHeading(line); heading {
			continue
		}
		if strings.ContainsFunc(line, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) {
			return false
		}
	}
	return true
}

// dropImageOnly removes image-only chunks and renumbers the rest. When every
// chunk is image-only, the document keeps them: its only content is never
// dropped.
func dropImageOnly(chunks []Chunk) []Chunk {
	out := make([]Chunk, 0, len(chunks))
	for _, c := range chunks {
		if !ImageOnly(c.Content) {
			c.Ordinal = len(out)
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		return chunks
	}
	return out
}
