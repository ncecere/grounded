// Code: fenced blocks for <pre> (with the language when declared) and
// inline code spans.

package htmlmd

import (
	"strings"
	"unicode"

	xhtml "golang.org/x/net/html"
)

// codeText returns the literal text of a code subtree (<br> as newline) and
// any page markers inside it, which are hoisted after the code.
func codeText(n *xhtml.Node) (string, []string) {
	var b strings.Builder
	var markers []string
	var walk func(*xhtml.Node, int)
	walk = func(n *xhtml.Node, depth int) {
		if depth > maxRenderDepth {
			return
		}
		switch n.Type {
		case xhtml.TextNode:
			b.WriteString(n.Data)
		case xhtml.CommentNode:
			if m, ok := pageMarker(n); ok {
				markers = append(markers, m)
			}
		case xhtml.ElementNode:
			if n.Data == "br" {
				b.WriteByte('\n')
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c, depth+1)
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		walk(c, 0)
	}
	return b.String(), markers
}

func codeLanguage(n *xhtml.Node) string {
	candidates := []*xhtml.Node{n}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == xhtml.ElementNode {
			candidates = append(candidates, c)
			break
		}
	}
	lang := ""
	for _, node := range candidates {
		for _, key := range []string{"data-lang", "data-language"} {
			if v := strings.TrimSpace(attr(node, key)); v != "" && lang == "" {
				lang = v
			}
		}
		for _, class := range strings.Fields(attr(node, "class")) {
			if lang != "" {
				break
			}
			for _, prefix := range []string{"language-", "lang-"} {
				if strings.HasPrefix(class, prefix) {
					lang = strings.TrimPrefix(class, prefix)
					break
				}
			}
		}
	}
	// The info string is attacker-controlled: keep a short, safe token.
	var out strings.Builder
	for _, r := range lang {
		if out.Len() >= 32 {
			break
		}
		if r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune("+#._-", r)) {
			out.WriteRune(r)
		}
	}
	return out.String()
}

func (st *renderState) renderPre(b *strings.Builder, n *xhtml.Node) {
	code, markers := codeText(n)
	if strings.TrimSpace(code) != "" {
		fence := backtickFence(code, 3)
		b.WriteString("\n\n")
		start := b.Len()
		// Keep all source code whitespace; the extra newline belongs to the fence.
		b.WriteString(fence + codeLanguage(n) + "\n" + code + "\n" + fence)
		st.protected = append(st.protected, renderSpan{start, b.Len()})
		b.WriteString("\n\n")
	}
	st.flushMarkers(b, markers)
}

func (st *renderState) renderInlineCode(b *strings.Builder, n *xhtml.Node) {
	code, markers := codeText(n)
	code = strings.NewReplacer("\r\n", " ", "\n", " ", "\r", " ").Replace(code)
	if strings.TrimSpace(code) != "" {
		fence := backtickFence(code, 1)
		b.WriteString(fence + " " + code + " " + fence)
	}
	st.flushMarkers(b, markers)
}

// backtickFence returns a fence longer than any backtick run in s; linear even
// for a body consisting entirely of backticks.
func backtickFence(s string, minimum int) string {
	longest, run := 0, 0
	for _, c := range s {
		if c == '`' {
			run++
			longest = max(longest, run)
		} else {
			run = 0
		}
	}
	return strings.Repeat("`", max(minimum, longest+1))
}
