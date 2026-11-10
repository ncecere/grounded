package parse

import (
	"context"
	"strings"
	"testing"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/unicode"
)

// An HTML page is read in the character set it declares, whatever that is: not as windows-1252 first.
func TestHTMLIsReadInItsDeclaredCharset(t *testing.T) {
	cases := []struct {
		name, charset, text string
		enc                 encoding.Encoding
	}{
		{"windows-1251", "windows-1251", "Расписание занятий на осенний семестр", charmap.Windows1251},
		{"iso-8859-2", "iso-8859-2", "Zápis do zimního semestru začíná v září", charmap.ISO8859_2},
		{"shift_jis", "shift_jis", "履修登録は九月に始まります", japanese.ShiftJIS},
		{"windows-1252", "windows-1252", "L’inscription d’été commence bientôt", charmap.Windows1252},
		{"utf-8", "utf-8", "L’inscription d’été commence bientôt", unicode.UTF8},
	}
	p := NewBuiltin(Limits{}, 1)
	defer p.Close()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			page := `<!doctype html><html><head><meta charset="` + c.charset + `"><title>T</title></head><body><h1>Registrar</h1><p>` + c.text + `</p></body></html>`
			raw, err := c.enc.NewEncoder().Bytes([]byte(page))
			if err != nil {
				t.Fatal(err)
			}
			doc, err := p.Parse(context.Background(), Input{Name: "page.html", Kind: KindHTML, Data: raw})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(doc.Markdown, c.text) {
				t.Fatalf("the text was not read as %s:\n%s", c.charset, doc.Markdown)
			}
		})
	}
}
