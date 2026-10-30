package chunk

import (
	"fmt"
	"strings"
	"unicode"
)

// Chunker versions (Options.Version, an embedding profile's chunker_version).
//
// Version 1 is the original chunker: every heading of level 1 to 3 starts a new chunk. It never changes (a golden test pins its output), because
// every profile uses it unless an admin chooses another.
//
// Version 2 keeps everything version 1 does and adds two rules, to leave fewer, fuller chunks:
//
//   - Short neighbouring sections are merged. At a heading of level 2 or 3, the chunk being filled takes the next section too when the chunk is
//     under the floor (MaxTokens/4), the whole next section is under it as well, the two fit in MaxTokens, the new heading is under the same parent
//     heading the chunk started in, and no page boundary lies between them. A level 1 heading always starts a new chunk. The heading lines stay in
//     the merged chunk, so nothing loses its title.
//   - A chunk with no body (only headings, rules and images) is dropped, unless every chunk of the document is like that. Version 1 drops only
//     such chunks that contain an image (ImageOnly).
//
// Version 3 keeps everything version 2 does and keeps tables structured (tables.go, docs/DESIGN.md "Tables"): a table that fits stays whole, an
// over-long one is cut by rows with its caption and header row repeated in every piece, and no row is lost, duplicated or cut across two passages.
const (
	Version1 = 1
	Version2 = 2
	Version3 = 3
)

// ValidVersion reports whether v is a chunker version Split knows (0 means version 1).
func ValidVersion(v int32) bool { return v == 0 || v == Version1 || v == Version2 || v == Version3 }

func checkVersion(v int32) error {
	if !ValidVersion(v) {
		return fmt.Errorf("chunk: unknown version %d", v)
	}
	return nil
}

// sectionTokens returns, for each block that starts a section (a heading that is a chunk boundary), the tokens of the section: its blocks and
// the separators between them, up to the next boundary.
func (sp *splitter) sectionTokens(blocks []*block) []int {
	out := make([]int, len(blocks))
	start := -1
	total := 0
	flush := func() {
		if start >= 0 {
			out[start] = total
		}
	}
	for i, b := range blocks {
		if b.brk {
			flush()
			start, total = i, 0
		}
		if start >= 0 {
			total += b.tokens + sp.sepTok
		}
	}
	flush()
	return out
}

// parentPath is a heading path without its last element: the headings above the section.
func parentPath(path []string) []string {
	if len(path) == 0 {
		return nil
	}
	return path[:len(path)-1]
}

func hasPrefix(path, prefix []string) bool {
	if len(prefix) > len(path) {
		return false
	}
	for i, p := range prefix {
		if path[i] != p {
			return false
		}
	}
	return true
}

// mergeable reports whether the section starting at blocks[i] (a heading that would start a new chunk) joins the chunk being filled (version 2).
func (sp *splitter) mergeable(i int, next *block) bool {
	if sp.floor == 0 || len(sp.cur) == 0 || next.level < 2 {
		return false
	}
	section := sp.secTok[i]
	if sp.base >= sp.floor || section >= sp.floor || sp.base+sp.sepTok+section > sp.max {
		return false
	}
	if !hasPrefix(parentPath(next.path), sp.parent) {
		return false
	}
	last := sp.cur[len(sp.cur)-1]
	return next.marks[0].page == last.b.pageAt(max(last.end-1, 0))
}

// bodyless reports whether a chunk has no body: once images and link targets are removed, nothing but headings, rules and punctuation is left.
func bodyless(content string) bool {
	rest := markdownImage.ReplaceAllString(content, "")
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
