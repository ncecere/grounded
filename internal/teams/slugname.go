package teams

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Slugs are ASCII (ValidateSlug), so a name in another script is turned into letters first: accents are
// dropped (Ünï → uni), a few Latin letters have their usual spelling (ß → ss), and Cyrillic and Greek use
// the common romanisation (Привет → privet; letters Unicode writes as a base letter plus a mark, such as й and ё,
// lose the mark). A script with no such mapping (Chinese, Japanese, Arabic,
// emoji) contributes nothing, and the name's other words are kept (#132). The same rules are in
// web/src/lib/slug.ts, so the form's suggestion and the server's default agree.
var slugLetters = map[rune]string{
	'ß': "ss", 'æ': "ae", 'œ': "oe", 'ø': "o", 'đ': "d", 'ð': "d", 'þ': "th", 'ł': "l", 'ı': "i", 'ħ': "h",
	// Cyrillic.
	'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ж': "zh", 'з': "z", 'и': "i", 'к': "k",
	'л': "l", 'м': "m", 'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u", 'ф': "f", 'х': "kh", 'ц': "ts",
	'ч': "ch", 'ш': "sh", 'щ': "shch", 'ъ': "", 'ы': "y", 'ь': "", 'э': "e", 'ю': "yu", 'я': "ya", 'і': "i", 'є': "ye", 'ґ': "g",
	// Greek (accents are already gone).
	'α': "a", 'β': "v", 'γ': "g", 'δ': "d", 'ε': "e", 'ζ': "z", 'η': "i", 'θ': "th", 'ι': "i", 'κ': "k", 'λ': "l", 'μ': "m",
	'ν': "n", 'ξ': "x", 'ο': "o", 'π': "p", 'ρ': "r", 'σ': "s", 'ς': "s", 'τ': "t", 'υ': "y", 'φ': "f", 'χ': "ch", 'ψ': "ps", 'ω': "o",
}

// SlugFromName suggests a slug of at most max characters from a display name: lower case, ASCII letters and
// digits joined by single hyphens. It returns "" when the name has no usable letters, would be a single
// character (a lone letter is not an address) or is not a valid slug (reserved, or shaped like an ID); the
// caller then picks its own default or asks for one.
func SlugFromName(name string, max int) string {
	var b strings.Builder
	dash := false
	for _, r := range norm.NFKD.String(strings.ToLower(name)) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		part := string(r)
		if m, ok := slugLetters[r]; ok {
			part = m
		}
		for _, c := range part {
			if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
				if dash && b.Len() > 0 {
					b.WriteByte('-')
				}
				b.WriteRune(c)
				dash = false
			} else {
				dash = true
			}
		}
	}
	s := b.String()
	if len(s) > max {
		s = strings.TrimRight(s[:max], "-")
	}
	if len(s) < 2 || ValidateSlug(s) != nil {
		return ""
	}
	return s
}
