// Package displaytext validates human-assigned names used in lists and audit
// records. It does not sanitize document content or prevent Unicode confusables.
package displaytext

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/apperr"
)

// Validate rejects characters that can hide or reorder a displayed identity.
// Check the original input before whitespace trimming, filename cleanup or
// persistence. Length/emptiness and authorization remain the caller's concern.
// Combining marks and variation selectors are allowed for ordinary Unicode text;
// format characters, including joiners in some emoji/scripts, are not.
func Validate(value, code, label string) error {
	if !utf8.ValidString(value) {
		return apperr.Invalid(code, label+" must be valid UTF-8")
	}
	for _, r := range value {
		if hidden(r) {
			return apperr.Invalid(code, label+" must not contain control, invisible formatting or line-separator characters")
		}
	}
	return nil
}

func hidden(r rune) bool {
	return unicode.IsControl(r) || unicode.In(r, unicode.Cf, unicode.Zl, unicode.Zp, unicode.Other_Default_Ignorable_Code_Point)
}

// Derived removes hidden characters from a label derived from free-form content.
// Never use it for an explicitly supplied name: those must be rejected instead
// of silently changing identity. The original content is not changed.
func Derived(value string) string {
	return strings.Map(func(r rune) rune {
		if hidden(r) {
			return -1
		}
		return r
	}, value)
}
