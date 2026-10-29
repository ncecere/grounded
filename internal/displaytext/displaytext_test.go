package displaytext

import (
	"testing"

	"github.com/ncecere/grounded/internal/apperr"
)

func TestRejectsHiddenDisplayCharacters(t *testing.T) {
	for _, s := range []string{"\x00", "\x1b", "\x7f", "\u0085", "\t", "\r", "\n", "\u202e", "\u202a", "\u2066", "\u2069", "\u200b", "\u200c", "\u200d", "\ufeff", "\u2060", "\u00ad", "\u034f", "\u2028", "\u2029", string([]byte{0xff})} {
		t.Run(s, func(t *testing.T) {
			for _, value := range []string{s + "name", "na" + s + "me", "name" + s} {
				err := Validate(value, "invalid_name", "Name")
				e, ok := apperr.As(err)
				if !ok || e.Code != "invalid_name" || e.Status != 400 {
					t.Fatalf("Validate(%q) = %v", value, err)
				}
			}
		})
	}
}

func TestKeepsOrdinaryUnicodeAndLeavesLengthToCaller(t *testing.T) {
	for _, value := range []string{"", "  name  ", "Café", "Cafe\u0301", "العربية", "עברית", "中文", "हिन्दी", "Help ☕️", "Guide 😀", "Résumé.pdf"} {
		if err := Validate(value, "invalid_name", "Name"); err != nil {
			t.Errorf("Validate(%q) = %v", value, err)
		}
	}
}
