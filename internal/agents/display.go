package agents

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/ncecere/grounded/internal/agentloop"
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

// snippetMatches reports whether a passage is the one a citation's snippet
// was made from: as snippets are made now, or as they were before v0.4.2
// (with the leading headings).
func snippetMatches(content string, c Citation) bool {
	return snippet(content) == c.Snippet || snippet(dropShownHeadings(content, append([]string{c.Title}, c.HeadingPath...))) == c.Snippet
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

// titled stores the tool's title with each result it returns, so a stored
// answer's step names the tool as the live one did (US2-10).
func titled(title string, exec agentloop.ExecuteFunc) agentloop.ExecuteFunc {
	if title == "" {
		return exec
	}
	return func(ctx context.Context, id string, params json.RawMessage, update func(agentloop.ToolResult)) (agentloop.ToolResult, error) {
		res, err := exec(ctx, id, params, update)
		if d, ok := res.Details.(toolDetails); ok {
			d.Title = title
			res.Details = d
		}
		return res, err
	}
}

// title records a tool's title under the name the model calls it.
func (m *mcpState) title(name, title string) {
	if title == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.titles == nil {
		m.titles = map[string]string{}
	}
	m.titles[name] = title
}

// titleOf is the title of the tool the model called by name ("" for
// search_knowledge, untitled tools, and answers without MCP tools).
func (m *mcpState) titleOf(name string) string {
	if m == nil {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.titles[name]
}
