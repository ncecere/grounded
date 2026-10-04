package agents

import (
	"regexp"
	"strings"

	"github.com/ncecere/grounded/internal/kbs"
)

// leadHeading is a Markdown heading line at the start of a chunk.
var leadHeading = regexp.MustCompile(`^\s*#{1,6}[ \t]+([^\n]*)(?:\n|$)`)

// hitSnippet is a source's snippet without the headings at its start that
// its card already shows (the document's title and the passage's heading
// path): chunks begin with their section's headings, and "Renew Renew
// online at…" read the heading twice (v0.4.2 US2-11). Other headings stay.
func hitSnippet(h kbs.Hit) string {
	return snippet(dropShownHeadings(h.Content, append([]string{h.Title}, h.HeadingPath...)))
}

// dropShownHeadings removes the leading heading lines whose text is one of
// shown (case and surrounding spaces ignored), never the whole text.
func dropShownHeadings(s string, shown []string) string {
	for {
		m := leadHeading.FindStringSubmatchIndex(s)
		if m == nil {
			return s
		}
		text := strings.TrimSpace(strings.TrimRight(strings.TrimSpace(s[m[2]:m[3]]), "#"))
		rest := s[m[1]:]
		if !shownHeading(shown, text) || strings.TrimSpace(rest) == "" {
			return s
		}
		s = rest
	}
}

func shownHeading(shown []string, text string) bool {
	for _, h := range shown {
		if text != "" && strings.EqualFold(strings.TrimSpace(h), text) {
			return true
		}
	}
	return false
}
