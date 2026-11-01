package contextual

import (
	"strings"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/chunk"
)

// fitInput fits DERIVED fields to the metadata plan before keying or admission.
// The ceiling includes the empty frame and slack, so empty fields always fit.
// No token additivity or monotonicity is assumed: every candidate is counted
// after escaping, including cut marks and chat framing, with the same counter
// used by admission. Applying WithMargin to both sides preserves the bound.
//
// Only an overflowing prompt changes. Halve the longest field (stable ties),
// preserving a rune boundary and marking the cut. Each step strictly reduces
// that field's byte length, by roughly half; candidate lengths never grow and the number
// of counts is logarithmic in the already bounded derived fields' lengths.
// Source text, citation headings, metadata and hashes are never modified.
func fitInput(in Input, ceiling int, c chunk.TokenCounter) Input {
	fields := []*string{&in.Section, &in.Opening, &in.HeadingPath, &in.Title}
	for promptTokens(in, c) > ceiling {
		longest := fields[0]
		for _, field := range fields[1:] {
			if len(*field) > len(*longest) {
				longest = field
			}
		}
		if len(*longest) <= 2*len(cutMark) {
			*longest = ""
			continue
		}
		text := strings.TrimSuffix(*longest, cutMark)
		end := len(text) / 2
		for end > 0 && !utf8.RuneStart(text[end]) {
			end--
		}
		*longest = text[:end] + cutMark
	}
	return in
}
