package parse

import (
	"bytes"
	"context"
	"errors"
	"testing"
)

// Text and Markdown have the converted-text limit every other format has (#250): a file over it fails as too large
// instead of becoming tens of thousands of passages.
func TestTextAndMarkdownAreCapped(t *testing.T) {
	b := NewBuiltin(Limits{MaxMarkdownBytes: 1 << 20}, 1)
	line := []byte("Library hours are extended during finals week.\n")
	big := bytes.Repeat(line, (1<<20)/len(line)+1)
	small := bytes.Repeat(line, (1<<20)/len(line)-1)
	for _, kind := range []Kind{KindText, KindMarkdown} {
		if _, err := b.Parse(context.Background(), Input{Name: "big", Kind: kind, Data: big}); !errors.Is(err, ErrTooLarge) {
			t.Errorf("%s over the limit: %v", kind, err)
		}
		if doc, err := b.Parse(context.Background(), Input{Name: "small", Kind: kind, Data: small}); err != nil || len(doc.Markdown) == 0 {
			t.Errorf("%s under the limit: %v", kind, err)
		}
	}
}
