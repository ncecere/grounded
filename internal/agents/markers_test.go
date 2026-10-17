package agents

import (
	"reflect"
	"slices"
	"strings"
	"testing"
)

// evidenceAnswer is a real answer (Qwen, arrays vs slices in Go) whose
// inline code `[3]int` was read as citation 3, and whose trailing citation
// list was judged as a claim.
const evidenceAnswer = "In Go, arrays and slices behave differently [1].\n\n" +
	"* Arrays have a fixed length [2]. The size is part of the type (e.g., `[3]int` and `[4]int` are distinct types) [2].\n" +
	"* Arrays are values: assigning one array to another copies all the elements [1][2].\n" +
	"* A slice describes a section of an underlying array [2].\n\n" +
	"For C-like behavior with arrays, you can pass a pointer to the array, but using slices is considered more idiomatic [5].\n\n" +
	"Citations: [1], [2], [5]"

// markerTexts is each marker of text as written, without its lead.
func markerTexts(text string) []string {
	out := []string{}
	for _, m := range findMarkers(text) {
		out = append(out, text[m.At:m.End])
	}
	return out
}

func TestFindMarkers(t *testing.T) {
	cases := []struct {
		name, text string
		want       []string
	}{
		{"inline code", "Use `[3]int` or `[4]int`, not a slice [1].", []string{"[1]"}},
		{"inline code with two backticks", "Write ``a `[2]` b`` here [1].", []string{"[1]"}},
		{"inline code over a line break", "Write `x\n[2]` here [1].", []string{"[1]"}},
		{"unclosed backtick is literal", "A lone ` tick [1].", []string{"[1]"}},
		{"escaped backtick is literal", "Not \\`code [1]`.", []string{"[1]"}},
		{"fenced code", "Declare it:\n\n```go\nvar a [3]int // [2]\n```\n\nDone [1].", []string{"[1]"}},
		{"tilde fence in a list", "- Item [1]\n  ~~~\n  x [2]\n  ~~~\n- Next [3]", []string{"[1]", "[3]"}},
		{"unclosed fence runs to the end", "Text [1].\n```\ncode [2]", []string{"[1]"}},
		{"longer fence closes only on its length", "````\n```\n[2]\n````\nAfter [1]", []string{"[1]"}},
		{"indented code", "Example:\n\n    arr [2] = 1\n\tb [3]\n\nDone [1].", []string{"[1]"}},
		{"indented continuation is prose", "Fees apply\n    to everyone [1].", []string{"[1]"}},
		{"indented list content is prose", "- Item one [1]\n\n    More about it [2].", []string{"[1]", "[2]"}},
		{"Markdown link", "See [1](https://example.edu) and the fee [2].", []string{"[2]"}},
		{"reference-style link", "See [the page][1] for fees [2].", []string{"[2]"}},
		{"footnote", "A claim[^1] and another [1].", []string{"[1]"}},
		{"array index", "Set a[3] = 1 and arr_2[0] too [1].", []string{"[1]"}},
		{"two-dimensional index", "Both m[i][2] and a[1][2] work [3].", []string{"[3]"}},
		{"type after the brackets", "[3]int is an array type [1].", []string{"[1]"}},
		{"adjacent markers", "Fees apply [1][2].", []string{"[1]", "[2]"}},
		{"group", "Fees apply [1, 2] and [3,4].", []string{"[1, 2]", "[3,4]"}},
		{"line ends", "Fees apply [1]\nMore text [2]", []string{"[1]", "[2]"}},
		{"after punctuation", "Fees apply.[1] Next (see below)[2]. Quote\"[3]", []string{"[1]", "[2]", "[3]"}},
		{"after emphasis and code", "**Fees**[1] and `code`[2]", []string{"[1]", "[2]"}},
		{"line start", "[1] Fees apply.", []string{"[1]"}},
		{"not an identifier outside ASCII", "Il y a un café[1] et 日本語[2]。", []string{"[1]", "[2]"}},
		{"lenticular and fullwidth", "Submit online【2】 or 【3†L1-L2】 or 登録［1］。", []string{"【2】", "【3†L1-L2】", "［1］"}},
		{"evidence", evidenceAnswer, []string{"[1]", "[2]", "[2]", "[1]", "[2]", "[2]", "[5]", "[1]", "[2]", "[5]"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := markerTexts(c.text); !reflect.DeepEqual(got, c.want) {
				t.Errorf("markers = %q, want %q", got, c.want)
			}
		})
	}
}

func TestApplyCitationsLeavesCode(t *testing.T) {
	src := hits(5)
	for _, tc := range []struct {
		in, want string
		cited    []int
	}{
		{"Types like `[3]int` and `[4]int` differ [1].", "Types like `[3]int` and `[4]int` differ [1].", []int{1}},
		{"```\nx [2]\n```\nDone [9].", "```\nx [2]\n```\nDone.", nil},
		{"Set a[3] = 1 [1].", "Set a[3] = 1 [1].", []int{1}},
		{"See [3](https://x.edu) [2].", "See [3](https://x.edu) [2].", []int{2}},
		// A removed marker's space moves to the kept one after it.
		{"Fees apply [9][2].", "Fees apply [2].", []int{2}},
		// Normalised markers keep reading as markers.
		{"Submit online【2】and pay【3】.", "Submit online [2] and pay [3].", []int{2, 3}},
	} {
		text, cites := applyCitations(tc.in, src, CitationSnippet)
		var got []int
		for _, c := range cites {
			got = append(got, c.N)
		}
		if text != tc.want || !reflect.DeepEqual(got, tc.cited) {
			t.Errorf("%q → %q %v, want %q %v", tc.in, text, got, tc.want, tc.cited)
		}
	}

	// The evidence answer: the inline code stays, [3] is no citation.
	text, cites := applyCitations(evidenceAnswer, src, CitationSnippet)
	if text != evidenceAnswer || !strings.Contains(text, "`[3]int` and `[4]int`") {
		t.Errorf("evidence text changed:\n%s", text)
	}
	var ns []int
	for _, c := range cites {
		ns = append(ns, c.N)
	}
	if !reflect.DeepEqual(ns, []int{1, 2, 5}) {
		t.Errorf("evidence citations = %v, want [1 2 5]", ns)
	}
	// Mode none removes markers only.
	if text, _ := applyCitations(evidenceAnswer, src, CitationNone); !strings.Contains(text, "`[3]int` and `[4]int`") ||
		strings.Contains(text, "[1]") || strings.Contains(text, "[5]") {
		t.Errorf("none mode = %q", text)
	}
}

func TestIsRefusalIgnoresOnlyMarkers(t *testing.T) {
	if isRefusal("See `[1]`", "See") || !isRefusal("No answer [1].", "No answer.") {
		t.Error("isRefusal")
	}
}

// The exported readers (used by cmd/sparkbench) follow findMarkers: code
// and array indices are not citations.
func TestExportedMarkerReaders(t *testing.T) {
	text := "Fees are due [1, 2]. See `a[3]` and arr[4]; parking【5†L1-L2】."
	if got, want := CitedNumbers(text), []int{1, 2, 5}; !reflect.DeepEqual(got, want) {
		t.Errorf("CitedNumbers = %v, want %v", got, want)
	}
	if got, want := RemoveMarkers(text), "Fees are due. See `a[3]` and arr[4]; parking."; got != want {
		t.Errorf("RemoveMarkers = %q, want %q", got, want)
	}
	if !IsRefusal("I don't know [1].", "I don't know.") {
		t.Error("IsRefusal ignores markers")
	}
}

// A code span never crosses into another list item (CommonMark: each item is its own block). A passage quoted into a bullet and cut off in the
// middle of a code span left a backtick open, which paired with one in a later bullet and turned the markers between them into "code": answers
// showed plain "[1]" and "[2]" beside a chip numbered 1 that was really source 3 (QA pass v0.6.0, #122).
func TestMarkersAfterAnOpenBacktickInAListItem(t *testing.T) {
	text := "The closest passages I found:\n\n" +
		"- **Workspaces**: The ` go ` command has subcommands such as ` go work init ` and ` go work use [-r] [dir] ` adds a ` use ` directive to the ` … [1]\n" +
		"- **PGO**: PGO can result in slightly larger binaries due to additional function inlining. [2]\n" +
		"- **Docs**: This doc shows how to use the ` go ` command to build and test packages. [3]"
	if got := CitedNumbers(text); !slices.Equal(got, []int{1, 2, 3}) {
		t.Fatalf("CitedNumbers = %v, want [1 2 3]", got)
	}
	sources := []numberedHit{{N: 1}, {N: 2}, {N: 3}}
	out, cites := applyCitations(text, sources, CitationSnippet)
	if len(cites) != 3 || out != text {
		t.Errorf("applyCitations kept %d citations, text changed: %v", len(cites), out != text)
	}

	// What stays code: a span inside one item (even across a soft-wrapped line), and a span in a paragraph.
	for name, in := range map[string]string{
		"a span wrapped inside one item": "- uses `go\n  [1]` here\n- next [2]",
		"a span in a paragraph":          "Use `a [1] b` for it. [2]",
		"an open fence runs to the end":  "- item [1]\n```\n[2]\n",
	} {
		got := CitedNumbers(in)
		want := map[string][]int{"a span wrapped inside one item": {2}, "a span in a paragraph": {2}, "an open fence runs to the end": {1}}[name]
		if !slices.Equal(got, want) {
			t.Errorf("%s: CitedNumbers(%q) = %v, want %v", name, in, got, want)
		}
	}
}
