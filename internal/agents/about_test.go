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
		if v, present := got["ownershipNote"]; note == "" && present || note != "" && v != note {
			t.Fatalf("note %q stored as %v (present %v)", note, v, present)
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
	if _, present := got["ownershipNote"]; present || DecodeConfig(nil).OwnershipNote != "" {
		t.Fatal("old config must default to no note, and a config without one must not carry the key")
	}
}

// A release before #34 decodes requests with DisallowUnknownFields, so a configuration without a note must not
// carry the key at all: saves through an older API during a rolling upgrade keep working (ADR-0030).
func TestConfigWithoutNoteIsUnchanged(t *testing.T) {
	if strings.Contains(string(DefaultConfig().JSON()), "ownershipNote") {
		t.Fatal("a configuration without a note serializes the ownershipNote key")
	}
	raw, _ := json.Marshal(map[string]any{"ownershipNote": "Help team"})
	c, err := ParseConfig(raw)
	if err != nil || !strings.Contains(string(c.JSON()), `"ownershipNote":"Help team"`) {
		t.Fatalf("a note is not stored: %v %s", err, c.JSON())
	}
}
