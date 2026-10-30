package boilerplate

import (
	"encoding/hex"
	"fmt"
	"math/rand"
	"strings"
	"testing"
)

// menu is a navigation list with item i highlighted: in bold, or with a marker.
func menu(i int, marker bool) string {
	items := []string{"Home", "Admissions", "Academics", "Registrar", "Student life", "Contact us", "Libraries", "Athletics", "Research", "Giving", "Alumni", "Campus map"}
	var b strings.Builder
	for j, it := range items {
		link := fmt.Sprintf("[%s](/%s)", it, strings.ToLower(strings.ReplaceAll(it, " ", "-")))
		if j == i {
			if marker {
				link += " (current page)"
			} else {
				link = "**" + link + "**"
			}
		}
		b.WriteString("- " + link + "\n")
	}
	return b.String()
}

func sketch(t *testing.T, text string) Sketch {
	t.Helper()
	s, ok := SketchOf(text)
	if !ok {
		t.Fatalf("not eligible: %q", text)
	}
	return s
}

func TestSketchIsPinned(t *testing.T) {
	// The sketch is stored: changing the algorithm changes what is recorded, so SketchVersion must move with it.
	got := hex.EncodeToString(sketch(t, "Last updated March 3, 2026 by the Office of the Test Registrar, 101 Main Hall.").bytes())
	if SketchVersion != 1 {
		t.Fatalf("SketchVersion = %d: update the pinned sketch with it", SketchVersion)
	}
	if want := "85c531a97b1bdacfa8ef5b989ffdfd4ec0627660dddbff9fcc0ab67f8169c589"; got != want {
		t.Errorf("the sketch of a fixed text changed; if on purpose, bump SketchVersion and update this test\n got %s", got)
	}
}

func TestNearDuplicatesMatch(t *testing.T) {
	cases := []struct {
		name string
		a, b string
	}{
		{"a different highlighted item (bold)", menu(0, false), menu(3, false)},
		{"bold against no highlight", menu(2, false), menu(-1, false)},
		{"a marker word against none", menu(4, true), menu(-1, false)},
		{"a changed date in a footer", "Last updated March 3, 2026 by the Office of the Test Registrar, 101 Main Hall, 555-0100.", "Last updated October 17, 2025 by the Office of the Test Registrar, 101 Main Hall, 555-0100."},
		{"dates with weekdays and ordinals", "Posted Monday, 3rd of June 2024 by the web team of the Office of Test Registrar.", "Posted Friday, 21st of Nov 2025 by the web team of the Office of Test Registrar."},
		{"one changed word in a long block", "Students who need help with the registration process should contact the Office of the Test Registrar in Main Hall during regular business hours or send an email to the help desk.", "Students who need help with the enrollment process should contact the Office of the Test Registrar in Main Hall during regular business hours or send an email to the help desk."},
		{"case and spacing", "Questions about transcripts?  CONTACT the office of the registrar in main hall during regular business hours.", "questions about transcripts? contact the office of the registrar in main hall during regular business hours."},
	}
	for _, c := range cases {
		if !Similar(sketch(t, c.a), sketch(t, c.b)) {
			t.Errorf("%s: not matched", c.name)
		}
	}
}

func TestDifferentBlocksDoNotMatch(t *testing.T) {
	cases := []struct {
		name string
		a, b string
	}{
		{"the same words in another sentence",
			"Students may petition the dean to drop a course after the published deadline when a documented emergency prevented earlier action.",
			"After the published deadline a documented emergency allows the dean to drop a course when students petition and earlier action was prevented."},
		{"shared vocabulary, another subject",
			"Official transcripts are ordered online and usually mailed within three business days when the account carries no hold.",
			"A hold on the account prevents the registrar from mailing official transcripts even when the student orders them online."},
		{"a reordered menu is another block (word order counts)",
			"- Home\n- Admissions\n- Academics\n- Registrar\n- Student life\n- Contact us\n- Libraries\n- Athletics",
			"- Athletics\n- Libraries\n- Contact us\n- Student life\n- Registrar\n- Academics\n- Admissions\n- Home"},
		{"a template with a different subject",
			"Contact the Office of the Test Registrar about residency reclassification and the documented domicile requirements today.",
			"Contact the Office of the Test Registrar about graduation applications and the published degree deadlines today."},
		{"a menu and an unrelated list",
			menu(0, false),
			"- Drop and add runs through the first week\n- Late drops need a petition\n- Waitlists close on the second Friday\n- Transcripts are mailed within three days\n- Holds block enrollment"},
	}
	for _, c := range cases {
		if Similar(sketch(t, c.a), sketch(t, c.b)) {
			t.Errorf("%s: matched", c.name)
		}
	}
}

func TestShortBlocksAreExactOnly(t *testing.T) {
	for _, text := range []string{"", "QUICKLINKS", "## Deadlines and dates", "Return to the registrar's home page", "one two three four five six seven"} {
		if _, ok := SketchOf(text); ok {
			t.Errorf("%q is eligible", text)
		}
	}
	if _, ok := SketchOf("one two three four five six seven eight"); !ok {
		t.Error("eight words are eligible")
	}
	// Numbers and dates are one word: nine words of which a run of dates is one.
	if _, ok := SketchOf("Updated March 3 2026 Monday by the web team here"); ok {
		t.Error("a run of date words counts as one word")
	}
}

func TestSketchWords(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Last updated March 3, 2026 by Ann", "last updated 0 by ann"},
		{"Posted Monday 3rd of June", "posted 0 of 0"},
		{"Students may apply; may 3 is the deadline", "students may apply 0 is the deadline"},
		{"On Sunday the sun rose; sat 5 sun", "on 0 the sun rose 0"},
		{"**Bold** [link](<x>) - item_1 café ÜBER", "bold link item 0 café über"},
		{"Version 2 of v2 and 2nd, ab12cd", "version 0 of v0 and 0 ab0cd"},
	}
	for _, c := range cases {
		if got := strings.Join(sketchWords(Normalize(c.in)), " "); got != c.want {
			t.Errorf("sketchWords(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSketchIgnoresMarkup(t *testing.T) {
	a := sketch(t, "- [Home](/home)\n- [**Registrar**](/registrar)\n- [Contact us](/c) the office of the test registrar is here")
	b := sketch(t, "* Home\n* Registrar\n* [Contact us](/elsewhere) The Office of the Test Registrar is HERE")
	if a != b {
		t.Error("markup, case and link targets change the sketch")
	}
}

// randomText builds a block of n words drawn from a vocabulary.
func randomText(r *rand.Rand, n, vocab int) string {
	w := make([]string, n)
	for i := range w {
		v := r.Intn(vocab) // a word of letters only: digits are folded
		w[i] = string([]byte{'a' + byte(v%26), 'a' + byte(v/26%26), 'a' + byte(v/676%26), 'x'})
	}
	return strings.Join(w, " ")
}

// A property over random blocks: a block always matches itself and its re-formatted self, and independent random
// blocks (the same vocabulary, different order and choice) essentially never match.
func TestSketchProperties(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	falseMatches := 0
	const n = 400
	for i := 0; i < n; i++ {
		a := randomText(r, 12+r.Intn(60), 500)
		sa := sketch(t, a)
		if !Similar(sa, sa) || sa != sketch(t, strings.ToUpper(strings.ReplaceAll(a, " ", "  "))) {
			t.Fatalf("a block differs from itself: %q", a)
		}
		// One word changed in a block of at least 40 words still matches.
		if words := strings.Fields(a); len(words) >= 40 {
			words[len(words)/2] = "changedword"
			if !Similar(sa, sketch(t, strings.Join(words, " "))) {
				t.Errorf("one changed word of %d broke the match: %q", len(words), a)
			}
		}
		if Similar(sa, sketch(t, randomText(r, 12+r.Intn(60), 500))) {
			falseMatches++
		}
	}
	if falseMatches > 0 {
		t.Errorf("%d of %d unrelated random blocks matched", falseMatches, n)
	}
}

func FuzzSketchOf(f *testing.F) {
	for _, s := range []string{"", "a b c d e f g h", menu(1, false), "Last updated May 3, 2026 by the Office of the Registrar today", "\x00\xff\xfe weird é bytes in a block of text that is long enough to count"} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, text string) {
		a, ok := SketchOf(text)
		b, ok2 := SketchOf(text)
		if ok != ok2 || a != b {
			t.Fatal("not deterministic")
		}
		words := sketchWords(Normalize(text))
		if ok != (len(words) >= MinWords) {
			t.Fatalf("eligible = %v with %d words", ok, len(words))
		}
		if len(words) > MaxWords {
			t.Fatalf("%d words", len(words))
		}
		if ok {
			if !Similar(a, a) {
				t.Fatal("a sketch does not match itself")
			}
			// Emphasis never changes a sketch.
			if c, ok3 := SketchOf("**" + text + "**"); ok3 != ok || c != a {
				t.Fatalf("emphasis changed the sketch of %q", text)
			}
			for j := 0; j < Bands; j++ {
				if a.Band(j)>>56 != uint64(j) {
					t.Fatal("band number missing from its key")
				}
			}
		}
	})
}
