package ingest

import (
	"context"
	"testing"

	"github.com/ncecere/grounded/internal/parse"
)

// A web page without a title of its own is named after its decoded URL,
// not its percent-encoded path (VI-10).
func TestWebPageNameDecodesTheURL(t *testing.T) {
	raw := "https://go.dev/doc/codewalk/?fileprint=/doc%2Fcodewalk%2Fpig.go&hi=121&lo=110"
	if got := webPageName(raw); got != "https://go.dev/doc/codewalk/?fileprint=/doc/codewalk/pig.go&hi=121&lo=110" {
		t.Fatalf("webPageName = %q", got)
	}
	if got := webPageName("https://example.edu/a%zz"); got != "https://example.edu/a%zz" {
		t.Errorf("undecodable URL = %q", got)
	}
	doc, err := parse.NewBuiltin(parse.Limits{}, 1).Parse(context.Background(), parse.Input{
		Name: webPageName(raw), Kind: parse.KindText, Data: []byte("package main\n"), WebPage: true, BaseURL: raw,
	})
	if err != nil || doc.Title != "pig" {
		t.Errorf("title = %q, %v", doc.Title, err)
	}
}
