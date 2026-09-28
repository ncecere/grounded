package httpapi

import (
	"strings"
	"testing"
)

// P-06: parser errors are shown as sentences people can act on; the
// parser's text stays available as the detail.
func TestDocumentErrorIsFriendly(t *testing.T) {
	raw := "document is damaged or not the format its name suggests: 3: incorrect format"
	msg, detail := documentError("corrupt", raw, "", "Forms/broken.PDF")
	if !strings.HasPrefix(msg, "This PDF appears to be damaged or password-protected") || detail != raw {
		t.Errorf("corrupt pdf = %q / %q", msg, detail)
	}
	if msg, _ := documentError("encrypted", "document is password-protected", "docx", ""); !strings.HasPrefix(msg, "This DOCX is password-protected") {
		t.Errorf("encrypted = %q", msg)
	}
	if msg, _ := documentError("empty", "document contains no text", "markdown", "a.md"); msg != "This file contains no text." {
		t.Errorf("empty markdown = %q", msg)
	}
	// Messages already written for people are kept, with no detail.
	kept := "The embedding model or its connection is disabled. Ask a platform admin, then retry."
	if msg, detail := documentError("profile_unusable", kept, "pdf", ""); msg != kept || detail != "" {
		t.Errorf("kept = %q / %q", msg, detail)
	}
	if msg, detail := documentError("", "", "pdf", ""); msg != "" || detail != "" {
		t.Errorf("no error = %q / %q", msg, detail)
	}
}
