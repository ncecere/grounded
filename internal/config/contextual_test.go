package config

import "testing"

func TestContextualChunksRequireExplicitPlatformOptIn(t *testing.T) {
	if Defaults().ContextualChunks {
		t.Error("built-in contextual platform switch must be off without explicit opt-in")
	}
	for _, tc := range []struct {
		name string
		vars map[string]string
		want bool
	}{
		{name: "absent", vars: nil, want: false},
		{name: "explicit on", vars: map[string]string{"CONTEXTUAL_CHUNKS": "true"}, want: true},
		{name: "explicit off", vars: map[string]string{"CONTEXTUAL_CHUNKS": "false"}, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, err := LoadFrom("", env(tc.vars))
			if err != nil {
				t.Fatal(err)
			}
			if c.ContextualChunks != tc.want {
				t.Errorf("contextual switch = %v, want %v", c.ContextualChunks, tc.want)
			}
		})
	}
}
