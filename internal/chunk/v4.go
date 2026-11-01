package chunk

import "strings"

// structuralBoundaries implements Proposed ADR-0029 without rewriting parsed
// text. Formatting is a boundary signal, not a semantic procedure classifier.
// Run before dropping blocks so a removed label cannot erase the boundary.
func structuralBoundaries(blocks []*block) {
	section := 0
	var label string
	for i, b := range blocks {
		if b.kind == kindHeading {
			b.brk = true
			label = ""
			section++
		} else if i+1 < len(blocks) && topLevelList(blocks[i+1]) {
			if text := structuralLabel(b); text != "" {
				b.brk = true
				label = text
				section++
			}
		}
		if label != "" {
			b.path = append(append([]string{}, b.path...), label)
		}
		b.section = section
	}
}

func topLevelList(b *block) bool {
	return b.kind == kindList && b.indent == 0
}

func structuralLabel(b *block) string {
	if b.kind != kindPara || indentOf(b.text) != 0 || strings.Contains(b.text, "\n") {
		return ""
	}
	text := strings.TrimSpace(strings.TrimSuffix(b.text, ":"))
	for _, delim := range []string{"**", "__"} {
		if len(text) <= 2*len(delim) || !strings.HasPrefix(text, delim) || !strings.HasSuffix(text, delim) {
			continue
		}
		inner := strings.TrimSpace(text[len(delim) : len(text)-len(delim)])
		if inner != "" && !strings.ContainsAny(inner, "*_`") {
			return inner
		}
	}
	return ""
}
