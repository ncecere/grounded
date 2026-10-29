package sources

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestHiddenFilenameRejectedBeforeReadingOrStoring(t *testing.T) {
	// No service, database or body: unsafe filenames must fail before any of
	// them are used, including when called outside the multipart HTTP handler.
	u := &Uploader{}
	for _, name := range []string{"bad\x1b.txt", "bad\x00.txt", "bad\u202e.txt", "bad\u200b.txt", "bad\u200d.txt", "\ufeffbad.txt", "\tbad.txt", "folder\u202e/ok.txt"} {
		result, err := u.Upload(context.Background(), name, nil, "text/plain")
		if err != nil || result.Status != "rejected" || result.Error == nil || result.Error.Code != "invalid_filename" {
			t.Fatalf("Upload(%q) = %+v, %v", name, result, err)
		}
	}
	if got := cleanFilename(`C:\folder\Résumé.txt`); got != "Résumé.txt" {
		t.Fatalf("ordinary basename = %q", got)
	}
}

func TestCleanFilenameKeepsUnicodeBoundariesAndBoundsExtensions(t *testing.T) {
	name := cleanFilename(strings.Repeat("界", 100) + ".txt")
	if !utf8.ValidString(name) || len(name) > 255 || !strings.HasSuffix(name, ".txt") {
		t.Fatalf("invalid truncated Unicode filename: %q", name)
	}
	if name := cleanFilename("file." + strings.Repeat("x", 300)); name != "" {
		t.Fatalf("unrepresentable extension was accepted: %q", name)
	}
}

func TestSourceProfileDoesNotRequireLegacyRename(t *testing.T) {
	// Normal-length legacy display names remain readable and can have unrelated
	// settings changed; an explicitly submitted new name is validated.
	name := "Legacy\u202ename"
	description := strings.Repeat("x", 10)
	cur := dbgen.DataSource{Name: name}
	if got, err := textAndStatus(cur, UpdateInput{Description: &description}); err != nil || got.Name != name {
		t.Fatalf("unrelated update = %+v, %v", got, err)
	}
	if _, err := textAndStatus(cur, UpdateInput{Name: &name}); err == nil {
		t.Fatal("an explicitly submitted unsafe name was accepted")
	}
}
