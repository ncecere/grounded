package config

import (
	"strings"
	"testing"
)

// RETRIEVAL_PARENT_EXPANSION is the operator's switch for parent/child retrieval (docs/parent-child-retrieval.md §9): on unless it says off.
func TestParentExpansionSwitch(t *testing.T) {
	c, err := LoadFrom("", env(nil))
	if err != nil || !c.ParentExpansion {
		t.Fatalf("default: %v %v", c.ParentExpansion, err)
	}
	for value, want := range map[string]bool{"false": false, "0": false, "true": true, "1": true} {
		c, err := LoadFrom("", env(map[string]string{"RETRIEVAL_PARENT_EXPANSION": value}))
		if err != nil || c.ParentExpansion != want {
			t.Errorf("%q: %v %v, want %v", value, c.ParentExpansion, err, want)
		}
	}
	if _, err := LoadFrom("", env(map[string]string{"RETRIEVAL_PARENT_EXPANSION": "maybe"})); err == nil || !strings.Contains(err.Error(), "RETRIEVAL_PARENT_EXPANSION") {
		t.Errorf("a value that is not a boolean: %v", err)
	}
}
