package sources

import (
	"strings"
	"testing"
)

func TestOverlap(t *testing.T) {
	carry := "Permits are sold by Transportation Services."
	for _, c := range []struct {
		name, a, b string
		want       int
	}{
		{"carried sentence", "Students must display a permit. " + carry, carry + " Lots open at six.", len(carry)},
		{"none", "Students must display a permit.", "Lots open at six in the morning every day.", 0},
		{"too short to tell", "The fee is due. Pay it", "Pay it online at the bursar.", 0},
		{"the whole next passage is not overlap", "Intro text here. " + carry, carry, 0},
		{"earliest start wins", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab", 32},
	} {
		if got := overlap(c.a, c.b); got != c.want {
			t.Errorf("%s: overlap = %d, want %d", c.name, got, c.want)
		}
	}
}

func TestTrimOverlaps(t *testing.T) {
	carry := "Permits are sold by Transportation Services."
	ps := []ContextPassage{
		{Ordinal: 3, Content: "Students must display a permit. " + carry},
		{Ordinal: 4, Content: carry + " Lots open at six every morning.", Cited: true},
		{Ordinal: 5, Content: "Lots open at six every morning. Overnight parking needs a pass."},
		{Ordinal: 7, Content: "Overnight parking needs a pass. Not adjacent."},
	}
	got := trimOverlaps(ps)
	// The cited passage stays whole: the one before it loses the repeated tail.
	if got[0].Content != "Students must display a permit." || got[1].Content != carry+" Lots open at six every morning." {
		t.Errorf("before the cited passage = %q / %q", got[0].Content, got[1].Content)
	}
	// After it, the next passage loses its repeated head; a gap in ordinals is left alone.
	if got[2].Content != "Overnight parking needs a pass." || !strings.HasPrefix(got[3].Content, "Overnight") {
		t.Errorf("after = %q / %q", got[2].Content, got[3].Content)
	}
}
