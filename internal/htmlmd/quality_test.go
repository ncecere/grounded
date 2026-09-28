package htmlmd

import (
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// The quality corpus is ported from yoink's testdata/quality/v1: original
// synthetic HTML with audited Markdown references. Expectations are adapted to
// this package's API: links are those of the selected content, not the whole
// page, and JSON-LD/Open Graph details are not extracted.
const qualityRoot = "testdata/quality"

type qualityCase struct {
	name                                   string
	anchors, noise, links, structure, code []string
	title, language                        string
}

var qualityCases = []qualityCase{
	{name: "documentation", title: "documentation", language: "en",
		anchors:   []string{"# Install the pebble tool", "local configuration"},
		noise:     []string{"NOISE_NAV", "NOISE_SIDE"},
		links:     []string{"https://quality.invalid/guide"},
		structure: []string{"[Read the guide](<https://quality.invalid/guide>)"}},
	{name: "linkedtables", title: "linkedtables", language: "en",
		anchors:   []string{"Component matrix", "Stone", "second line"},
		noise:     []string{"NOISE_FOOT"},
		links:     []string{"https://quality.invalid/stone"},
		structure: []string{"[Stone](<https://quality.invalid/stone>)", "*small*", "` a\\|b `", "<br>second line", "| --- | --- |"}},
	{name: "codewhitespace", title: "codewhitespace", language: "en",
		anchors:   []string{"Literal sample", "first", "last", "End of sample."},
		links:     []string{},
		structure: []string{"``````txt\n\n  first  \n\n\n```\n`````\n  last\t\n\n\n``````"},
		code:      []string{"\n  first  \n\n\n```\n`````\n  last\t\n\n"}},
	{name: "articleheader", title: "articleheader", language: "en",
		anchors: []string{"A field report", "By Avery Writer", "new leaves"},
		noise:   []string{"NOISE_BANNER", "NOISE_COOKIE", "UNSUPPORTED"},
		links:   []string{}},
	{name: "siblingforum", title: "siblingforum", language: "en",
		anchors:   []string{"Garden questions", "First gardener", "Second gardener", "Check the soil"},
		noise:     []string{"NOISE_NAV", "NOISE_SIDE"},
		links:     []string{},
		structure: []string{"# Garden questions", "## First gardener", "## Second gardener"}},
	{name: "catalog", title: "catalog", language: "en",
		anchors:   []string{"Pocket catalog", "Red pebble", "Blue pebble"},
		noise:     []string{"NOISE_NAV", "NOISE_SIDE"},
		links:     []string{"https://quality.invalid/red", "https://quality.invalid/blue"},
		structure: []string{"## [Red pebble](<https://quality.invalid/red>)", "## [Blue pebble](<https://quality.invalid/blue>)"}},
	{name: "multilingual", title: "multilingual", language: "ja",
		anchors: []string{"庭の観察", "小さな葉", "مرحبا بالحديقة", "Café et lumière"},
		noise:   []string{"NOISE_NAV", "NOISE_SIDE"},
		links:   []string{}},
	{name: "malformedHTML", title: "malformedHTML", language: "en",
		anchors:   []string{"Recovered notes", "bold words", "Another note"},
		noise:     []string{"NOISE_NAV", "NOISE_SCRIPT"},
		links:     []string{"https://quality.invalid/next"},
		structure: []string{"**bold words**", "[continues](<https://quality.invalid/next>)"}},
	{name: "negative", title: "negative", language: "en",
		anchors: []string{"Safe sample", "Visible words.", "Safe label"},
		noise:   []string{"NOISE_NAV", "UNSUPPORTED", "javascript:", "never-fetch", "bad()"},
		links:   []string{}},
	{name: "large", title: "Large metadata",
		anchors: []string{"Large metadata specimen", "oversized structured metadata"},
		noise:   []string{"NOISE_NAV", "qqqq"},
		links:   []string{}},
}

func TestQualityCorpus(t *testing.T) {
	base, _ := url.Parse("https://quality.invalid/source")
	for _, c := range qualityCases {
		t.Run(c.name, func(t *testing.T) {
			input, err := os.ReadFile(filepath.Join(qualityRoot, c.name+".html"))
			if err != nil {
				t.Fatal(err)
			}
			res, err := Convert(input, Options{BaseURL: base, MainContentOnly: true})
			if err != nil {
				t.Fatal(err)
			}
			md := res.Markdown
			for _, s := range c.anchors {
				if !strings.Contains(md, s) {
					t.Errorf("missing essential anchor %q", s)
				}
			}
			for _, s := range c.noise {
				if strings.Contains(md, s) {
					t.Errorf("known noise %q", s)
				}
			}
			for _, s := range c.structure {
				if !strings.Contains(md, s) {
					t.Errorf("missing Markdown structure %q", s)
				}
			}
			for _, s := range c.code {
				if !strings.Contains(md, s) {
					t.Errorf("code whitespace changed: %q", s)
				}
			}
			if !reflect.DeepEqual(res.Links, c.links) {
				t.Errorf("links: got %#v want %#v", res.Links, c.links)
			}
			if res.Title != c.title || res.Language != c.language {
				t.Errorf("metadata: title=%q lang=%q", res.Title, res.Language)
			}
			// References pin content and order; ignore only ordinary prose layout
			// (code whitespace is separately byte-exact above).
			ref, err := os.ReadFile(filepath.Join(qualityRoot, c.name+".md"))
			if err != nil {
				t.Fatal(err)
			}
			if cleanSpace(md) != cleanSpace(string(ref)) {
				t.Errorf("audited reference differs\nGOT: %q\nREF: %q", md, ref)
			}
			assertWellFormed(t, md)
		})
	}
}

func BenchmarkQualityCorpus(b *testing.B) {
	base, _ := url.Parse("https://quality.invalid/source")
	for _, c := range qualityCases {
		b.Run(c.name, func(b *testing.B) {
			input, err := os.ReadFile(filepath.Join(qualityRoot, c.name+".html"))
			if err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.SetBytes(int64(len(input)))
			for b.Loop() {
				if _, err := Convert(input, Options{BaseURL: base, MainContentOnly: true}); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// assertWellFormed checks the Markdown output contract.
func assertWellFormed(t *testing.T, md string) {
	t.Helper()
	if md == "" {
		return
	}
	if !strings.HasSuffix(md, "\n") || strings.HasSuffix(md, "\n\n") {
		t.Errorf("markdown must end with exactly one newline: %q", md)
	}
	if strings.HasPrefix(md, "\n") || strings.HasPrefix(md, " ") {
		t.Errorf("markdown has leading blank space: %q", md)
	}
}
