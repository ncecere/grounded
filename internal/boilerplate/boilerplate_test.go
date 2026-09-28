package boilerplate

import (
	"errors"
	"testing"
)

func TestNormalize(t *testing.T) {
	cases := []struct{ in, want string }{
		{"  Hello   World\n\n", "hello world"},
		{"## QUICKLINKS\n- [Schedule](<https://portal.example.edu/soc/>)", "## quicklinks - [schedule]"},
		{"[Home](/a/b) and [Home](../x \"title\")", "[home] and [home]"},
		{"![Logo](<https://x.example/logo.png>)", "![logo]"},
		{"© 2025 Example, updated 2026-09-01", "© 0 example, updated 0-0-0"},
		{"Page 12 of 340", "page 12 of 340"}, // few letters: the numbers are the content
		{"2026/09/01", "2026/09/01"},         // an article's date
		{"Updated 2026-09-01 by the web team", "updated 0-0-0 by the web team"},
		{"## Step 2 of 3", "## step 2 of 3"},
		{"TAB\tand\u00a0nbsp", "tab and nbsp"},
	}
	for _, c := range cases {
		if got := Normalize(c.in); got != c.want {
			t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestHash(t *testing.T) {
	a := Hash("Footer © 2025 Example University\n[Contact](<https://a.example/contact>)")
	b := Hash("footer   © 2026 example university [Contact](<https://b.example/contact>)")
	if a == 0 || a != b {
		t.Fatalf("equivalent blocks hash differently: %d vs %d", a, b)
	}
	if Hash("## Deadlines") == Hash("### Deadlines") {
		t.Fatal("heading levels must stay distinct")
	}
	if Hash("---") != 0 || Hash("| --- | --- |") != 0 || Hash("   ") != 0 {
		t.Fatal("blocks without letters or digits must hash to 0")
	}
}

func TestThreshold(t *testing.T) {
	e := Effective{Enabled: true, MinDocs: 5, Ratio: 0.3}
	cases := []struct{ docs, want int }{
		{0, 5}, {1, 5}, {10, 5}, {16, 5}, {17, 6}, {20, 6}, {100, 30}, {101, 31}, {200, 60},
	}
	for _, c := range cases {
		if got := e.Threshold(c.docs); got != c.want {
			t.Errorf("Threshold(%d) = %d, want %d", c.docs, got, c.want)
		}
	}
	// Floating point: 0.3 × 10 must be 3, not 4.
	if got := (Effective{MinDocs: 2, Ratio: 0.3}).Threshold(10); got != 3 {
		t.Errorf("Threshold(10) with ratio 0.3 = %d, want 3", got)
	}
	// Never below 2, whatever the settings.
	if got := (Effective{MinDocs: 0, Ratio: 0}).Threshold(100); got != 2 {
		t.Errorf("Threshold floor = %d, want 2", got)
	}
	// Ratio 1: every document.
	if got := (Effective{MinDocs: 2, Ratio: 1}).Threshold(7); got != 7 {
		t.Errorf("ratio 1 = %d, want 7", got)
	}
}

func ptr[T any](v T) *T { return &v }

func TestResolveAndValidate(t *testing.T) {
	d := Defaults{Web: true, Upload: false, MinDocs: 5, Ratio: 0.2}
	if e := d.Resolve("web", Settings{}); !e.Enabled || e.MinDocs != 5 || e.Ratio != 0.2 {
		t.Fatalf("web defaults: %+v", e)
	}
	if e := d.Resolve("upload", Settings{}); e.Enabled {
		t.Fatal("uploads must be off by default")
	}
	e := d.Resolve("upload", Settings{Enabled: ptr(true), MinDocs: ptr(3), Ratio: ptr(0.5)})
	if !e.Enabled || e.MinDocs != 3 || e.Ratio != 0.5 {
		t.Fatalf("overrides: %+v", e)
	}
	for _, bad := range []Settings{{MinDocs: ptr(1)}, {MinDocs: ptr(100001)}, {Ratio: ptr(0.01)}, {Ratio: ptr(1.5)}} {
		if err := bad.Validate(); !errors.Is(err, ErrInvalid) {
			t.Errorf("Validate(%+v) = %v, want ErrInvalid", bad, err)
		}
	}
	if err := (Settings{MinDocs: ptr(2), Ratio: ptr(1.0)}).Validate(); err != nil {
		t.Errorf("bounds are inclusive: %v", err)
	}
}

func TestDrops(t *testing.T) {
	nav, foot, body, head := Hash("- [Home]"), Hash("© Example"), Hash("Real content"), Hash("## Title")
	bp := map[int64]bool{nav: true, foot: true}
	drop := func(h int64) bool { return bp[h] }

	got, guarded := Drops([]Block{{nav, false}, {head, true}, {body, false}, {foot, false}, {nav, false}}, drop)
	if guarded || len(got) != 2 || got[0] != nav || got[1] != foot {
		t.Fatalf("Drops = %v guarded=%v, want [nav foot] (distinct)", got, guarded)
	}

	// Only-content guard: nothing but boilerplate (and a heading) remains.
	got, guarded = Drops([]Block{{head, true}, {nav, false}, {foot, false}}, drop)
	if !guarded || got != nil {
		t.Fatalf("only-content guard: got %v guarded=%v", got, guarded)
	}

	// A separator (hash 0) is not content.
	got, guarded = Drops([]Block{{nav, false}, {0, false}}, drop)
	if !guarded || got != nil {
		t.Fatalf("separator is not content: got %v guarded=%v", got, guarded)
	}

	// Nothing repeated: nothing dropped, not guarded.
	if got, guarded = Drops([]Block{{body, false}}, drop); got != nil || guarded {
		t.Fatalf("no boilerplate: got %v guarded=%v", got, guarded)
	}
}

func TestSample(t *testing.T) {
	cases := []struct{ in, want string }{
		{"## QUICKLINKS", "QUICKLINKS"},
		{"- [Schedule of Courses](<https://one.example.edu/soc/>)\n- [Dates](<https://x/>)", "Schedule of Courses Dates"},
		{"![Product shot](<https://x/cta.svg>) **Start** `free`", "Image: Product shot Start free"},
	}
	for _, c := range cases {
		if got := Sample(c.in); got != c.want {
			t.Errorf("Sample(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	long := Sample(string(make([]rune, 500)) + "é")
	if n := len([]rune(long)); n > SampleLen {
		t.Errorf("sample has %d runes", n)
	}
}

func TestHashes(t *testing.T) {
	got := Hashes([]Block{{1, false}, {0, false}, {2, true}, {1, false}})
	if len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("Hashes = %v", got)
	}
}
