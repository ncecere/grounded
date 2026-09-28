// Package boilerplate finds blocks of text that repeat across a source's
// documents (navigation, footers, "related content" cards, calls to action)
// so ingestion can leave them out of chunks (DESIGN.md §5.5, ADR-0021).
//
// It is pure: block normalisation and hashing, the per-source settings and
// their platform defaults, the classification threshold, and the decision
// which of a document's blocks to drop. Counting blocks across documents,
// storing the classification and re-chunking live in internal/ingest.
package boilerplate

import (
	"errors"
	"hash/fnv"
	"math"
	"regexp"
	"strings"
	"unicode"
)

// Settings are a source's overrides; nil fields inherit the platform
// defaults for the source's type.
type Settings struct {
	Enabled *bool    `json:"enabled,omitempty"`
	MinDocs *int     `json:"minDocs,omitempty"`
	Ratio   *float64 `json:"ratio,omitempty"`
}

// IsZero reports whether s overrides nothing.
func (s Settings) IsZero() bool { return s.Enabled == nil && s.MinDocs == nil && s.Ratio == nil }

// Bounds of the settings.
const (
	MinMinDocs = 2 // a block in one document is not repeated
	MaxMinDocs = 100000
	MinRatio   = 0.05 // lower would call ordinary shared phrasing boilerplate
	MaxRatio   = 1.0
)

// ErrInvalid wraps settings outside their bounds.
var ErrInvalid = errors.New("invalid boilerplate settings")

// Validate checks the overrides against their bounds.
func (s Settings) Validate() error {
	if s.MinDocs != nil && (*s.MinDocs < MinMinDocs || *s.MinDocs > MaxMinDocs) {
		return errors.Join(ErrInvalid, errors.New("minDocs must be from 2 to 100000"))
	}
	if s.Ratio != nil && (math.IsNaN(*s.Ratio) || *s.Ratio < MinRatio || *s.Ratio > MaxRatio) {
		return errors.Join(ErrInvalid, errors.New("ratio must be from 0.05 to 1"))
	}
	return nil
}

// Defaults are the platform defaults (BOILERPLATE_* settings).
type Defaults struct {
	Web     bool    // on for web sources
	Upload  bool    // on for upload sources (opt-in by default)
	MinDocs int     // a block must repeat in at least this many documents
	Ratio   float64 // ... and in at least this share of the source's documents
}

// DefaultDefaults are the built-in defaults, tuned on two real sites
// (docs/benchmarks/boilerplate.md).
var DefaultDefaults = Defaults{Web: true, Upload: false, MinDocs: 5, Ratio: 0.2}

// Effective are the settings in force for one source.
type Effective struct {
	Enabled bool
	MinDocs int
	Ratio   float64
}

// Resolve applies a source's overrides to the defaults for its type.
func (d Defaults) Resolve(sourceType string, s Settings) Effective {
	e := Effective{Enabled: d.Upload, MinDocs: d.MinDocs, Ratio: d.Ratio}
	if sourceType == "web" {
		e.Enabled = d.Web
	}
	if s.Enabled != nil {
		e.Enabled = *s.Enabled
	}
	if s.MinDocs != nil {
		e.MinDocs = *s.MinDocs
	}
	if s.Ratio != nil {
		e.Ratio = *s.Ratio
	}
	e.MinDocs = max(e.MinDocs, MinMinDocs)
	return e
}

// Threshold is how many of a source's documents must contain a block for it
// to be boilerplate: max(minDocs, ceil(ratio × documents)). It is never
// below 2.
func (e Effective) Threshold(documents int) int {
	byRatio := int(math.Ceil(e.Ratio*float64(documents) - 1e-9))
	return max(e.MinDocs, byRatio, MinMinDocs)
}

// linkTarget matches the target of a Markdown link or image, "](<url>)" or
// "](url)". Targets differ between pages for the same visible block (a
// relative link resolved against each page), so they are not compared.
var linkTarget = regexp.MustCompile(`\]\((?:<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\)`)

// Normalize is the text a block is compared by: link and image targets
// removed, lower case, every run of digits folded to one "0" (dates, years,
// counts) and whitespace collapsed. Markdown structure such as "##" or "-"
// is kept, so a page's own heading does not match the same words in a card.
// Digits are kept where they are the content: in headings ("Step 2" names
// a section) and in blocks with fewer than foldLetters letters, such as an
// article's date line "2026/09/01" or "Page 12 of 340".
func Normalize(text string) string {
	text = linkTarget.ReplaceAllString(text, "]")
	fold := !strings.HasPrefix(strings.TrimLeft(text, " "), "#") && letters(text) >= foldLetters
	var b strings.Builder
	b.Grow(len(text))
	space, digit := false, false
	for _, r := range text {
		switch {
		case unicode.IsSpace(r):
			space, digit = b.Len() > 0, false
			continue
		case fold && unicode.IsDigit(r):
			if digit {
				continue
			}
			r, digit = '0', true
		default:
			digit = false
			r = unicode.ToLower(r)
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		b.WriteRune(r)
	}
	return b.String()
}

// foldLetters is the fewest letters a block needs for its digits to be
// folded: below it, the numbers are most of what the block says.
const foldLetters = 8

func letters(s string) int {
	n := 0
	for _, r := range s {
		if unicode.IsLetter(r) {
			n++
		}
	}
	return n
}

// Hash identifies a block within a source: FNV-1a (64 bit) of Normalize, as
// a signed integer for Postgres bigint. It returns 0 for a block with no
// letters or digits (rules, separators), which is never counted.
func Hash(text string) int64 {
	n := Normalize(text)
	if !strings.ContainsFunc(n, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) {
		return 0
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(n))
	return int64(h.Sum64()) //nolint:gosec // a bit pattern, not a quantity
}

// SampleLen is the most characters of a block's text kept for display.
const SampleLen = 200

// markdownImage is an image's start, "![alt]" after link targets are gone.
var markdownImage = regexp.MustCompile(`!\[([^\]]*)\]`)

// markup is Markdown punctuation removed from display samples: heading and
// list markers at line starts, emphasis, code ticks, image and link
// brackets, and table pipes.
var markup = regexp.MustCompile(`(?m)^\s*(?:#{1,6}|[-*+]|\d+[.)])\s+|\*\*|__|` + "`" + `|!\[|\[|\]|\|`)

// Sample is a block's text as shown to a source's owners: link targets and
// Markdown punctuation removed, whitespace collapsed, at most SampleLen
// characters.
func Sample(text string) string {
	text = linkTarget.ReplaceAllString(text, "]")
	text = markdownImage.ReplaceAllString(text, "Image: $1")
	text = strings.Join(strings.Fields(markup.ReplaceAllString(text, " ")), " ")
	if r := []rune(text); len(r) > SampleLen {
		text = string(r[:SampleLen])
	}
	return text
}

// Block is one block of a parsed document.
type Block struct {
	Hash    int64
	Heading bool
}

// Hashes returns the distinct non-zero hashes of blocks, in first-seen order.
func Hashes(blocks []Block) []int64 {
	seen := make(map[int64]bool, len(blocks))
	out := make([]int64, 0, len(blocks))
	for _, b := range blocks {
		if b.Hash != 0 && !seen[b.Hash] {
			seen[b.Hash] = true
			out = append(out, b.Hash)
		}
	}
	return out
}

// Drops decides which of a document's blocks to leave out: those whose hash
// drop reports as boilerplate for this document. A document's only content
// is never dropped: when no non-heading block would remain, nothing is
// dropped and guarded is true. The result holds distinct hashes.
func Drops(blocks []Block, drop func(int64) bool) (dropped []int64, guarded bool) {
	keepsBody := false
	set := map[int64]bool{}
	for _, b := range blocks {
		switch {
		case b.Hash != 0 && drop(b.Hash):
			if !set[b.Hash] {
				set[b.Hash] = true
				dropped = append(dropped, b.Hash)
			}
		case !b.Heading && b.Hash != 0:
			keepsBody = true
		}
	}
	if len(dropped) > 0 && !keepsBody {
		return nil, true
	}
	return dropped, false
}
