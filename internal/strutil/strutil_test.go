package strutil

import (
	"testing"
	"unicode/utf8"
)

// Multi-byte text must never be cut inside a character (#253): the copies this
// package replaced cut by bytes and could return invalid UTF-8.
func TestBoundsCutOnCharacterBoundaries(t *testing.T) {
	const text = "Prüfungsämter für Studierende — 学生の手続き 🎓🎓"
	for n := 0; n <= len(text)+1; n++ {
		for name, got := range map[string]string{
			"Clip": Clip(text, n), "Truncate": Truncate(text, n), "TruncateBytes": TruncateBytes(text, n),
		} {
			if !utf8.ValidString(got) {
				t.Fatalf("%s(%d) = %q is not valid UTF-8", name, n, got)
			}
		}
		if got := utf8.RuneCountInString(Clip(text, n)); got > n {
			t.Errorf("Clip(%d) has %d characters", n, got)
		}
		if got := utf8.RuneCountInString(Truncate(text, n)); got > n {
			t.Errorf("Truncate(%d) has %d characters", n, got)
		}
		if got := len(TruncateBytes(text, n)); got > n {
			t.Errorf("TruncateBytes(%d) has %d bytes", n, got)
		}
	}
}

func TestBounds(t *testing.T) {
	for _, tc := range []struct{ name, got, want string }{
		{"clip short", Clip("äbc", 3), "äbc"},
		{"clip long", Clip("äbcdé", 4), "äbc…"},
		{"clip one", Clip("äbc", 1), "…"},
		{"truncate", Truncate("äbcdé", 4), "äbcd"},
		{"truncate short", Truncate("äb", 4), "äb"},
		{"bytes inside a character", TruncateBytes("aé", 2), "a"},
		{"bytes on a boundary", TruncateBytes("aéb", 3), "aé"},
		{"emoji", TruncateBytes("🎓x", 3), ""},
		{"one line", OneLine("  a\n\tb  c "), "a b c"},
	} {
		if tc.got != tc.want {
			t.Errorf("%s = %q, want %q", tc.name, tc.got, tc.want)
		}
	}
	if Deref(nil) != "" {
		t.Error("Deref(nil) is not empty")
	}
	s := "x"
	if Deref(&s) != "x" {
		t.Error("Deref lost the value")
	}
}
