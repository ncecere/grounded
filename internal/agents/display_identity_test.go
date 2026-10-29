package agents

import (
	"strings"
	"testing"
)

func TestDerivedConversationTitleCannotReorderItsLabel(t *testing.T) {
	for _, tc := range []struct{ question, want string }{
		{"Hello\u202eworld\u200d\ufeff", "Helloworld"},
		{"\x1b\u202e\u200b", "New conversation"},
		{"\nA second line", "New conversation"},
		{"  Café ☕️\nSecond line", "Café ☕️"},
		{strings.Repeat("界", 81), strings.Repeat("界", 80) + "…"},
	} {
		if got := titleFrom(tc.question); got != tc.want {
			t.Errorf("titleFrom(%q) = %q, want %q", tc.question, got, tc.want)
		}
	}
}

func TestProfileChecksOriginalNameWithoutRequiringLegacyRename(t *testing.T) {
	for _, name := range []string{"\tName", "Name\n", "Na\u202eme", "Na\u200dme"} {
		if _, err := applyProfile(profileFields{}, Profile{Name: &name}); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
	legacy := profileFields{name: "old\u202ename"}
	description := "Updated description"
	if got, err := applyProfile(legacy, Profile{Description: &description}); err != nil || got.name != legacy.name {
		t.Fatalf("unrelated legacy update = %+v, %v", got, err)
	}
}
