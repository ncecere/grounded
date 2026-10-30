package chunk

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Parents, for parent/child retrieval (docs/parent-child-retrieval.md, ADR-0026). A parent is a run of consecutive chunks (children) of one
// document, so it is a function of the chunks the chunker produced and nothing else: no splitter state, no chunker version. That keeps it
// independent of the version-specific rules in v2.go and later.

// Limits of a parent. MaxParentTokens bounds the parent size a profile may ask for; MaxParentChildren bounds the rows one parent reads.
const (
	MaxParentTokens   = 8192
	MaxParentChildren = 64
)

// Range is a parent: the ordinals of its first and last child, both inclusive. A parent of one child has First == Last.
type Range struct{ First, Last int }

// Passages is the number of children in the parent.
func (r Range) Passages() int { return r.Last - r.First + 1 }

// Contains reports whether the ordinal is one of the parent's children.
func (r Range) Contains(ordinal int) bool { return ordinal >= r.First && ordinal <= r.Last }

// Parents returns, for each chunk (by index), the parent it belongs to: nil when maxTokens is 0 or less (the profile has no parents).
//
// A parent starts at a chunk and takes the next one while the next one has the same heading path, directly follows it in the document, the
// tokens so far plus its own stay within maxTokens, and the parent has fewer than MaxParentChildren chunks. A section longer than maxTokens is
// therefore cut greedily from its start; a section of one chunk is a parent of its own; a document without headings is cut into windows.
// The chunks' own token counts are added up, so overlap between neighbours is counted twice and the bound holds for the text as well.
func Parents(chunks []Chunk, maxTokens int) []Range {
	if maxTokens <= 0 || len(chunks) == 0 {
		return nil
	}
	maxTokens = min(maxTokens, MaxParentTokens)
	out := make([]Range, len(chunks))
	start, tokens := 0, 0
	closeAt := func(end int) { // chunks [start, end) are one parent
		r := Range{First: chunks[start].Ordinal, Last: chunks[end-1].Ordinal}
		for i := start; i < end; i++ {
			out[i] = r
		}
	}
	for i, c := range chunks {
		if i > start {
			prev := chunks[i-1]
			if c.Ordinal != prev.Ordinal+1 || !samePath(c.HeadingPath, prev.HeadingPath) || tokens+c.Tokens > maxTokens || i-start >= MaxParentChildren {
				closeAt(i)
				start, tokens = i, 0
			}
		}
		tokens += c.Tokens
	}
	closeAt(len(chunks))
	return out
}

func samePath(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// minOverlap is the shortest repeated text treated as chunk overlap (shorter matches are coincidences, like a repeated word).
const minOverlap = 24

// Overlap is the length in bytes of the longest suffix of a that is a prefix of b (at least 24 bytes, and not the whole of b), or 0: the text
// the chunker carried over from the chunk before. The source viewer and the parent text both remove it with this function, so what a person
// reads in the viewer is the text the model was given.
func Overlap(a, b string) int {
	if len(b) < minOverlap || len(a) < minOverlap {
		return 0
	}
	head := b[:minOverlap]
	best := 0
	for i := strings.Index(a, head); i >= 0; {
		if n := len(a) - i; n < len(b) && strings.HasPrefix(b, a[i:]) {
			best = n
			break // the earliest start is the longest overlap
		}
		j := strings.Index(a[i+1:], head)
		if j < 0 {
			break
		}
		i += j + 1
	}
	return best
}

// TrimOverlaps returns the contents of consecutive chunks with each one's repeated start removed, so they read like the document.
func TrimOverlaps(contents []string) []string {
	out := append([]string(nil), contents...)
	for i := 1; i < len(out); i++ {
		if n := Overlap(out[i-1], out[i]); n > 0 {
			out[i] = strings.TrimLeft(out[i][n:], " \t\n")
		}
	}
	return out
}

// ParentText is the text of a parent: its children's contents without the repetition, joined by a blank line (a child that was only
// repetition is left out).
func ParentText(contents []string) string {
	parts := TrimOverlaps(contents)
	kept := parts[:0]
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, "\n\n")
}

// TextHash is the hash (hex SHA-256) of a parent's text: what a citation records of the text the model was given, and what the source viewer
// compares before it shows the section as the cited one.
func TextHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}
