package catalog

import (
	"testing"

	"github.com/ncecere/grounded/internal/apperr"
)

func TestOutputTokensFitTheKnownChatWindow(t *testing.T) {
	n := func(v int32) *int32 { return &v }
	for _, tc := range []struct {
		name, kind     string
		window, output *int32
		bad            bool
	}{
		{"unknown limits", KindChat, nil, nil, false},
		{"unknown output", KindChat, n(8000), nil, false},
		{"unknown context", KindChat, nil, n(9000), false},
		{"below", KindChat, n(8000), n(7999), false},
		{"equal", KindChat, n(8000), n(8000), false},
		{"above", KindChat, n(8000), n(8001), true},
		{"reported example", KindChat, n(8000), n(9000), true},
		{"vision has no chat context", KindVision, n(8000), n(9000), false},
		{"embedding clears context", KindEmbedding, n(8000), n(9000), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOutputWindow(tc.kind, tc.window, tc.output)
			if !tc.bad {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			e, ok := apperr.As(err)
			if !ok || e.Status != 400 || e.Code != "invalid_max_output_tokens" {
				t.Fatalf("want a helpful 400 invalid_max_output_tokens, got %v", err)
			}
		})
	}
}
