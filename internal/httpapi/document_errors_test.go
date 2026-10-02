package httpapi

import (
	"strings"
	"testing"
)

// P-06: parser errors are shown as sentences people can act on; the
// parser's text stays available as the detail.
func TestDocumentErrorIsFriendly(t *testing.T) {
	raw := "document is damaged or not the format its name suggests: 3: incorrect format"
	msg, detail := documentError("failed", "corrupt", raw, "", "Forms/broken.PDF")
	if !strings.HasPrefix(msg, "This PDF appears to be damaged or password-protected") || detail != raw {
		t.Errorf("corrupt pdf = %q / %q", msg, detail)
	}
	if msg, _ := documentError("failed", "encrypted", "document is password-protected", "docx", ""); !strings.HasPrefix(msg, "This DOCX is password-protected") {
		t.Errorf("encrypted = %q", msg)
	}
	if msg, _ := documentError("failed", "empty", "document contains no text", "markdown", "a.md"); msg != "This file contains no text." {
		t.Errorf("empty markdown = %q", msg)
	}
	if msg, _ := documentError("failed", "needs_ocr", "no text", "", "scan.png"); msg != "This image has no text to read (it may be a scan), and OCR is off for it. Once OCR is on for this source, retry it." {
		t.Errorf("needs_ocr image = %q", msg)
	}
	// Messages already written for people are kept, with no detail.
	kept := "The embedding model or its connection is disabled. Ask a platform admin, then retry."
	if msg, detail := documentError("failed", "profile_unusable", kept, "pdf", ""); msg != kept || detail != "" {
		t.Errorf("kept = %q / %q", msg, detail)
	}
	if msg, detail := documentError("failed", "", "", "pdf", ""); msg != "" || detail != "" {
		t.Errorf("no error = %q / %q", msg, detail)
	}
	// A partly scanned PDF is ready: its message (the pages that need OCR) is kept.
	pages := "Page 2 has no text layer (it may be a scan) and wasn't read, because OCR is off for this document."
	if msg, detail := documentError("ready", "needs_ocr", pages, "pdf", ""); msg != pages || detail != "" {
		t.Errorf("partly scanned = %q / %q", msg, detail)
	}
}
