// Package tags normalises document tags, which metadata filters match
// (docs/phase3-agents.md §3). Tags are lower-cased and trimmed, 1-64
// characters, without commas or control characters.
package tags

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/ncecere/grounded/internal/apperr"
)

// Limits on tags.
const (
	MaxLength = 64
	MaxPerDoc = 20
)

// One normalises a tag; ok is false when it is not valid.
func One(t string) (string, bool) {
	t = strings.ToLower(strings.TrimSpace(t))
	if t == "" || len([]rune(t)) > MaxLength || strings.ContainsRune(t, ',') || strings.IndexFunc(t, unicode.IsControl) >= 0 {
		return "", false
	}
	return t, true
}

// Normalize validates and deduplicates tags (at most MaxPerDoc). It never
// returns nil.
func Normalize(in []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range in {
		t, ok := One(raw)
		if !ok {
			return nil, apperr.Invalid("invalid_tags", fmt.Sprintf("Tags must be 1-%d characters without commas", MaxLength))
		}
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	if len(out) > MaxPerDoc {
		return nil, apperr.Invalid("invalid_tags", fmt.Sprintf("A document can have at most %d tags", MaxPerDoc))
	}
	return out, nil
}

// Split parses form values that may hold several comma-separated tags.
func Split(values []string) []string {
	var out []string
	for _, v := range values {
		for _, p := range strings.Split(v, ",") {
			if strings.TrimSpace(p) != "" {
				out = append(out, p)
			}
		}
	}
	return out
}
