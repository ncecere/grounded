package agents

import (
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/ncecere/grounded/internal/moderation"
)

func TestChunkEnd(t *testing.T) {
	long := strings.Repeat("The library opens at nine on weekdays. ", 25) // 975 characters, no blank line
	cases := []struct {
		name, held string
		want       int
	}{
		{"a paragraph still being written", "The library opens at nine.", 0},
		{"a blank line ends it", "First paragraph.\n\nSecond", len("First paragraph.\n\n")},
		{"the last blank line wins", "One.\n\nTwo.\n \nThree", len("One.\n\nTwo.\n \n")},
		{"white space alone waits", "\n\n", 0},
		{"a short paragraph without a blank line waits", strings.Repeat("Word. ", 50), 0},
		{"a long paragraph is cut at its last sentence end", long + "And then", len(long)},
	}
	for _, c := range cases {
		if got := chunkEnd(c.held); got != c.want {
			t.Errorf("%s: chunkEnd = %d, want %d", c.name, got, c.want)
		}
	}
	// A citation marker after the full stop stays with its sentence.
	cited := strings.Repeat("x", checkedChunkChars) + " it opens at nine.[2] Then"
	if got := chunkEnd(cited); cited[:got] != strings.TrimSuffix(cited, "Then") {
		t.Errorf("cited cut = %q", cited[got:])
	}
	// No sentence end at all: cut at the last space once it is twice as long.
	words := strings.Repeat("word ", checkedChunkHard/5) + "unfinished"
	if got := chunkEnd(words); got == 0 || got >= len(words) || words[got:] != " unfinished" {
		t.Errorf("hard cut at %d of %d: %q", got, len(words), words[got:])
	}
	if got := chunkEnd(strings.Repeat("word ", checkedChunkChars/5)); got != 0 {
		t.Errorf("no sentence end below the hard limit: cut at %d", got)
	}
}

// fakeChecks records the checked texts; failAt blocks the nth check with
// outcome (0: never).
type fakeChecks struct {
	mu       sync.Mutex
	texts    []string
	released strings.Builder
	blocks   []moderation.Decision
	shown    []bool
	failAt   int
	outcome  string
}

func (f *fakeChecks) stream() *checkedStream {
	return newCheckedStream(func(text string, n int) moderation.Decision {
		f.mu.Lock()
		f.texts = append(f.texts, text)
		f.mu.Unlock()
		if n == f.failAt {
			return moderation.Decision{Stage: moderation.StageOutput, Outcome: f.outcome, Blocked: true}
		}
		return moderation.Decision{Stage: moderation.StageOutput, Outcome: moderation.DecisionPass}
	}, func(chunk string) {
		f.released.WriteString(chunk)
	}, func(d moderation.Decision, shown bool) {
		f.blocks = append(f.blocks, d)
		f.shown = append(f.shown, shown)
	})
}

// feed writes text word by word, as a model streams it.
func feed(c *checkedStream, text string) {
	for _, w := range strings.SplitAfter(text, " ") {
		c.write(w)
	}
}

var fourParagraphs = []string{"The library opens at nine. ", "Parking permits are sold online. ",
	"Bring your student card UNSAFE. ", "The cafe closes at five."}

func paragraphs(ps []string) string { return strings.Join(ps, "\n\n") }

func TestCheckedStreamAllPass(t *testing.T) {
	f := &fakeChecks{}
	c := f.stream()
	text := paragraphs(fourParagraphs)
	feed(c, text)
	d, n := c.close()
	if d == nil || d.Blocked || n != 4 || f.released.String() != text || len(f.blocks) != 0 {
		t.Fatalf("decision %+v, checks %d, released %q, blocks %v", d, n, f.released.String(), f.blocks)
	}
	// Each check reads everything before it (cumulative), and the last the whole answer.
	for i, got := range f.texts {
		if want := paragraphs(fourParagraphs[:i+1]); strings.TrimRight(got, "\n") != want {
			t.Errorf("check %d = %q, want %q", i+1, got, want)
		}
	}
}

func TestCheckedStreamThirdParagraphFails(t *testing.T) {
	f := &fakeChecks{failAt: 3, outcome: moderation.DecisionBlock}
	c := f.stream()
	feed(c, paragraphs(fourParagraphs))
	d, n := c.close()
	if d == nil || !d.Blocked || d.Outcome != moderation.DecisionBlock || n != 3 {
		t.Fatalf("decision %+v, checks %d", d, n)
	}
	// Paragraphs 1 and 2 were shown, nothing after the block; the 4th was never checked.
	if got := f.released.String(); got != paragraphs(fourParagraphs[:2])+"\n\n" {
		t.Errorf("released %q", got)
	}
	if len(f.blocks) != 1 || !f.shown[0] || len(f.texts) != 3 {
		t.Errorf("blocks %v shown %v checks %d", f.blocks, f.shown, len(f.texts))
	}
}

func TestCheckedStreamFirstParagraphFailsClosed(t *testing.T) {
	// The provider is unavailable and the policy fails closed: nothing is shown.
	f := &fakeChecks{failAt: 1, outcome: moderation.DecisionError}
	c := f.stream()
	feed(c, paragraphs(fourParagraphs))
	d, _ := c.close()
	if d == nil || d.Outcome != moderation.DecisionError || f.released.Len() != 0 || len(f.shown) != 1 || f.shown[0] {
		t.Fatalf("decision %+v, released %q, shown %v", d, f.released.String(), f.shown)
	}
}

func TestCheckedStreamLongParagraph(t *testing.T) {
	f := &fakeChecks{}
	c := f.stream()
	text := strings.Repeat("Students can renew a parking permit online before it expires. ", 40) // about 2,500 characters, one paragraph
	feed(c, text)
	_, n := c.close()
	if n < 3 || f.released.String() != text {
		t.Fatalf("checks %d, released %d of %d bytes", n, f.released.Len(), len(text))
	}
	prev := ""
	for i, got := range f.texts[:len(f.texts)-1] {
		chunk := strings.TrimPrefix(got, prev)
		if !strings.HasSuffix(chunk, "expires. ") || utf8.RuneCountInString(chunk) > checkedChunkChars+100 {
			t.Errorf("chunk %d (%d characters) ends %q", i+1, utf8.RuneCountInString(chunk), chunk[max(0, len(chunk)-20):])
		}
		prev = got
	}
}

// TestCheckedStreamDoesNotStallTheModel: writing never waits for a check,
// one check runs at a time, and paragraphs are released in order.
func TestCheckedStreamDoesNotStallTheModel(t *testing.T) {
	gate := make(chan struct{})
	var inFlight, maxInFlight atomic.Int32
	var released []string
	c := newCheckedStream(func(text string, n int) moderation.Decision {
		if v := inFlight.Add(1); v > maxInFlight.Load() {
			maxInFlight.Store(v)
		}
		defer inFlight.Add(-1)
		if n == 1 {
			<-gate // the first check is slow
		}
		time.Sleep(time.Millisecond)
		return moderation.Decision{Outcome: moderation.DecisionPass}
	}, func(chunk string) { released = append(released, chunk) }, func(moderation.Decision, bool) {})
	done := make(chan struct{})
	go func() {
		feed(c, paragraphs(fourParagraphs))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("write waited for a check")
	}
	close(gate)
	_, n := c.close()
	if n != 4 || maxInFlight.Load() != 1 {
		t.Fatalf("checks %d, at most %d at once", n, maxInFlight.Load())
	}
	for i, p := range fourParagraphs {
		if strings.TrimRight(released[i], "\n") != p {
			t.Errorf("release %d = %q, want %q", i, released[i], p)
		}
	}
}

func TestCheckedStreamNothingWritten(t *testing.T) {
	c := (&fakeChecks{}).stream()
	if d, n := c.close(); d != nil || n != 0 {
		t.Fatalf("empty answer: %+v %d", d, n)
	}
	// Only white space: nothing to check or show.
	f := &fakeChecks{}
	c = f.stream()
	c.write("\n\n")
	if d, n := c.close(); d != nil || n != 0 || f.released.Len() != 0 {
		t.Fatalf("white space: %+v %d %q", d, n, f.released.String())
	}
}

func TestDecisionKeptForTheRecord(t *testing.T) {
	c := &checkedStream{}
	c.keep(moderation.Decision{Outcome: moderation.DecisionFlag, TopCategory: "violence"})
	c.keep(moderation.Decision{Outcome: moderation.DecisionPass})
	if c.worst.Outcome != moderation.DecisionFlag {
		t.Errorf("a later pass hid a flag: %+v", c.worst)
	}
	c.keep(moderation.Decision{Outcome: moderation.DecisionFlag, TopCategory: "illicit"})
	if c.worst.TopCategory != "illicit" {
		t.Errorf("the later flag (more text) should win: %+v", c.worst)
	}
}
