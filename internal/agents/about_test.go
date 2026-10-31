package agents

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOwnershipNote(t *testing.T) {
	for _, note := range []string{"Help team: ask your owner", strings.Repeat("é", 500), ""} {
		raw, _ := json.Marshal(map[string]any{"ownershipNote": note})
		c, err := ParseConfig(raw)
		if err != nil {
			t.Fatalf("valid note: %v", err)
		}
		var got map[string]any
		_ = json.Unmarshal(c.JSON(), &got)
		if got["ownershipNote"] != note {
			t.Fatalf("note not preserved: %v", got["ownershipNote"])
		}
	}
	for _, note := range []string{strings.Repeat("x", 501), "<b>owner</b>", "a\nb", "a\u202eb", "https://private.example.edu", "javascript:alert(1)"} {
		raw, _ := json.Marshal(map[string]any{"ownershipNote": note})
		if _, err := ParseConfig(raw); err == nil {
			t.Errorf("accepted unsafe note %q", note)
		}
	}
	var got map[string]any
	_ = json.Unmarshal(DefaultConfig().JSON(), &got)
	if got["ownershipNote"] != "" {
		t.Fatal("old config must default to no note")
	}
}
