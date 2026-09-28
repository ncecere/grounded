package parse

import (
	"bytes"
	"path"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/unicode"
)

// decodeText returns UTF-8 text from UTF-8 (with or without BOM), UTF-16
// with a BOM, or Windows-1252 (the usual encoding of legacy .txt files).
func decodeText(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte{0xEF, 0xBB, 0xBF}):
		b = b[3:]
	case hasUTF16BOM(b):
		if out, err := unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder().Bytes(b); err == nil {
			return string(out)
		}
	}
	if utf8.Valid(b) {
		return string(b)
	}
	if out, err := charmap.Windows1252.NewDecoder().Bytes(b); err == nil {
		return string(out)
	}
	return strings.ToValidUTF8(string(b), "\uFFFD")
}

// titleFromName turns "Fall_2026-catalog.pdf" into "Fall 2026 catalog".
func titleFromName(name string) string {
	base := path.Base(strings.ReplaceAll(name, "\\", "/"))
	base = strings.TrimSuffix(base, path.Ext(base))
	base = strings.NewReplacer("_", " ", "-", " ").Replace(base)
	return strings.Join(strings.Fields(base), " ")
}

// firstHeading returns the text of the first Markdown heading, if any.
func firstHeading(md string) string {
	for _, line := range strings.Split(md, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "#") {
			if h := strings.TrimSpace(strings.TrimLeft(t, "#")); h != "" {
				return h
			}
		}
	}
	return ""
}

func parseMarkdown(in Input) (Document, error) {
	md := cleanMarkdown(decodeText(in.Data))
	title := firstHeading(md)
	if title == "" {
		title = titleFromName(in.Name)
	}
	return Document{Title: title, Markdown: md, Parser: "builtin:markdown"}, nil
}

// parseText keeps plain text as-is. Lines that look like Markdown syntax are
// harmless to the chunker, so no escaping is done.
func parseText(in Input) (Document, error) {
	return Document{Title: titleFromName(in.Name), Markdown: cleanMarkdown(decodeText(in.Data)), Parser: "builtin:text"}, nil
}
