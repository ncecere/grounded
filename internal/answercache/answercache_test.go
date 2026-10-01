package answercache

import (
	"testing"
	"time"
)

func TestNormalize(t *testing.T) {
	for in, want := range map[string]string{
		"Where do students buy a parking permit?":     "where do students buy a parking permit",
		"  where do  students\tbuy a parking permit ": "where do students buy a parking permit",
		"Hours on Saturday?!":                         "hours on saturday",
		"What does Ph.D. mean…":                       "what does ph.d. mean",
		"":                                            "",
	} {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHashSeparatesParts(t *testing.T) {
	if Hash("ab", "c") == Hash("a", "bc") {
		t.Error("parts run together")
	}
	if a, b := Hash("x", "y"), Hash("x", "y"); a != b || len(a) != 64 {
		t.Errorf("Hash = %q, %q", a, b)
	}
}

func TestDependsOnDay(t *testing.T) {
	for q, want := range map[string]bool{
		"is the library open today":              true,
		"when is the deadline":                   true,
		"what happens on saturday":               true,
		"where do students buy a parking permit": false,
		"how much is a transcript":               false,
	} {
		if got := DependsOnDay(q); got != want {
			t.Errorf("DependsOnDay(%q) = %v, want %v", q, got, want)
		}
	}
}

func TestAgentSettingsDefaults(t *testing.T) {
	st := DefaultAgentSettings()
	if !st.On("public") || st.On("team") || st.On("all_authenticated") {
		t.Error("the default is on for public agents only")
	}
	off, on := false, true
	st.Enabled = &off
	if st.On("public") {
		t.Error("an agent's off wins over the default")
	}
	st.Enabled = &on
	if !st.On("team") {
		t.Error("an agent's on wins over the default")
	}
	if st.Expiry() != 24*time.Hour {
		t.Errorf("expiry = %v", st.Expiry())
	}
}

func TestVectorText(t *testing.T) {
	if got := vectorText([]float32{0.5, -1, 2}); got != "[0.5,-1,2]" {
		t.Errorf("vectorText = %q", got)
	}
}
