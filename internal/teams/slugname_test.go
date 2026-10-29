package teams

import (
	"strings"
	"testing"
)

// #132: the suggested slug keeps accented and Cyrillic/Greek letters (romanised) and is never one letter or empty.
func TestSlugFromName(t *testing.T) {
	for in, want := range map[string]string{
		"Office of the Registrar":              "office-of-the-registrar",
		"  R&D -- Lab!  ":                      "r-d-lab",
		"Ünï":                                  "uni",
		"Über café 2":                          "uber-cafe-2",
		"Straße Ærø Łódź":                      "strasse-aero-lodz",
		"qa-build-日本語 ünï 😀":                   "qa-build-uni",
		"Привет, мир":                          "privet-mir",
		"Юрий Щукин":                           "yurii-shchukin",
		"Ελληνικά":                             "ellinika",
		"日本語":                                  "",
		"Ä":                                    "", // a single letter is not an address
		"😀 x 😀":                                "",
		"":                                     "",
		"Admin":                                "", // reserved
		"123e4567-e89b-12d3-a456-426614174000": "",
	} {
		if got := SlugFromName(in, 63); got != want {
			t.Errorf("SlugFromName(%q) = %q, want %q", in, got, want)
		}
		if got := SlugFromName(in, 63); got != "" && ValidateSlug(got) != nil {
			t.Errorf("SlugFromName(%q) = %q is not a valid slug", in, got)
		}
	}
	long := SlugFromName(strings.Repeat("ab ", 40), 30)
	if len(long) > 30 || strings.HasSuffix(long, "-") || ValidateSlug(long) != nil {
		t.Errorf("long name: %q", long)
	}
}
