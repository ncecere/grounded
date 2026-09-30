package agents

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/google/uuid"
)

// Citation is a source referenced by an answer (docs/phase3-agents.md §6.6).
type Citation struct {
	N           int       `json:"n"`
	DocumentID  uuid.UUID `json:"documentId"`
	SourceID    uuid.UUID `json:"sourceId"`
	Title       string    `json:"title"`
	Snippet     string    `json:"snippet"`
	HeadingPath []string  `json:"headingPath"`
	PageStart   *int32    `json:"pageStart,omitempty"`
	PageEnd     *int32    `json:"pageEnd,omitempty"`
	// URL is set only for web pages, and only in snippet_link mode.
	URL string `json:"url,omitempty"`
	// Filename is the uploaded file of a passage from an upload (the MCP
	// server's ask shows it, like search does).
	Filename string `json:"filename,omitempty"`
	// Verification and Confidence are set by SystemOne citation checks
	// (docs/systemone.md §3): verified, unsupported, contradicted or
	// unchecked, with the model's confidence.
	Verification string   `json:"verification,omitempty"`
	Confidence   *float64 `json:"confidence,omitempty"`
	// Markers has the check of each [n] of this source in the answer text,
	// in order (verdicts.go): the verdict on that marker's own claim.
	Markers []MarkerVerdict `json:"markers,omitempty"`
	// Kind is tool when the source is an MCP tool's result (DocumentID and
	// SourceID are then the nil UUID), with the server's name and the tool;
	// empty for passages (docs/mcp-client.md).
	Kind      string `json:"kind,omitempty"`
	Server    string `json:"server,omitempty"`
	Tool      string `json:"tool,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
}

// SourceTool is the kind of a source that is an MCP tool's result.
const SourceTool = "tool"

// markerRE matches [1], [1, 2] and [1,2,3]; [1][2] is two matches. Only
// findMarkers (markers.go) uses it: a match in code or attached to an
// identifier is not a marker. Any
// whitespace before a marker (models emit U+202F and other Unicode spaces)
// is captured (group 1) so a removed marker takes it along. Models trained
// on other citation styles are accepted too: fullwidth ［1］, and gpt-oss's
// lenticular 【1】 and 【1†L10-L12】 (the † suffix is dropped). Group 2 holds
// the numbers.
var markerRE = regexp.MustCompile(`([\s\p{Z}]*)(?:\[|［|【)(\d{1,3}(?:\s*[,，]\s*\d{1,3})*)(?:†[^】\]］]*)?(?:\]|］|】)`)

// snippet is up to 300 characters of a chunk as plain text: Markdown
// syntax removed (chunks are stored as Markdown), whitespace collapsed.
func snippet(s string) string {
	s = strings.Join(strings.Fields(plainText(s)), " ")
	return truncateRunes(s, 300)
}

var (
	mdImage    = regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`)
	mdLink     = regexp.MustCompile(`\[([^\]]+)\]\((?:<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)`)
	mdAutolink = regexp.MustCompile(`<(https?://[^>\s]+)>`)
	mdLineMark = regexp.MustCompile(`(?m)^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d{1,3}[.)][ \t]+)`)
	mdFence    = regexp.MustCompile("(?m)^[ \t]*(?:```|~~~)[^\n]*$")
	mdRule     = regexp.MustCompile(`(?m)^[ \t]*(?:[-*_][ \t]*){3,}$|^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$`)
	// Emphasis as CommonMark sees it: the opening marker isn't inside a
	// word (snake_case stays), the text doesn't start or end with a space
	// (2 * 3 * 4 stays), and the closing marker isn't followed by a letter.
	mdEmphasis  = regexp.MustCompile(`(^|[^\p{L}\p{N}])(\*\*|__|\*|_|~~|` + "`" + `)([^\s*_~` + "`" + `](?:[^*_~` + "`" + `\n]*?[^\s*_~` + "`" + `])?)(\*\*|__|\*|_|~~|` + "`" + `)($|[^\p{L}\p{N}])`)
	mdTableEdge = regexp.MustCompile(`(?m)^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$`)
)

// plainText strips the common Markdown our chunker produces (headings,
// emphasis, links, images, lists, quotes, fences, rules, table pipes) so a
// snippet reads as prose. It isn't a full Markdown parser; it only has to
// make short previews readable.
func plainText(s string) string {
	s = mdFence.ReplaceAllString(s, "")
	s = mdRule.ReplaceAllString(s, "")
	s = mdImage.ReplaceAllString(s, "$1")
	s = mdLink.ReplaceAllString(s, "$1")
	s = mdAutolink.ReplaceAllString(s, "$1")
	s = mdLineMark.ReplaceAllString(s, "")
	// Several passes: nested emphasis (**_x_**) and adjacent spans that
	// share a boundary character.
	for i := 0; i < 3; i++ {
		s = mdEmphasis.ReplaceAllStringFunc(s, func(m string) string {
			g := mdEmphasis.FindStringSubmatch(m)
			if g[2] != g[4] {
				return m
			}
			return g[1] + g[3] + g[5]
		})
	}
	s = mdTableEdge.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, " | ", " · ")
	return strings.TrimSpace(s)
}

// applyCitations parses [n] markers in text against the numbered sources.
// It returns the text with unknown markers removed and groups normalised to
// [1][2], and the citations in number order. With mode none every marker is
// removed and no citations are returned. Brackets that aren't markers (in
// code, a[3], links) are left as they are.
func applyCitations(text string, sources []numberedHit, mode string) (string, []Citation) {
	byN := map[int]numberedHit{}
	for _, h := range sources {
		byN[h.N] = h
	}
	cited := map[int]bool{}
	out := rewriteMarkers(text, func(n int) bool {
		if _, ok := byN[n]; ok && mode != CitationNone {
			cited[n] = true
			return true
		}
		return false
	})
	// Removing a marker at the end of a sentence can leave "word ." spacing;
	// markers are removed with their leading whitespace, so only tidy ends.
	out = strings.TrimRightFunc(out, unicode.IsSpace)
	if mode == CitationNone {
		return out, []Citation{}
	}
	ns := make([]int, 0, len(cited))
	for n := range cited {
		ns = append(ns, n)
	}
	sort.Ints(ns)
	cites := make([]Citation, 0, len(ns))
	for _, n := range ns {
		cites = append(cites, citationOf(byN[n], mode))
	}
	return out, cites
}

// rewriteMarkers keeps the numbers of text's markers that keep accepts,
// one per marker ([1, 2] becomes [1][2]), and removes the rest.
func rewriteMarkers(text string, keep func(n int) bool) string {
	var b strings.Builder
	last, carry := 0, ""
	for _, m := range findMarkers(text) {
		if m.Start > last {
			carry = "" // text in between: nothing to carry over
		}
		b.WriteString(text[last:m.Start])
		last = m.End
		var kept []string
		for _, n := range markerNums(m.Inner) {
			if keep(n) {
				kept = append(kept, "["+strconv.Itoa(n)+"]")
			}
		}
		lead := m.lead(text)
		if len(kept) == 0 {
			// A removed marker's space moves to a marker right after it:
			// "fee [9][1]" reads "fee [1]", not "fee[1]".
			if carry == "" {
				carry = lead
			}
			continue
		}
		if lead == "" {
			lead = carry
		}
		carry = ""
		// A normalised 【1】 or ［1］ right after or before an identifier
		// ("online【2】") gets a space, or it would not read as a marker.
		if s := b.String(); lead == "" && !m.ascii(text) && s != "" && isIdentByte(s[len(s)-1]) {
			lead = " "
		}
		b.WriteString(lead + strings.Join(kept, ""))
		if !m.ascii(text) && m.End < len(text) && isIdentByte(text[m.End]) {
			b.WriteString(" ")
		}
	}
	b.WriteString(text[last:])
	return b.String()
}

// citationOf is the citation of a numbered source.
func citationOf(h numberedHit, mode string) Citation {
	c := Citation{N: h.N, DocumentID: h.DocumentID, SourceID: h.SourceID, Title: h.Title, Snippet: snippet(h.Content),
		HeadingPath: h.HeadingPath}
	if c.HeadingPath == nil {
		c.HeadingPath = []string{}
	}
	if h.PageStart > 0 {
		ps, pe := h.PageStart, h.PageEnd
		c.PageStart, c.PageEnd = &ps, &pe
	}
	if mode == CitationSnippetLink && isWebURL(h.URL) {
		c.URL = h.URL
	}
	if h.Tool != nil {
		c.Kind, c.Server, c.Tool, c.Truncated = SourceTool, h.Tool.ServerName, h.Tool.Tool, h.Tool.Truncated
	} else if !isWebURL(h.URL) {
		c.Filename = h.Filename
	}
	return c
}

func isWebURL(u string) bool {
	return strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")
}

// isRefusal reports whether an answer is the refusal message (ignoring
// markers, surrounding whitespace, case and a trailing period).
func isRefusal(text, refusal string) bool {
	norm := func(s string) string {
		s = removeAllMarkers(s)
		s = strings.Join(strings.Fields(s), " ")
		s = strings.Trim(strings.ToLower(s), `"'“”`)
		return strings.TrimRight(s, ".!")
	}
	return refusal != "" && norm(text) == norm(refusal)
}
