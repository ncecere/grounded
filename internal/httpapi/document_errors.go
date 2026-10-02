package httpapi

import (
	"path"
	"strings"
)

// Friendly document errors (docs/ui-review P-06). Ingestion stores the
// parser's own text (internal/parse wraps its sentinel errors with detail
// such as "document is damaged…: 3: incorrect format"); the API shows a
// sentence people can act on and keeps the technical text in errorDetail,
// shown on demand. Codes not listed keep their stored message (those are
// already written for people, e.g. profile_unusable).

// friendlyDocumentErrors maps error codes to messages; "{kind}" is the
// document's kind in capitals (PDF, DOCX), or "file".
var friendlyDocumentErrors = map[string]string{
	"corrupt":            "This {kind} appears to be damaged or password-protected, or isn't the format its name suggests. Try saving or exporting it again, then upload it again.",
	"encrypted":          "This {kind} is password-protected. Remove the password, then upload it again.",
	"unsupported_format": "This file type isn't supported. Upload PDF, Word (DOCX), PowerPoint (PPTX), HTML, Markdown or plain text, or PNG, JPEG or TIFF images when OCR is on.",
	"too_large":          "This {kind} is too large to process. Split it into smaller files.",
	"needs_ocr":          "This {kind} has no text to read (it may be a scan), and OCR is off for it. Once OCR is on for this source, retry it.",
	"empty":              "This {kind} contains no text.",
}

// documentError returns the message to show and the technical detail (""
// when the message is the stored one). Documents that failed before their
// kind was known are named by their file extension. A ready document's
// message is already for people (a partly scanned PDF's pages that need
// OCR, written by ingestion).
func documentError(status, code, message, kind, filename string) (friendly, detail string) {
	tmpl, ok := friendlyDocumentErrors[code]
	if !ok || code == "" || status == "ready" {
		return message, ""
	}
	if kind == "" {
		kind = strings.TrimPrefix(strings.ToLower(path.Ext(filename)), ".")
	}
	k := "file"
	switch kind {
	case "pdf", "docx", "pptx":
		k = strings.ToUpper(kind)
	case "image", "png", "jpg", "jpeg", "tif", "tiff":
		k = "image"
	}
	friendly = strings.ReplaceAll(tmpl, "{kind}", k)
	if message == friendly {
		return friendly, ""
	}
	return friendly, message
}
