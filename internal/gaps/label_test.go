package gaps

import (
	"strings"
	"testing"
)

func TestCleanLabel(t *testing.T) {
	for in, want := range map[string]string{
		`"Parking permits."`:                                            "Parking permits",
		"Label: parking permits\nBecause people…":                       "Parking permits",
		"**Library hours on weekends and holidays at the main campus**": "Library hours on weekends and",
		"   ":                           "",
		"“Graduation dates”":            "Graduation dates",
		"Topic label: Transcript fees!": "Transcript fees",
	} {
		if got := CleanLabel(in); got != want {
			t.Errorf("CleanLabel(%q) = %q, want %q", in, got, want)
		}
	}
	if got := CleanLabel(strings.Repeat("x", 200)); len([]rune(got)) > labelMaxChars {
		t.Errorf("long label kept %d characters", len([]rune(got)))
	}
}

func TestLabelRequestHasOnlyTheQuestions(t *testing.T) {
	got := LabelRequest([]string{"Where do I  park?\n", strings.Repeat("a", 400)})
	lines := strings.Split(strings.TrimSpace(got), "\n")
	if len(lines) != 3 || lines[0] != "Questions:" || lines[1] != "- Where do I park?" || len([]rune(lines[2])) != labelQuestionChars+3 {
		t.Fatalf("request = %q", got)
	}
}

func TestStates(t *testing.T) {
	for in, n := range map[string]int{"": 1, "open": 1, "closed": 3, "all": 0} {
		if st, err := states(in); err != nil || len(st) != n {
			t.Errorf("states(%q) = %v, %v", in, st, err)
		}
	}
	if _, err := states("gone"); err == nil {
		t.Error("states(gone) accepted")
	}
}
