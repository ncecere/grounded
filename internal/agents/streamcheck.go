// Answers streamed in checked paragraphs (docs/v0.4.0.md §4, output mode
// stream_checked): the model's text is held until a paragraph ends (a
// blank line, or about checkedChunkChars at a sentence end), the answer so
// far is checked as a whole, then the new paragraph is released. Checks
// run one at a time in a goroutine of their own, in order, while the model
// keeps writing; the rest of the text is checked when the model ends. A
// failing or unavailable (fail-closed) check replaces the whole answer with
// the notice at once, and nothing more is sent. Thinking is never shown.

package agents

import (
	"context"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"go.opentelemetry.io/otel/attribute"

	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/tracing"
)

// Paragraph sizes: a paragraph without a blank line is cut at the last
// sentence end once it reaches checkedChunkChars characters, and at the
// last space once it reaches checkedChunkHard without a sentence end.
const (
	checkedChunkChars = 800
	checkedChunkHard  = 2 * checkedChunkChars
)

var (
	// blankLine ends a paragraph.
	blankLine = regexp.MustCompile(`\n[ \t]*\n`)
	// sentenceEnd ends a sentence: a full stop, question or exclamation
	// mark (with closing quotes, brackets, emphasis or [n] markers) before
	// a space, or a line end.
	sentenceEnd = regexp.MustCompile(`[.!?]["'”’)\]*_]*(?:\[\d+\])*[ \t]+|\n`)
	lastSpace   = regexp.MustCompile(`\s+\S*$`)
)

// chunkEnd is where the held text's next chunk ends (a byte offset), or 0
// while it should wait for more text. A chunk that is only white space
// waits for the text after it.
func chunkEnd(held string) int {
	cut := 0
	if m := blankLine.FindAllStringIndex(held, -1); len(m) > 0 {
		cut = m[len(m)-1][1]
	} else if n := utf8.RuneCountInString(held); n >= checkedChunkChars {
		if m := sentenceEnd.FindAllStringIndex(held, -1); len(m) > 0 {
			cut = m[len(m)-1][1]
		} else if n >= checkedChunkHard {
			cut = len(held)
			if loc := lastSpace.FindStringIndex(held); loc != nil && loc[0] > 0 {
				cut = loc[0]
			}
		}
	}
	if cut > 0 && strings.TrimSpace(held[:cut]) == "" {
		return 0
	}
	return cut
}

// checkedChunk is one paragraph to check: text is everything up to and
// including it, chunk the paragraph itself, gen the text it belongs to
// (reset starts another).
type checkedChunk struct {
	text, chunk string
	gen         int
}

// checkedStream chunks an answer's text and checks and releases its
// paragraphs in order. write and close are called by the answer's
// goroutine; check, release and blocked by the stream's own.
type checkedStream struct {
	check   func(text string, n int) moderation.Decision
	release func(chunk string)
	// blocked is told that a check blocked the answer, and whether
	// paragraphs had been released.
	blocked func(d moderation.Decision, shown bool)

	// The answer's goroutine: the text so far and how much of it is queued.
	text    strings.Builder
	queued  int
	started bool

	mu     sync.Mutex
	queue  []checkedChunk
	closed bool
	wake   chan struct{}
	done   chan struct{}
	// gen counts resets; shown: a paragraph of this text was released.
	// Both under mu, which release is called with, so nothing of a reset
	// text is released after the reset.
	gen   int
	shown bool

	// The stream's goroutine (read by close once it is done).
	checks int
	failed bool
	worst  *moderation.Decision
}

func newCheckedStream(check func(string, int) moderation.Decision, release func(string), blocked func(moderation.Decision, bool)) *checkedStream {
	return &checkedStream{check: check, release: release, blocked: blocked, wake: make(chan struct{}, 1), done: make(chan struct{})}
}

// write adds model text and queues the paragraphs it completes. It never
// waits for a check.
func (c *checkedStream) write(delta string) {
	c.text.WriteString(delta)
	all := c.text.String()
	for {
		cut := chunkEnd(all[c.queued:])
		if cut == 0 {
			return
		}
		c.enqueue(checkedChunk{text: all[:c.queued+cut], chunk: all[c.queued : c.queued+cut]})
		c.queued += cut
	}
}

// reset discards the text so far (a turn that called a tool, v0.4.2
// BU2-01): paragraphs waiting for their check are dropped, one being
// checked isn't released, and when some were released already, shownReset
// is called (it sends text_reset). The next write starts a new text, checked
// on its own. A block found before the reset still stands.
func (c *checkedStream) reset(shownReset func()) {
	c.text.Reset()
	c.queued = 0
	c.mu.Lock()
	defer c.mu.Unlock()
	c.queue = nil
	c.gen++
	if c.shown {
		c.shown = false
		shownReset()
	}
}

func (c *checkedStream) enqueue(ch checkedChunk) {
	if !c.started {
		c.started = true
		go c.run()
	}
	c.mu.Lock()
	ch.gen = c.gen
	c.queue = append(c.queue, ch)
	c.mu.Unlock()
	c.signal()
}

func (c *checkedStream) signal() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

// close queues the rest of the text, waits until every paragraph was
// checked and released (or dropped after a block), and returns the
// decision to record (nil when nothing was checked) and the number of
// checks.
func (c *checkedStream) close() (*moderation.Decision, int) {
	all := c.text.String()
	if c.queued < len(all) {
		c.enqueue(checkedChunk{text: all, chunk: all[c.queued:]})
		c.queued = len(all)
	}
	if !c.started {
		return nil, 0
	}
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
	c.signal()
	<-c.done
	return c.worst, c.checks
}

// run checks and releases the queued paragraphs in order, one at a time.
func (c *checkedStream) run() {
	defer close(c.done)
	for {
		ch, ok := c.next()
		if !ok {
			return
		}
		c.process(ch)
	}
}

func (c *checkedStream) next() (checkedChunk, bool) {
	for {
		c.mu.Lock()
		if len(c.queue) > 0 {
			ch := c.queue[0]
			c.queue = c.queue[1:]
			c.mu.Unlock()
			return ch, true
		}
		closed := c.closed
		c.mu.Unlock()
		if closed {
			return checkedChunk{}, false
		}
		<-c.wake
	}
}

func (c *checkedStream) process(ch checkedChunk) {
	switch {
	case c.failed:
		return // nothing after a block is sent
	case strings.TrimSpace(ch.chunk) == "":
		c.mu.Lock()
		if c.shown && ch.gen == c.gen { // trailing white space adds nothing to check
			c.release(ch.chunk)
		}
		c.mu.Unlock()
		return
	}
	c.checks++
	d := c.check(ch.text, c.checks)
	c.mu.Lock()
	defer c.mu.Unlock()
	if ch.gen != c.gen {
		return // its text was reset while it was checked: never shown, nothing to decide
	}
	c.keep(d)
	if d.Blocked {
		c.failed = true
		c.blocked(d, c.shown)
		return
	}
	c.release(ch.chunk)
	c.shown = true
}

// decisionRank orders decisions for the record: a block (or support), then
// an error, a flag and a pass; among equals the later check (more text).
var decisionRank = map[string]int{moderation.DecisionPass: 0, moderation.DecisionFlag: 1, moderation.DecisionError: 2,
	moderation.DecisionBlock: 3, moderation.DecisionSupport: 3}

func (c *checkedStream) keep(d moderation.Decision) {
	if c.worst == nil || decisionRank[d.Outcome] >= decisionRank[c.worst.Outcome] {
		c.worst = &d
	}
}

// ---- the chat pipeline's part ----------------------------------------------------------

// startChecked prepares the checked-paragraph stream of an answer streamed
// under stream_checked (nil otherwise: a JSON answer is checked once,
// whole). Checks outlive a client that left, like the output check.
func (ru *run) startChecked(ctx context.Context) {
	if !ru.mod.Checked() || ru.out.emit == nil {
		return
	}
	ctx = context.WithoutCancel(ctx)
	first := true
	release := func(chunk string) {
		if first {
			first = false
			observability.ModerationFirstRelease.WithLabelValues(ru.channel).Observe(time.Since(ru.started).Seconds())
		}
		ru.out.send(Event{"text_delta", DeltaEvent{Delta: chunk}})
	}
	blocked := func(d moderation.Decision, shown bool) {
		action := ModerationWithheld
		if shown {
			action = ModerationRetracted
		}
		ev := ru.moderationEvent(d, action)
		ru.checkedEvent = &ev
		ru.out.send(Event{"moderation", ev})
	}
	ru.checked = newCheckedStream(func(text string, n int) moderation.Decision { return ru.checkParagraph(ctx, text, n) }, release, blocked)
}

// checkParagraph checks the answer up to and including its nth paragraph,
// as a span (counts only, never the text).
func (ru *run) checkParagraph(ctx context.Context, text string, n int) moderation.Decision {
	ctx, span := tracing.Start(ctx, "moderation.paragraph", attribute.Int("grounded.moderation.paragraph", n),
		attribute.Int("grounded.moderation.chars", utf8.RuneCountInString(text)))
	d := ru.mod.Check(ctx, moderation.Input{Stage: moderation.StageOutput, Text: text, Question: ru.question})
	span.SetAttributes(attribute.String("grounded.moderation.decision", d.Outcome))
	observability.ModerationChunkChecks.WithLabelValues(d.Outcome).Inc()
	tracing.End(span, d.Err)
	return d
}

// settleChecked finishes a checked-paragraph answer: the rest of the text
// is checked and released, and a blocked answer becomes the notice (the
// moderation event was sent when its paragraph failed). It reports
// whether the answer was withheld.
func (ru *run) settleChecked(ans *Answer) (withheld bool) {
	d, n := ru.checked.close()
	ru.checked = nil
	if d == nil {
		return false
	}
	ru.modOut, ru.modChecks = d, n
	if !d.Blocked || ru.checkedEvent == nil {
		return false
	}
	ev := *ru.checkedEvent
	ans.Text, ans.Thinking, ans.Citations, ans.Moderation, ans.storedCode = ev.Notice, "", []Citation{}, &ev, storedModerationCode(ev, codeModerationWithheld)
	return true
}
