package evals

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestParseExpected(t *testing.T) {
	id := uuid.MustParse("5f0c2c1e-4d7a-4a8e-9a57-0d0e1f2a3b4c")
	e, err := ParseExpected(" " + id.String() + " | https://example.edu/registrar/transcripts* | https://example.edu/fees/ | handbook.pdf | Handbook.PDF ")
	if err != nil {
		t.Fatal(err)
	}
	if len(e.DocumentIDs) != 1 || e.DocumentIDs[0] != id {
		t.Errorf("documents = %v", e.DocumentIDs)
	}
	if strings.Join(e.URLs, ",") != "https://example.edu/registrar/transcripts*,https://example.edu/fees/" {
		t.Errorf("urls = %v", e.URLs)
	}
	if strings.Join(e.Filenames, ",") != "handbook.pdf" { // the same name twice (case aside) is one
		t.Errorf("filenames = %v", e.Filenames)
	}
	if got := e.String(); got != id.String()+" | https://example.edu/registrar/transcripts* | https://example.edu/fees/ | handbook.pdf" {
		t.Errorf("String = %q", got)
	}
	var many []string
	for i := range 21 {
		many = append(many, strings.Repeat("a", i+1)+".pdf")
	}
	for _, bad := range []string{"", " | ", "https://", "https://example.edu/a*b", "ftp://example.edu/x", "docs/handbook.pdf", strings.Join(many, "|")} {
		if _, err := ParseExpected(bad); err == nil {
			t.Errorf("ParseExpected(%q) accepted", bad)
		}
	}
}

func TestMatches(t *testing.T) {
	id := uuid.New()
	e := Expected{DocumentIDs: []uuid.UUID{id}, URLs: []string{"https://example.edu/registrar/transcripts*", "https://example.edu/fees/"},
		Filenames: []string{"Handbook.pdf"}}
	cases := []struct {
		name string
		d    Doc
		want bool
	}{
		{"document", Doc{DocumentID: id}, true},
		{"another document", Doc{DocumentID: uuid.New()}, false},
		{"prefix", Doc{DocumentID: uuid.New(), URL: "https://example.edu/registrar/transcripts/order"}, true},
		{"prefix itself", Doc{DocumentID: uuid.New(), URL: "https://example.edu/registrar/transcripts"}, true},
		{"outside the prefix", Doc{DocumentID: uuid.New(), URL: "https://example.edu/registrar/"}, false},
		{"exact without the slash", Doc{DocumentID: uuid.New(), URL: "https://example.edu/fees"}, true},
		{"exact is not a prefix", Doc{DocumentID: uuid.New(), URL: "https://example.edu/fees/parking"}, false},
		{"filename case aside", Doc{DocumentID: uuid.New(), Filename: "handbook.PDF"}, true},
		{"other filename", Doc{DocumentID: uuid.New(), Filename: "handbook-2024.pdf"}, false},
		{"empty", Doc{}, false},
	}
	for _, c := range cases {
		if got := e.Matches(c.d); got != c.want {
			t.Errorf("%s: Matches = %v, want %v", c.name, got, c.want)
		}
	}
	docs := []Doc{{DocumentID: uuid.New()}, {DocumentID: uuid.New(), URL: "https://example.edu/other"}, {DocumentID: id}, {DocumentID: id}}
	if r := e.Rank(docs); r != 3 {
		t.Errorf("Rank = %d, want 3", r)
	}
	if r := e.Rank(docs[:2]); r != 0 {
		t.Errorf("Rank without it = %d", r)
	}
}

func TestExistence(t *testing.T) {
	e := Expected{URLs: []string{"https://example.edu/a/", "https://example.edu/b*"}, Filenames: []string{"Guide.PDF"}}
	docs, urls, prefixes, names := e.existence()
	if len(docs) != 0 || strings.Join(urls, ",") != "https://example.edu/a" || strings.Join(prefixes, ",") != "https://example.edu/b" ||
		strings.Join(names, ",") != "guide.pdf" {
		t.Errorf("existence = %v %v %v %v", docs, urls, prefixes, names)
	}
}

func TestNormalizePhrases(t *testing.T) {
	p, err := NormalizePhrases([]string{"  office   hours ", "Office Hours", "", "room 101"})
	if err != nil || strings.Join(p, ",") != "office hours,room 101" {
		t.Errorf("phrases = %v %v", p, err)
	}
	if _, err := NormalizePhrases([]string{strings.Repeat("x", 201)}); err == nil {
		t.Error("a long phrase was accepted")
	}
	many := make([]string, 21)
	for i := range many {
		many[i] = strings.Repeat("p", i+1)
	}
	if _, err := NormalizePhrases(many); err == nil {
		t.Error("21 phrases were accepted")
	}
}
