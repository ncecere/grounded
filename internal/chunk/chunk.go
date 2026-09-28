// Package chunk splits parser Markdown (see internal/parse) into retrieval
// chunks sized in embedding tokens.
//
// A document is parsed into blocks (headings, paragraphs, lists, tables,
// fenced code, and page markers). Blocks are packed greedily into chunks of
// at most Options.MaxTokens tokens. Every heading of level 1-3 starts a new
// chunk so sections stay together; deeper headings may share a chunk with
// their parent section. A heading never ends up alone at the end of a chunk:
// it moves to the next chunk together with its body.
//
// Blocks larger than MaxTokens are split at natural boundaries (sentences for
// paragraphs, items then lines for lists, rows for tables with the header
// repeated, lines for code with the fence repeated) and, as a last resort, by
// tokens. The only way a chunk can exceed MaxTokens is when a single rune
// (the smallest unit that can be cut without corrupting UTF-8) is itself
// longer than MaxTokens, which only happens with absurdly small limits.
package chunk

import (
	"errors"
	"fmt"
	"strings"
)

// Options configures Split.
type Options struct {
	MaxTokens     int          // target maximum tokens per chunk (e.g. 512); required > 0
	OverlapTokens int          // tokens of trailing context repeated at the start of the next chunk within the same section (0 = none); must be < MaxTokens
	Counter       TokenCounter // required

	// DropBlock, when set, is called with each block's text (see Blocks);
	// blocks it reports are left out, as repeated boilerplate
	// (internal/boilerplate). Heading paths are computed before dropping, so
	// the remaining blocks keep the path of a dropped heading, and a dropped
	// level 1-3 heading still ends the chunk before it.
	DropBlock func(text string) bool

	// DropImageOnly leaves out chunks whose only text is images (alt text),
	// headings and rules, unless every chunk is like that. Images inside
	// chunks with other text are kept.
	DropImageOnly bool
}

// Chunk is one retrieval unit.
type Chunk struct {
	Ordinal     int      // 0-based position in the document
	Content     string   // Markdown text of the chunk (no page markers; heading lines of the section it starts in are NOT repeated here unless they are part of the chunk's own text)
	HeadingPath []string // headings in effect at the chunk's start, outermost first, e.g. ["Admissions", "Deadlines"]
	PageStart   int      // first page the chunk's text comes from; 0 when the document has no page markers
	PageEnd     int      // last page; 0 when unpaginated
	Tokens      int      // Counter.Count(Content)
}

// Split chunks a Markdown document. Deterministic for the same input and
// options.
//
// HeadingPath is the path in effect after any heading lines that open the
// chunk, so a chunk starting "## Deadlines" under "# Admissions" has the path
// ["Admissions", "Deadlines"]. It is never nil.
func Split(markdown string, opts Options) ([]Chunk, error) {
	if opts.MaxTokens <= 0 {
		return nil, errors.New("chunk: MaxTokens must be positive")
	}
	if opts.OverlapTokens < 0 || opts.OverlapTokens >= opts.MaxTokens {
		return nil, fmt.Errorf("chunk: OverlapTokens must be in [0, MaxTokens), got %d", opts.OverlapTokens)
	}
	if opts.Counter == nil {
		return nil, errors.New("chunk: Counter is required")
	}
	doc := normalize(markdown)
	if doc == "" {
		return nil, nil
	}
	blocks, paginated := parseBlocks(doc)
	if opts.DropBlock != nil {
		blocks = dropBlocks(blocks, opts.DropBlock)
	}
	s := newSplitter(opts)
	s.prepare(blocks)
	drafts := s.pack(blocks)
	out := s.finish(drafts, paginated)
	if opts.DropImageOnly {
		out = dropImageOnly(out)
	}
	return out, nil
}

// Block is one structural block of a document as Split sees it: a heading
// line, paragraph, list, table or fenced code block, without page markers.
type Block struct {
	Text    string
	Heading bool
}

// Blocks returns a Markdown document's blocks in order. Options.DropBlock is
// called with the same texts.
func Blocks(markdown string) []Block {
	doc := normalize(markdown)
	if doc == "" {
		return nil
	}
	blocks, _ := parseBlocks(doc)
	out := make([]Block, len(blocks))
	for i, b := range blocks {
		out[i] = Block{Text: b.text, Heading: b.kind == kindHeading}
	}
	return out
}

// dropBlocks removes the blocks drop reports. A dropped section heading's
// chunk boundary moves to the next remaining block.
func dropBlocks(blocks []*block, drop func(string) bool) []*block {
	out := make([]*block, 0, len(blocks))
	brk := false
	for _, b := range blocks {
		if drop(b.text) {
			brk = brk || b.brk
			continue
		}
		if brk {
			b.brk, brk = true, false
		}
		out = append(out, b)
	}
	return out
}

// EmbedText is the text to embed for a chunk: a short context header
// (document title and heading path) followed by the content, so sections
// that only make sense in context still embed well. Example:
//
//	"Student Handbook\nRegistration > Late registration\n\n<content>"
//
// Empty parts are omitted. Callers prepend any model-specific prefix
// themselves.
func EmbedText(title string, c Chunk) string {
	var head []string
	if t := oneLine(title); t != "" {
		head = append(head, t)
	}
	path := make([]string, 0, len(c.HeadingPath))
	for _, h := range c.HeadingPath {
		if h = oneLine(h); h != "" {
			path = append(path, h)
		}
	}
	if len(path) > 0 {
		head = append(head, strings.Join(path, " > "))
	}
	header := strings.Join(head, "\n")
	switch {
	case header == "":
		return c.Content
	case strings.TrimSpace(c.Content) == "":
		return header
	}
	return header + "\n\n" + c.Content
}

// oneLine collapses all whitespace runs (including newlines) to one space.
func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }
